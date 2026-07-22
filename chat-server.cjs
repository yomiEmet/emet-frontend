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
const https = require('https')
const net = require('net')
const tls = require('tls')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { URL } = require('url')
const { spawn, execSync } = require('child_process')

// 监听地址：默认只听本机回环 127.0.0.1（最安全，只有本机能连）。
// 想让同一 WiFi/热点下的手机也能连：启动前设 CC_BRIDGE_HOST=0.0.0.0，
// 且必须同时设 CC_BRIDGE_TOKEN（暗号）——否则同网别人也能白用你的额度。
const HOST = (process.env.CC_BRIDGE_HOST || '127.0.0.1').trim()
const PORT = Number(process.env.CC_BRIDGE_PORT) || 8000
const NO_RELAY = process.env.CC_NO_RELAY === '1' // 测试用：跳过中转轮询，避免和主桥抢活

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
const PROXY_URL = (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '').trim()

// 经 HTTP 代理（CONNECT 隧道）发一个 HTTPS 请求，返回 { status, text }。
// 不依赖 NODE_USE_ENV_PROXY（实验特性，实测长驻进程里不稳）——自己建隧道最稳。
// 无代理配置时回退普通 https 直连。国内直连 workers.dev 不通，所以桥必须配代理。
function relayFetch(fullUrl, { method = 'GET', headers = {}, body = null } = {}) {
  const target = new URL(fullUrl)
  const port = Number(target.port) || 443
  const hdr = { Host: target.hostname, Connection: 'close', ...headers }
  if (body != null) hdr['Content-Length'] = Buffer.byteLength(body)

  return new Promise((resolve, reject) => {
    const doHttpsOverSocket = (socket) => {
      const tlsSock = tls.connect({ socket, servername: target.hostname }, () => {
        let reqLine = `${method} ${target.pathname}${target.search} HTTP/1.1\r\n`
        for (const [k, v] of Object.entries(hdr)) reqLine += `${k}: ${v}\r\n`
        reqLine += '\r\n'
        tlsSock.write(reqLine)
        if (body != null) tlsSock.write(body)
      })
      const chunks = []
      tlsSock.on('data', (d) => chunks.push(d))
      tlsSock.on('end', () => resolve(parseHttpResponse(Buffer.concat(chunks))))
      tlsSock.on('error', reject)
    }

    if (!PROXY_URL) {
      // 无代理：普通 https 请求
      const req = https.request(fullUrl, { method, headers: hdr }, (res) => {
        const chunks = []
        res.on('data', (d) => chunks.push(d))
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
      })
      req.on('error', reject)
      req.setTimeout(30000, () => { req.destroy(new Error('请求超时')) })
      if (body != null) req.write(body)
      req.end()
      return
    }

    // 有代理：先 CONNECT 隧道，再在隧道上做 TLS
    const px = new URL(PROXY_URL)
    const sock = net.connect(Number(px.port), px.hostname, () => {
      sock.write(`CONNECT ${target.hostname}:${port} HTTP/1.1\r\nHost: ${target.hostname}:${port}\r\n\r\n`)
    })
    let head = ''
    const onData = (chunk) => {
      head += chunk.toString('latin1')
      if (head.includes('\r\n\r\n')) {
        sock.removeListener('data', onData)
        if (/^HTTP\/1\.[01] 200/.test(head)) doHttpsOverSocket(sock)
        else reject(new Error('代理 CONNECT 失败：' + head.split('\r\n')[0]))
      }
    }
    sock.on('data', onData)
    sock.on('error', reject)
    sock.setTimeout(30000, () => { sock.destroy(); reject(new Error('代理连接超时')) })
  })
}

// 解析 HTTP/1.1 原始响应字节 → { status, text }，处理 chunked 传输编码
function parseHttpResponse(buf) {
  const raw = buf.toString('latin1')
  const sep = raw.indexOf('\r\n\r\n')
  const headText = raw.slice(0, sep)
  const statusMatch = headText.match(/^HTTP\/1\.[01] (\d+)/)
  const status = statusMatch ? Number(statusMatch[1]) : 0
  let bodyBuf = buf.slice(Buffer.byteLength(headText, 'latin1') + 4)
  if (/transfer-encoding:\s*chunked/i.test(headText)) bodyBuf = dechunk(bodyBuf)
  return { status, text: bodyBuf.toString('utf8') }
}

function dechunk(buf) {
  const out = []
  let i = 0
  while (i < buf.length) {
    let lineEnd = buf.indexOf('\r\n', i)
    if (lineEnd < 0) break
    const size = parseInt(buf.slice(i, lineEnd).toString('latin1').trim(), 16)
    if (!size || Number.isNaN(size)) break
    out.push(buf.slice(lineEnd + 2, lineEnd + 2 + size))
    i = lineEnd + 2 + size + 2
  }
  return Buffer.concat(out)
}
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

// claude -p 会沿目录树向上自动发现 CLAUDE.md，并按"项目路径"加载自动记忆。
// 若在本项目目录跑，Emet 的聊天会误吃开发用的 CLAUDE.md + CC 的记忆文件 → 串味。
// 解决：给它一个项目树之外的空工作目录（Temp 下），既无 CLAUDE.md 可向上发现，
// 该路径的自动记忆也是空的，聊天上下文只剩我们传的 --system-prompt。
const CHAT_CWD = path.join(os.tmpdir(), 'emet-bridge-cwd')
try { fs.mkdirSync(CHAT_CWD, { recursive: true }) } catch { /* 已存在 */ }

// ── MCP 只读工具（让聊天里的 Emet 能自己查记忆/日记/心情）──────────
// claude 自带的 MCP HTTP 客户端不走本机代理（国内直连 workers.dev 必挂、
// 状态永远 pending），所以走本地 stdio 转发器 mcp-stdio-proxy.cjs，
// 由它经 HTTPS_PROXY 的 CONNECT 隧道转发到 worker /mcp。
// 白名单只放只读查询（在转发器里过滤），写操作模型根本看不见。
// 关键坑（实测 2.1.209）：MCP 工具是"延迟加载"，模型要靠内置 ToolSearch
// 现取；--tools "" 会连 MCP 一起废掉 → 必须 --tools ToolSearch。
// 回滚开关：环境变量 CC_NO_MCP=1 → 回到纯聊天（--tools ""）。
const ADMIN_KEY_FILE = path.join(__dirname, '.cc-admin-key')
const MCP_ENABLED = process.env.CC_NO_MCP !== '1' && fs.existsSync(ADMIN_KEY_FILE)
let MCP_CFG_PATH = ''
if (MCP_ENABLED) {
  MCP_CFG_PATH = path.join(CHAT_CWD, 'emet-mcp.json')
  // 配置里只有路径引用，不含密钥本体（密钥始终留在 gitignore 的 .cc-admin-key）
  fs.writeFileSync(MCP_CFG_PATH, JSON.stringify({
    mcpServers: {
      emet: {
        command: process.execPath, // 当前 node 的绝对路径，不赌 PATH
        args: [path.join(__dirname, 'mcp-stdio-proxy.cjs')],
        env: {
          ...(PROXY_URL ? { HTTPS_PROXY: PROXY_URL } : {}),
          EMET_ADMIN_KEY_FILE: ADMIN_KEY_FILE,
        },
      },
    },
  }, null, 2))
}

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

// 鉴权：两种放行方式，满足其一即可——
//   ① 请求经 Cloudflare Access 隧道进来（带 Cf-Access-Authenticated-User-Email 头）。
//      桥只监听 127.0.0.1，带这个头的请求只可能是 cloudflared 从隧道转进来的，
//      而隧道已被 Access 用邮箱验证码挡过一道 → 可信，手机因此无需暗号。
//   ② 本机直连：带对的 Bearer 暗号（保护本机 8000 端口，防同机其它程序乱调）。
function checkAuth(req, res) {
  const accessEmail = (req.headers['cf-access-authenticated-user-email'] || '').trim()
  if (accessEmail) return true // 经 Access 验证过的隧道请求
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
    // 收集 Buffer 分片、末尾一次性 UTF-8 解码：避免 `buf += chunk` 把跨分片的
    // 多字节中文切成乱码（claude 读到乱码会答非所问）。
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      chunks.push(c)
      size += c.length
      if (size > 2 * 1024 * 1024) reject(new Error('payload too large'))
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
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
// 用 --output-format stream-json 逐行解析增量事件：
//   · content_block_delta.text_delta   → 正文逐字（onText）
//   · content_block_delta.thinking_delta → 思考过程逐字（onThink）
// --effort high 才会产生 thinking（默认不产生）。
// cb 可选回调：{ onText(增量文本), onThink(增量思考), onSpawn(子进程) }
function runClaude({ system, messages, model }, cb = {}) {
  const { onText, onThink, onSpawn, onTool } = cb
  return new Promise((resolve) => {
    const promptText = buildPromptText(messages)
    const baseSystem = composeSystem(system, messages)
    const modelUsed = model && model.trim() ? model.trim() : '(claude 默认模型)'
    const systemFull = baseSystem
      ? `${baseSystem}\n\n（系统说明：当前调用你的具体模型是 ${modelUsed}。如果用户问"你是哪个模型 / 哪个版本"，你就如实回答这个字符串。）`
      : `（系统说明：你当前的具体模型是 ${modelUsed}。如果用户问"你是哪个模型"，如实回答。）`

    const stampIn = new Date().toISOString().slice(11, 19)
    console.log(`[${stampIn}] → claude --model ${modelUsed}${MCP_ENABLED ? '（带记忆工具）' : ''}`)

    // MCP 开启时给模型一句使用说明（不然它不知道自己有查询能力）
    const systemWithTools = MCP_ENABLED
      ? systemFull + '\n\n（系统说明：你接着 Emet 记忆库的读写工具。查记忆/日记/心情/动态/当前状态时，先用 ToolSearch 找到对应工具再调用，查不到就如实说、不要编造。写操作（记住某事、写日记、记心情、留言、记账等）在她明确要求或明显同意时才做，别自作主张；写完看工具的实际返回再告知结果，返回里有 error 就如实说失败，不要报成功。删除类工具你没有，别答应帮她删东西。）'
      : systemFull

    const args = [
      '-p', '--system-prompt', systemWithTools,
      '--effort', 'high', // 逼出思考过程
      '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
    ]
    if (MCP_ENABLED) {
      // ToolSearch 是 MCP 延迟加载的引擎，必须保留；其余内置工具一个不给
      args.push('--tools', 'ToolSearch', '--mcp-config', MCP_CFG_PATH, '--strict-mcp-config', '--allowedTools', 'mcp__emet')
    } else {
      args.push('--tools', '')
    }
    if (model && model.trim()) args.push('--model', model.trim())

    const child = spawn(CLAUDE_RUN.file, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: CLAUDE_RUN.useShell,
      windowsHide: true,
      cwd: CHAT_CWD, // 隔离目录，避免误吃项目 CLAUDE.md / 自动记忆
    })
    if (onSpawn) onSpawn(child)

    child.stdin.write(promptText, 'utf8')
    child.stdin.end()

    let full = ''
    let resultText = '' // result 事件里的权威全文，兜底用
    let buf = ''
    // 工具调用跟踪：id → {name, input}；ToolSearch 是内部引擎，对用户隐藏
    const toolMeta = new Map()
    const hiddenToolIds = new Set()
    const toolResultText = (content) => {
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        return content.map((b) => (b && b.type === 'text' ? b.text : '')).filter(Boolean).join('\n')
      }
      try { return JSON.stringify(content) } catch { return String(content) }
    }
    const handleLine = (line) => {
      const s = line.trim()
      if (!s) return
      let ev
      try { ev = JSON.parse(s) } catch { return } // 非 JSON 行忽略
      if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta') {
        const d = ev.event.delta || {}
        if (d.type === 'text_delta' && d.text) {
          full += d.text
          onText?.(d.text)
        } else if (d.type === 'thinking_delta' && d.thinking) {
          onThink?.(d.thinking)
        }
      } else if (ev.type === 'stream_event' && ev.event?.type === 'content_block_start') {
        const cb2 = ev.event.content_block || {}
        if (cb2.type === 'tool_use' && cb2.id) {
          if (cb2.name === 'ToolSearch') hiddenToolIds.add(cb2.id)
          else {
            toolMeta.set(cb2.id, { name: cb2.name })
            onTool?.({ phase: 'start', id: cb2.id, name: cb2.name })
          }
        }
      } else if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
        for (const b of ev.message.content) {
          if (b.type === 'tool_use' && b.id && !hiddenToolIds.has(b.id) && b.name !== 'ToolSearch') {
            toolMeta.set(b.id, { name: b.name, input: b.input })
            onTool?.({ phase: 'input', id: b.id, name: b.name, input: b.input })
          }
        }
      } else if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
        for (const b of ev.message.content) {
          if (b.type === 'tool_result' && b.tool_use_id && !hiddenToolIds.has(b.tool_use_id)) {
            const meta = toolMeta.get(b.tool_use_id) || {}
            onTool?.({
              phase: 'result',
              id: b.tool_use_id,
              name: meta.name || '(工具)',
              input: meta.input,
              result: toolResultText(b.content).slice(0, 2000),
              isError: !!b.is_error,
            })
          }
        }
      } else if (ev.type === 'result' && typeof ev.result === 'string') {
        resultText = ev.result
      }
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buf += chunk
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
      }
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
      if (buf.trim()) handleLine(buf) // 收尾残行
      const stampOut = new Date().toISOString().slice(11, 19)
      console.log(`[${stampOut}] ← claude --model ${modelUsed} 完成 (exit ${code})`)
      const finalText = full || resultText
      if (code !== 0) {
        resolve({ ok: false, text: finalText, error: `claude 退出码 ${code}` + (stderrBuf ? '：' + stderrBuf.trim().slice(0, 500) : '') })
      } else {
        resolve({ ok: true, text: finalText, error: '' })
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
    // bridge:'emet-local' 是身份标记，前端据此确认"本页由桥托管"→ 走同源流式直连
    res.end(JSON.stringify({ ok: true, bridge: 'emet-local', host: HOST, port: PORT, claude: CLAUDE_RUN.file }))
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
    {
      onText: (t) => sseSend(res, null, { text: t }),
      onThink: (t) => sseSend(res, 'thinking', { thinking: t }),
      onTool: (t) => sseSend(res, 'tool', t),
      onSpawn: (child) => {
        req.on('close', () => {
          if (child && !child.killed) child.kill()
        })
      },
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
  if (ADMIN_KEY && !NO_RELAY) {
    relaySelfTestThenLoop()
  } else {
    console.log(`  手机中转：未开（缺 .cc-admin-key）—— 只影响手机线上聊天，本机直连不受影响`)
  }
  console.log('  退出按 Ctrl+C')
})

// ── 开机自检：先测一次云端连通，把结果和实际环境大声打印，再进循环 ──────────
async function relaySelfTestThenLoop() {
  console.log('  手机中转：自检中…')
  console.log(`      代理(HTTPS_PROXY)：${PROXY_URL || '（未设置！国内连不上云端，中转会失败）'}`)
  try {
    const r = await relayFetch(RELAY_BASE + '/api/relay/take', { headers: { 'X-Admin-Key': ADMIN_KEY } })
    if (r.status === 200) {
      console.log('  手机中转：✓ 云端连通、认证通过 —— 手机在线上 Emet 直接聊即可')
    } else if (r.status === 401) {
      console.log('  手机中转：✗ 云端连通但认证失败（401）—— .cc-admin-key 与 Emet 访问密钥不一致')
    } else {
      console.log(`  手机中转：✗ 云端返回异常状态 ${r.status}`)
    }
  } catch (e) {
    console.log('  手机中转：✗ 连不上云端 —— ' + (e?.message || e))
    console.log('             （多半是代理没设或代理端口不对；本机直连不受影响）')
  }
  startRelayLoop()
}

// ── 中转轮询循环：认领手机问题 → 跑 claude → 交答案 ──────────────
// 用 setTimeout 递归而非 setInterval，避免一轮没跑完又叠一轮。
async function startRelayLoop() {
  let warnedOffline = false
  // 自适应节奏：刚认领过活 → 30s 内算"聊天中"，快查（800ms）响应连续对话；
  // 空闲则慢查（3s）省 Cloudflare 额度。
  let hotUntil = 0
  const HOT_MS = 800
  const IDLE_MS = 3000
  const HOT_WINDOW = 30000
  const tick = async () => {
    let picked = false
    try {
      const r = await relayFetch(RELAY_BASE + '/api/relay/take', {
        headers: { 'X-Admin-Key': ADMIN_KEY },
      })
      if (r.status === 200) {
        warnedOffline = false // 只在真正成功时清除告警去重，否则 401 会每 2s 刷屏
        let data = null
        try { data = JSON.parse(r.text) } catch { /* 非 JSON 忽略 */ }
        if (data && data.job) {
          picked = true
          const job = data.job
          console.log(`[relay] 认领手机问题 ${job.id}（model=${job.model || '默认'}）`)
          const result = await runClaude({ system: job.system, messages: job.messages, model: job.model })
          await relayFetch(RELAY_BASE + '/api/relay/answer', {
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
    // 认领到活就续上"聊天中"窗口，让紧接着的下一句也走快查
    const nowMs = Date.now()
    if (picked) hotUntil = nowMs + HOT_WINDOW
    setTimeout(tick, nowMs < hotUntil ? HOT_MS : IDLE_MS)
  }
  tick()
}
