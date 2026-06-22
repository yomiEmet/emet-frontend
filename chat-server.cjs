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
const { spawn } = require('child_process')

const HOST = '127.0.0.1'
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
]
const EXTRA_ORIGINS = (process.env.CC_BRIDGE_CORS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const CORS_ORIGINS = new Set([...DEFAULT_ORIGINS, ...EXTRA_ORIGINS])

const IS_WIN = process.platform === 'win32'
const CLAUDE = IS_WIN ? 'claude.cmd' : 'claude'

function corsHeaders(req) {
  const origin = req.headers.origin
  const allow = origin && CORS_ORIGINS.has(origin) ? origin : 'http://localhost:5173'
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
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

// 把前端给的 messages 数组拼成一段对话脚本喂给 claude -p。
// claude -p 是一次性问答，没有"会话"概念，所以历史得我们自己塞进 prompt 里。
function buildPrompt(messages) {
  const lines = []
  for (const m of messages) {
    const who = m.role === 'user' ? '我' : '你'
    const txt = (m.content || '').toString()
    if (!txt.trim()) continue
    lines.push(`${who}：${txt}`)
  }
  lines.push('你：')
  return lines.join('\n\n')
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req))
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(req) })
    res.end(JSON.stringify({ ok: true, host: HOST, port: PORT, claude: CLAUDE }))
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

  const { system = '', messages = [] } = payload
  if (!Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(req) })
    res.end(JSON.stringify({ error: 'messages required' }))
    return
  }

  const prompt = buildPrompt(messages)

  // claude -p --tools ""（关全部工具）--system-prompt（替换 agent 默认提示）
  // 不传 --output-format → 默认 text，stdout 直接吐字
  const args = ['-p', '--tools', '']
  if (system && system.trim()) args.push('--system-prompt', system)

  writeSseHead(res, req)

  const child = spawn(CLAUDE, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  child.stdin.write(prompt, 'utf8')
  child.stdin.end()

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    if (chunk) sseSend(res, null, { text: chunk })
  })

  let stderrBuf = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk
    // 实时透出来，方便排错；前端可以忽略
    process.stderr.write('[claude] ' + chunk)
  })

  child.on('error', (e) => {
    sseSend(res, 'error', { message: 'spawn 失败：' + e.message })
    res.end()
  })

  child.on('close', (code) => {
    if (code !== 0) {
      sseSend(res, 'error', { message: `claude 退出码 ${code}` + (stderrBuf ? '：' + stderrBuf.trim().slice(0, 500) : '') })
    } else {
      sseSend(res, 'done', { ok: true })
    }
    res.end()
  })

  req.on('close', () => {
    if (!child.killed) child.kill()
  })
})

server.listen(PORT, HOST, () => {
  console.log('Emet 本机聊天后端已启动')
  console.log(`  地址：http://${HOST}:${PORT}`)
  console.log(`  CLI：${CLAUDE}`)
  console.log(`  鉴权：${AUTH_TOKEN ? '✓ 已开（环境变量 CC_BRIDGE_TOKEN）' : '⚠ 未设 token —— 仅适合纯本机用；公网请设 CC_BRIDGE_TOKEN'}`)
  if (EXTRA_ORIGINS.length) {
    console.log(`  额外 CORS：${EXTRA_ORIGINS.join(', ')}`)
  }
  console.log('  前端打开 http://localhost:5173 → 设置页切到"本机 Claude（订阅）"供应商即可开聊')
  console.log('  退出按 Ctrl+C')
})
