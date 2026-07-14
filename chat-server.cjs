// 本机聊天后端：把前端的聊天请求接到本机 `claude -p`，让聊天烧订阅额度而不是 API 余额。
//
// 启动：   node chat-server.cjs
// 端口：   127.0.0.1:8000（只监听本地回环，不对外暴露）
// 前端：   src/utils/anthropic.js 里 streamClaudeCli 经此服务调用
//
// 设计：每次请求把整段对话拼成一段文字塞进 stdin，给 claude -p 加 --tools ""（关全部工具）
// 和 --system-prompt（替换默认 agent 提示），文本逐字写到 stdout 后用 SSE 推给浏览器。
// 关进程 / 关页面 / Ctrl+C 都会断流。

const http = require('http')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn, execSync } = require('child_process')

// 监听地址：默认只听本机回环 127.0.0.1（最安全，只有本机能连）。
// 想让同一 WiFi/热点下的手机也能连：启动前设 CC_BRIDGE_HOST=0.0.0.0，
// 且必须同时设 CC_BRIDGE_TOKEN（暗号）——否则同网别人也能白用你的额度。
const HOST = (process.env.CC_BRIDGE_HOST || '127.0.0.1').trim()
const PORT = 8000

// ── 鉴权：可选的 Bearer Token（环境变量 CC_BRIDGE_TOKEN）─────────────
// 设了：所有 /chat 请求必须带 Authorization: Bearer <同样的字符串>
// 没设：不校验。仅推荐"本机回环、不挂公网"时这么用；挂公网必须设。
const AUTH_TOKEN = (process.env.CC_BRIDGE_TOKEN || '').trim()

// ── CORS 白名单 ─────────────────────────────────────
// 默认放行本机 vite dev/preview；公网部署时用 CC_BRIDGE_CORS 环境变量
// 追加（逗号分隔）。例：CC_BRIDGE_CORS=https://emet.pages.dev
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  // 线上 Cloudflare Pages 前端也放行：让部署好的 https 页面能连本机桥
  // （配合下面 corsHeaders 里的 allow-private-network 头，过浏览器的“本地网络访问”握手）
  'https://emet-frontend.pages.dev',
]
const EXTRA_ORIGINS = (process.env.CC_BRIDGE_CORS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const CORS_ORIGINS = new Set([...DEFAULT_ORIGINS, ...EXTRA_ORIGINS])

// ── 中转（relay）：让手机在线上前端聊本机 claude ─────────────────
// 桥每隔 RELAY_POLL_MS 向云端 worker 轮询 /api/relay/take 认领手机发来的问题，
// 本地跑完 claude -p 后把答案 POST 回 /api/relay/answer，手机再从 worker 取件。
// 需要两样东西才启用：
//   1) worker 地址（下面 RELAY_BASE 写死为 Emet 后端，也可用 CC_RELAY_BASE 覆盖）
//   2) 管理员密钥：环境变量 CC_ADMIN_KEY，或项目根 .cc-admin-key 文件（gitignore）
// 缺密钥时中转不启用（只影响手机，本机 HTTP 直连照常）。
const RELAY_BASE = (process.env.CC_RELAY_BASE || 'https://emet-memoty-v66.aandxiaobao.workers.dev').replace(/\/+$/, '')
const RELAY_POLL_MS = 2000
function readAdminKey() {
  const fromEnv = (process.env.CC_ADMIN_KEY || '').trim()
  if (fromEnv) return fromEnv
  try {
    return fs.readFileSync(path.join(__dirname, '.cc-admin-key'), 'utf8').trim()
  } catch {
    return ''
  }
}
const ADMIN_KEY = readAdminKey()

const IS_WIN = process.platform === 'win32'

// 找到 claude 的真实可执行文件：
// - Windows：优先 npm 全局里的 claude.exe（避开 Node 24 spawn .cmd 的 EINVAL）
// - 其它：直接走 claude，让 PATH 解析
function resolveClaude() {
  if (!IS_WIN) return { file: 'claude', useShell: false }
  // 先试常见 npm 全局位置
  const candidates = []
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'))
  try {
    const npmRoot = execSync('npm root -g', { encoding: 'utf8', windowsHide: true }).trim()
    if (npmRoot) candidates.push(path.join(npmRoot, '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'))
  } catch { /* npm 不在 PATH 也无所谓，下面还有兜底 */ }
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return { file: p, useShell: false } } catch { /* ignore */ }
  }
  // 兜底：用 shell: true 让 cmd.exe 解析 claude.cmd
  return { file: 'claude', useShell: true }
}

const CLAUDE_RUN = resolveClaude()

function corsHeaders(req) {
  const origin = req.headers.origin
  const allow = origin && CORS_ORIGINS.has(origin) ? origin : 'http://localhost:5173'
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    // https 公网页面（Pages）访问本机 http://localhost 属于 Private Network Access，
    // 浏览器预检会带 Access-Control-Request-Private-Network: true，服务端必须回应下面这行才放行。
    'access-control-allow-private-network': 'true',
    'access-control-max-age': '86400',
    vary: 'origin',
  }
}

// ── 本机静态托管前端（给同一 WiFi/热点下的手机直连用）─────────────────
// GET 且不是 /chat /health 时，从 dist/ 里找文件返回；找不到就回 index.html
// （前端是 SPA，路由如 /chat /settings 都交给它自己处理）。
// 需先在项目目录跑过 npm run build 生成 dist/。
const DIST_DIR = path.join(__dirname, 'dist')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
}
function serveStatic(req, res) {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html'
    let filePath = path.join(DIST_DIR, urlPath)
    // 防目录穿越：解析后必须仍在 dist/ 内
    if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + path.sep)) {
      res.writeHead(403, corsHeaders(req)); res.end(); return
    }
    let isFile = false
    try { isFile = fs.statSync(filePath).isFile() } catch { isFile = false }
    if (!isFile) {
      // 非文件（前端路由如 /chat /settings）一律回 index.html，交给前端路由
      filePath = path.join(DIST_DIR, 'index.html')
      let hasIndex = false
      try { hasIndex = fs.statSync(filePath).isFile() } catch { hasIndex = false }
      if (!hasIndex) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...corsHeaders(req) })
        res.end('前端还没构建：请先在项目目录运行 npm run build 生成 dist/')
        return
      }
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', ...corsHeaders(req) })
    fs.createReadStream(filePath).pipe(res)
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', ...corsHeaders(req) })
    res.end('static error: ' + e.message)
  }
}

// 抽出来，缺/错 token 一律 401，方便排查
function checkAuth(req, res) {
  if (!AUTH_TOKEN) return true
  const h = (req.headers.authorization || '').trim()
  const got = h.startsWith('Bearer ') ? h.slice(7).trim() : ''
  if (got && got === AUTH_TOKEN) return true
  res.writeHead(401, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(req) })
  res.end(JSON.stringify({ error: 'auth required: 请求需带 Authorization: Bearer <CC_BRIDGE_TOKEN>' }))
  return false
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (c) => {
      buf += c
      if (buf.length > 2 * 1024 * 1024) reject(new Error('payload too large'))
    })
    req.on('end', () => resolve(buf))
    req.on('error', reject)
  })
}

function writeSseHead(res, req) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    ...corsHeaders(req),
  })
}

function sseSend(res, event, data) {
  if (event) res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

// claude -p 是一次性问答。我们把"最后一条用户消息"当 prompt（喂 stdin），
// 之前的历史塞进 system 提示里作为上下文——这样 claude 知道"我现在要回答这一句"，
// 而不会把"我：xxx 你："当成对话脚本去续写。
function buildPromptText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return (messages[i].content || '').toString()
  }
  return ''
}

function composeSystem(baseSystem, messages) {
  const sys = (baseSystem || '').trim()
  // 历史 = 除最后一条 user 之外的所有消息
  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIdx = i; break }
  }
  const history = lastUserIdx >= 0 ? messages.slice(0, lastUserIdx) : messages
  if (history.length === 0) return sys
  const transcript = history
    .map((m) => (m.role === 'user' ? '用户' : '你') + '：' + (m.content || '').toString().trim())
    .filter((s) => s.length > 2)
    .join('\n')
  if (!transcript) return sys
  return (sys ? sys + '\n\n' : '') + '以下是你与用户之前的对话历史，仅作为上下文参考。请直接回答用户最新的一句：\n' + transcript
}

// ── 跑一次 claude -p，返回完整结果（HTTP 流式和 relay 中转共用）──────────
// onChunk 可选：stdout 每来一段调一次（HTTP 场景转 SSE 用；relay 场景不传，等完整结果）
// onSpawn 可选：拿到子进程引用（HTTP 断开时杀掉用）
function runClaude({ system, messages, model }, onChunk, onSpawn) {
  return new Promise((resolve) => {
    const promptText = buildPromptText(messages)
    const baseSystem = composeSystem(system, messages)
    const modelUsed = model && model.trim() ? model.trim() : '(claude 默认模型)'
    const systemFull = baseSystem
      ? `${baseSystem}\n\n（系统说明：当前调用你的具体模型是 ${modelUsed}。如果用户问"你是哪个模型 / 哪个版本"，你就如实回答这个字符串。）`
      : `（系统说明：你当前的具体模型是 ${modelUsed}。如果用户问"你是哪个模型"，如实回答。）`

    const stampIn = new Date().toISOString().slice(11, 19)
    console.log(`[${stampIn}] → claude --model ${modelUsed}`)

    const args = ['-p', '--tools', '', '--system-prompt', systemFull]
    if (model && model.trim()) args.push('--model', model.trim())

    const child = spawn(CLAUDE_RUN.file, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: CLAUDE_RUN.useShell,
      windowsHide: true,
    })
    if (onSpawn) onSpawn(child)

    child.stdin.write(promptText, 'utf8')
    child.stdin.end()

    let full = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      if (!chunk) return
      full += chunk
      if (onChunk) onChunk(chunk)
    })

    let stderrBuf = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk
      process.stderr.write('[claude] ' + chunk)
    })

    child.on('error', (e) => {
      resolve({ ok: false, text: full, error: 'spawn 失败：' + e.message })
    })

    child.on('close', (code) => {
      const stampOut = new Date().toISOString().slice(11, 19)
      console.log(`[${stampOut}] ← claude --model ${modelUsed} 完成 (exit ${code})`)
      if (code !== 0) {
        resolve({ ok: false, text: full, error: `claude 退出码 ${code}` + (stderrBuf ? '：' + stderrBuf.trim().slice(0, 500) : '') })
      } else {
        resolve({ ok: true, text: full, error: '' })
      }
    })
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req))
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(req) })
    res.end(JSON.stringify({ ok: true, host: HOST, port: PORT, claude: CLAUDE_RUN.file }))
    return
  }

  // GET（非 /health）一律走静态前端托管：手机同网打开根地址就能拿到 Emet 网页
  if (req.method === 'GET') {
    serveStatic(req, res)
    return
  }

  if (req.method !== 'POST' || req.url !== '/chat') {
    res.writeHead(404, corsHeaders(req))
    res.end()
    return
  }

  if (!checkAuth(req, res)) return

  let payload
  try {
    payload = JSON.parse(await readBody(req))
  } catch (e) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(req) })
    res.end(JSON.stringify({ error: 'bad json: ' + e.message }))
    return
  }

  const { system = '', messages = [], model = '' } = payload
  if (!Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(req) })
    res.end(JSON.stringify({ error: 'messages required' }))
    return
  }

  writeSseHead(res, req)

  const result = await runClaude(
    { system, messages, model },
    (chunk) => sseSend(res, null, { text: chunk }),
    (child) => {
      req.on('close', () => {
        if (child && !child.killed) child.kill()
      })
    },
  )

  if (!result.ok) {
    sseSend(res, 'error', { message: result.error })
  } else {
    sseSend(res, 'done', { ok: true })
  }
  res.end()
})

server.listen(PORT, HOST, () => {
  console.log('Emet 本机聊天后端已启动')
  console.log(`  监听：http://${HOST}:${PORT}`)
  if (HOST === '0.0.0.0') {
    const ips = []
    const ifaces = os.networkInterfaces()
    for (const name of Object.keys(ifaces)) {
      for (const ni of ifaces[name] || []) {
        if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address)
      }
    }
    console.log('  ★ 手机（同一 WiFi/热点）用浏览器打开下面任一地址即可：')
    if (ips.length) ips.forEach((ip) => console.log(`        http://${ip}:${PORT}`))
    else console.log('        （没探到局域网地址，确认电脑连着 WiFi/热点）')
    if (AUTH_TOKEN) console.log(`  ★ 手机上「暗号」栏要输入：${AUTH_TOKEN}`)
  } else {
    console.log('  本机打开：http://localhost:8000')
  }
  console.log(`  CLI：${CLAUDE_RUN.file}${CLAUDE_RUN.useShell ? '（shell 模式）' : ''}`)
  console.log(`  鉴权：${AUTH_TOKEN ? '✓ 已开（环境变量 CC_BRIDGE_TOKEN）' : '⚠ 未设 token —— 仅适合纯本机用；对外/手机必须设 CC_BRIDGE_TOKEN'}`)
  if (EXTRA_ORIGINS.length) {
    console.log(`  额外 CORS：${EXTRA_ORIGINS.join(', ')}`)
  }
  if (ADMIN_KEY) {
    console.log(`  手机中转：✓ 已开 —— 手机在线上 Emet 直接聊，无需同网/无需填地址`)
    startRelayLoop()
  } else {
    console.log(`  手机中转：未开（缺 .cc-admin-key）—— 只影响手机线上聊天，本机直连不受影响`)
  }
  console.log('  退出按 Ctrl+C')
})

// ── 中转轮询循环：认领手机问题 → 跑 claude → 交答案 ──────────────
// 用 setTimeout 递归而非 setInterval，避免一轮没跑完又叠一轮。
async function startRelayLoop() {
  let warnedOffline = false
  const tick = async () => {
    try {
      const r = await fetch(RELAY_BASE + '/api/relay/take', {
        headers: { 'X-Admin-Key': ADMIN_KEY },
      })
      if (r.ok) {
        warnedOffline = false // 只在真正成功时清除告警去重，否则 401 会每 2s 刷屏
        const data = await r.json()
        if (data && data.job) {
          const job = data.job
          console.log(`[relay] 认领手机问题 ${job.id}（model=${job.model || '默认'}）`)
          const result = await runClaude({ system: job.system, messages: job.messages, model: job.model })
          await fetch(RELAY_BASE + '/api/relay/answer', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'X-Admin-Key': ADMIN_KEY },
            body: JSON.stringify({ id: job.id, ok: result.ok, text: result.text, error: result.error }),
          })
          console.log(`[relay] 已回传答案 ${job.id}（${result.ok ? '成功' : '失败：' + result.error}）`)
        }
      } else if (r.status === 401) {
        if (!warnedOffline) console.log('[relay] ⚠ 401：.cc-admin-key 不对，中转认证失败')
        warnedOffline = true
      }
    } catch (e) {
      if (!warnedOffline) console.log('[relay] 暂时连不上云端（' + (e?.message || e) + '），会自动重试')
      warnedOffline = true
    }
    setTimeout(tick, RELAY_POLL_MS)
  }
  tick()
}
