#!/usr/bin/env node
// ── Emet MCP stdio 转发器 ────────────────────────────────────────────
// 用途：让 claude -p 用得上 Emet worker 的 MCP 工具。
// 为什么存在：claude 自带的 MCP HTTP 客户端不走本机代理，国内直连
// workers.dev 不通（连接永远 pending）。所以 claude 走 stdio 连本脚本
// （纯本地、零网络），本脚本再经 HTTPS_PROXY 的 CONNECT 隧道转发到
// worker /mcp——和 chat-server.cjs 里 relayFetch 同一套打法。
//
// 额外职责：过滤工具清单。worker 全量 ~50 个工具，全塞给模型每句话都
// 太费订阅额度；EMET_MCP_TOOLS（逗号分隔）白名单外的工具直接从
// tools/list 结果里剔除，模型根本看不见，也就不占上下文。
//
// 鉴权：X-Admin-Key 从 .cc-admin-key 文件读（gitignore，绝不硬编码）。
// stdout 只写 JSON-RPC 行；所有日志走 stderr（stdio 协议纪律）。

const fs = require('fs')
const path = require('path')
const http = require('http')
const tls = require('tls')

const MCP_URL = new URL(process.env.EMET_MCP_URL || 'https://emet-memoty-v66.aandxiaobao.workers.dev/mcp')
const KEY_FILE = process.env.EMET_ADMIN_KEY_FILE || path.join(__dirname, '.cc-admin-key')
const PROXY_URL = (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '').trim()

// 只读查询默认白名单；设 EMET_MCP_TOOLS=all 可放全量（不建议，费额度）
const TOOL_ALLOW = (process.env.EMET_MCP_TOOLS ||
  'recall,memory_search,memory_get,memory_list,diary_list,diary_get,mood_list,feed_list,current_status,stats,period_status,message_read'
).split(',').map((s) => s.trim()).filter(Boolean)
const ALLOW_ALL = TOOL_ALLOW.length === 1 && TOOL_ALLOW[0] === 'all'

let ADMIN_KEY = ''
try { ADMIN_KEY = fs.readFileSync(KEY_FILE, 'utf8').trim() } catch {
  process.stderr.write(`[emet-mcp] 读不到密钥文件 ${KEY_FILE}，无法转发\n`)
  process.exit(1)
}

const log = (m) => process.stderr.write('[emet-mcp] ' + m + '\n')

// ── 经 CONNECT 代理向 worker POST 一条 JSON-RPC；无代理时直连 ──────
function postToWorker(payload) {
  const body = JSON.stringify(payload)
  return new Promise((resolve, reject) => {
    const onSocket = (socket) => {
      const t = tls.connect({ socket, servername: MCP_URL.hostname }, () => {
        t.write(
          `POST ${MCP_URL.pathname} HTTP/1.1\r\n` +
          `Host: ${MCP_URL.hostname}\r\n` +
          'Content-Type: application/json\r\n' +
          'Accept: application/json, text/event-stream\r\n' +
          `X-Admin-Key: ${ADMIN_KEY}\r\n` +
          `Content-Length: ${Buffer.byteLength(body)}\r\n` +
          'Connection: close\r\n\r\n' + body)
      })
      let out = ''
      t.setEncoding('utf8')
      t.on('data', (c) => { out += c })
      t.on('end', () => {
        const sep = out.indexOf('\r\n\r\n')
        if (sep < 0) return reject(new Error('响应不完整'))
        const head = out.slice(0, sep)
        let bodyPart = out.slice(sep + 4)
        const status = Number((head.match(/^HTTP\/1\.[01] (\d{3})/) || [])[1] || 0)
        // chunked 传输时去掉分块长度行
        if (/transfer-encoding:\s*chunked/i.test(head)) {
          let s = '', rest = bodyPart
          while (rest) {
            const ln = rest.indexOf('\r\n')
            if (ln < 0) break
            const size = parseInt(rest.slice(0, ln), 16)
            if (!size) break
            s += rest.slice(ln + 2, ln + 2 + size)
            rest = rest.slice(ln + 2 + size + 2)
          }
          bodyPart = s
        }
        // 兼容 SSE 形式的响应体（data: {...}）
        const m = bodyPart.match(/^data: (.+)$/m)
        const jsonText = m ? m[1] : bodyPart
        resolve({ status, text: jsonText.trim() })
      })
      t.on('error', reject)
      t.setTimeout(60000, () => { t.destroy(new Error('worker 响应超时')) })
    }

    if (PROXY_URL) {
      const p = new URL(PROXY_URL)
      const req = http.request({ host: p.hostname, port: Number(p.port) || 80, method: 'CONNECT', path: `${MCP_URL.hostname}:443` })
      req.on('connect', (res, socket) => {
        if (res.statusCode !== 200) return reject(new Error('代理 CONNECT 失败 ' + res.statusCode))
        onSocket(socket)
      })
      req.on('error', reject)
      req.setTimeout(15000, () => { req.destroy(new Error('代理连接超时')) })
      req.end()
    } else {
      const socket = require('net').connect(443, MCP_URL.hostname, () => onSocket(socket))
      socket.on('error', reject)
    }
  })
}

// ── 工具清单过滤：白名单外的从模型视野里剔除 ──────────────────────
function filterToolsList(resp) {
  try {
    if (ALLOW_ALL || !resp || !resp.result || !Array.isArray(resp.result.tools)) return resp
    const before = resp.result.tools.length
    resp.result.tools = resp.result.tools.filter((t) => TOOL_ALLOW.includes(t.name))
    log(`tools/list 过滤：${before} → ${resp.result.tools.length}`)
  } catch { /* 过滤失败就原样返回 */ }
  return resp
}

// ── stdio 循环：一行一条 JSON-RPC ──────────────────────────────────
let inBuf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  inBuf += chunk
  let nl
  while ((nl = inBuf.indexOf('\n')) >= 0) {
    const line = inBuf.slice(0, nl).trim()
    inBuf = inBuf.slice(nl + 1)
    if (line) handleMessage(line)
  }
})
process.stdin.on('end', () => process.exit(0))

async function handleMessage(line) {
  let msg
  try { msg = JSON.parse(line) } catch { return log('收到非 JSON 行，忽略') }
  const isRequest = msg.id !== undefined && msg.id !== null
  try {
    const r = await postToWorker(msg)
    if (!isRequest) return // 通知类不用回
    let resp
    try { resp = JSON.parse(r.text) } catch {
      return reply({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `worker 返回非 JSON（HTTP ${r.status}）` } })
    }
    if (msg.method === 'tools/list') resp = filterToolsList(resp)
    reply(resp)
  } catch (e) {
    log(`转发失败（${msg.method}）：${e.message}`)
    if (isRequest) reply({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: '转发失败：' + e.message } })
  }
}

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

log(`就绪：→ ${MCP_URL.href}，代理=${PROXY_URL || '（无，直连）'}，白名单=${ALLOW_ALL ? '全量' : TOOL_ALLOW.length + ' 个只读工具'}`)
