// 聊天请求层：按供应商协议类型构造请求 + 解析流式响应。
// - Anthropic 原生：POST {base}/v1/messages，x-api-key 头，
//   SSE 事件 content_block_delta.text_delta
// - OpenAI 兼容：POST {base}/v1/chat/completions，Authorization Bearer 头，
//   system 放 messages 第一条，SSE data 行 choices[0].delta.content，[DONE] 结束
// - 本机 claude-cli：POST {baseUrl}/chat，把对话+system 交给本机 chat-server.cjs，
//   后端 spawn `claude -p` 把订阅额度当聊天用，文字流 SSE 吐回（无 [DONE]，靠 done/error 事件）
import { getActiveTarget } from './providers.js'
import { request } from '../api/client.js'

// baseUrl 归一：去尾斜杠；没带 /v1 的补上
function endpoint(base, path) {
  let b = (base || '').trim().replace(/\/+$/, '')
  if (!/\/v1$/.test(b)) b += '/v1'
  return b + path
}

// 流式对话。
//   onDelta(增量, 累计全文)         —— 正文
//   onThinking(增量, 累计思考全文)  —— 思考过程（Anthropic thinking_delta /
//                                     OpenAI 兼容 reasoning_content，可能没有）
//   temperature                     —— 仅 OpenAI 兼容协议发送；Anthropic 原生忽略
//   maxTokens                       —— max_tokens
//   tools                           —— Anthropic 工具定义数组（仅 Anthropic 原生启用，见拍板①A）
//   runTool(name, input)            —— 执行一个工具，返回结果文本（Promise）
//   onToolUse({phase,id,name,input,result}) —— 工具调用/结果回调，供 UI 渲染
// 返回完整正文。
export async function streamChat({ system, messages, temperature, maxTokens, tools, runTool, onDelta, onThinking, onToolUse, onUsage, signal }) {
  const target = getActiveTarget()
  if (!target) throw new Error('NO_PROVIDER')
  const { provider, model } = target
  if (provider.protocol === 'claude-cli') {
    // 本机 chat-server.cjs；工具调用不支持（chat-server 已用 --tools "" 关掉）
    return streamClaudeCli({ provider, model, system, messages, signal, onDelta, onThinking, onToolUse })
  }
  if (provider.protocol === 'openai') {
    // 第一版工具调用只在 Anthropic 原生启用；OpenAI 兼容照旧纯文本聊天
    return streamOpenAI({ provider, model, system, messages, temperature, maxTokens, onDelta, onThinking, signal })
  }
  return streamAnthropic({ provider, model, system, messages, maxTokens, tools, runTool, onDelta, onThinking, onToolUse, onUsage, signal })
}

async function readSSE(res, onLine) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload) onLine(payload)
    }
  }
}

async function throwHttpError(res) {
  let msg = `API ${res.status}`
  try {
    const j = await res.json()
    msg = j?.error?.message || j?.message || msg
  } catch {
    /* 非 JSON 错误体 */
  }
  const err = new Error(msg)
  err.status = res.status // 让调用方能按状态码分流（如 405=对象根本不是桥 → 回落中转）
  throw err
}

// 合并 usage：message_start 带 input/cache 字段，message_delta 带最终 output_tokens，
// 逐字段并入（只覆盖非空值），避免后到的事件把缓存字段冲成 undefined。
function mergeUsage(acc, u) {
  const out = { ...(acc || {}) }
  if (u) for (const k in u) if (u[k] != null) out[k] = u[k]
  return out
}

// 跨轮累加 usage：工具循环里每轮是一次独立计费的请求，读/写应相加而非覆盖，
// 这样"调用工具"那一整轮显示的是两次请求的总读/总写（否则只剩最后一次的写、吞掉命中）。
function sumUsage(a, b) {
  const out = { ...(a || {}) }
  if (b) for (const k in b) if (typeof b[k] === 'number') out[k] = (out[k] || 0) + b[k]
  return out
}

// ── Anthropic 原生 ───────────────────────────────────────
// 注意：Fable 5 / Opus 4.8 不接受 temperature / budget_tokens，
// 一律不传采样参数、不主动请求 thinking（thinking 只解析返回里已有的块）。
//
// 带 tools 时变成 agentic 循环：模型 stop_reason=tool_use → 执行工具 → 回
// tool_result → 再请求，直到正常收尾或达轮数上限。正文跨轮累计。
const MAX_TOOL_ROUNDS = 5

async function streamAnthropic({ provider, model, system, messages, maxTokens, tools, runTool, onDelta, onThinking, onToolUse, onUsage, signal }) {
  // 内部 API 消息数组（可含 tool_use / tool_result 内容块），从 UI 的纯文本消息起步
  const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }))
  let full = '' // 跨轮累计的正文，最终返回
  let turnUsage = null // 整轮用量（跨工具轮累加）：显示到前端的缓存命中/写入

  // ── prompt caching 前缀布局（Anthropic 顺序：tools → system → messages）──
  // system 只放稳定段(人设)+准静态段(记忆/日记)，各打一个 cache_control 断点（1h TTL，命中免费续期）；
  // 易变段(时间/身体)不放 system，而是注入到"最后一条消息"里（在所有断点之后），
  //   否则它每轮变动会毁掉后面(历史)的缓存前缀。字符串(对话沉淀 DISTILL_SYSTEM)→ 原样单块、不缓存。
  let systemBlocks
  let volatile = ''
  if (system && typeof system === 'object') {
    systemBlocks = []
    if (system.stable) systemBlocks.push({ type: 'text', text: system.stable, cache_control: { type: 'ephemeral', ttl: '1h' } })
    if (system.semi) systemBlocks.push({ type: 'text', text: system.semi, cache_control: { type: 'ephemeral', ttl: '1h' } })
    // 跨窗口衔接（会话内静态、正文自带标题行）：不单独占断点——后面的 summary 断点或 BP4
    // 会把它罩进缓存前缀。放 summary 之前：summary 会滚动重写，衔接永远不动，顺序反了
    // 每次摘要更新都会把衔接一起挤出缓存前缀。
    if (system.carry) systemBlocks.push({ type: 'text', text: system.carry })
    // 滚动摘要（Step3b）：只在锚点前移时更新（约每 10 轮），与窗口重建同拍，缓存代价顺带摊掉。
    // 断点用量：stable + semi + summary + BP4 = 4，正好顶满上限。
    if (system.summary) systemBlocks.push({ type: 'text', text: '【本次对话此前内容的摘要】\n' + system.summary, cache_control: { type: 'ephemeral', ttl: '1h' } })
    volatile = system.volatile || ''
  } else if (typeof system === 'string' && system) {
    systemBlocks = [{ type: 'text', text: system }]
  }

  // 历史断点（BP4）：给倒数第二条消息打 cache_control，缓存"到上一轮为止"的对话历史。
  // 前缀里已无易变内容 → 逐轮命中、层层接力（read 会越叠越高）。工具循环追加的块 ≤10 条，在 20 条回溯窗口内，不影响。
  if (apiMessages.length >= 2) {
    const i = apiMessages.length - 2
    const p = apiMessages[i]
    if (typeof p.content === 'string') {
      apiMessages[i] = { role: p.role, content: [{ type: 'text', text: p.content, cache_control: { type: 'ephemeral', ttl: '1h' } }] }
    }
  }

  // 易变上下文(时间/身体)注入到最后一条消息，位于所有断点之后 → 不进缓存前缀。
  // 只改本次请求副本；存储里的消息保持干净，故它下一轮作为历史时仍是干净版、可稳定命中。
  if (volatile && apiMessages.length) {
    const last = apiMessages[apiMessages.length - 1]
    const t = typeof last.content === 'string' ? last.content : ''
    apiMessages[apiMessages.length - 1] = { role: last.role, content: `［实时上下文，非用户输入］\n${volatile}\n［以下是用户消息］\n${t}` }
  }

  // 缓存保活快照：round-0 请求体的深拷贝（不含 apiKey）。整轮成功且确有缓存活动时上报给
  // worker，由它按拍原样重放来续期缓存（见 worker runKeepalive）。仅正常聊天（分段 system）参与，
  // 对话沉淀等字符串 system 不上报，避免覆盖正经聊天的快照。
  const snapBody =
    system && typeof system === 'object'
      ? JSON.parse(JSON.stringify({ providerId: provider.id, model, tools: tools && tools.length ? tools : undefined, system: systemBlocks, messages: apiMessages }))
      : null

  // 当轮图片：末条 user 消息带 _imgs（Chat.jsx 只给"本轮要发的"消息挂它）→ 转视觉块。
  // 刻意放在 snapBody 之后：保活快照不掺 base64（重放时末条本来就会被换成 nonce，塞图纯浪费 KV）。
  // 历史轮的图不重发——存储里 content 始终是干净字符串，BP4 缓存前缀逐字稳定（与 volatile 同套路）。
  const lastImgs = messages.length ? messages[messages.length - 1]._imgs : null
  if (Array.isArray(lastImgs) && lastImgs.length && apiMessages.length) {
    const last = apiMessages[apiMessages.length - 1]
    const t = typeof last.content === 'string' ? last.content : ''
    apiMessages[apiMessages.length - 1] = {
      role: last.role,
      content: [
        ...lastImgs.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.media_type || 'image/jpeg', data: im.data } })),
        { type: 'text', text: t },
      ],
    }
  }
  const pushSnapshot = () => {
    if (!snapBody) return
    const act = (turnUsage?.cache_read_input_tokens || 0) + (turnUsage?.cache_creation_input_tokens || 0)
    if (act > 0) request('/api/keepalive/snapshot', { method: 'POST', body: { ...snapBody, savedAt: new Date().toISOString() } }).catch(() => {})
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const body = { model, max_tokens: maxTokens || 4096, stream: true, messages: apiMessages }
    if (systemBlocks) body.system = systemBlocks
    if (tools && tools.length) body.tools = tools

    const res = await fetch(endpoint(provider.baseUrl, '/messages'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) await throwHttpError(res)

    const blocks = [] // 本轮内容块，按 index 收集
    let thinking = ''
    let stopReason = null
    let err = null
    let roundUsage = null // 本轮请求的 usage（message_start 带读/写、message_delta 带输出，合并）

    await readSSE(res, (payload) => {
      let ev
      try {
        ev = JSON.parse(payload)
      } catch {
        return
      }
      if (ev.type === 'message_start') {
        roundUsage = mergeUsage(roundUsage, ev.message?.usage)
        onUsage?.(sumUsage(turnUsage, roundUsage))
      } else if (ev.type === 'content_block_start') {
        const cb = ev.content_block || {}
        blocks[ev.index] =
          cb.type === 'tool_use'
            ? { type: 'tool_use', id: cb.id, name: cb.name, _json: '' }
            : cb.type === 'thinking'
              ? { type: 'thinking', thinking: '' }
              : { type: 'text', text: '' }
      } else if (ev.type === 'content_block_delta') {
        const b = blocks[ev.index] || (blocks[ev.index] = { type: 'text', text: '' })
        if (ev.delta?.type === 'text_delta') {
          b.text = (b.text || '') + ev.delta.text
          full += ev.delta.text
          onDelta?.(ev.delta.text, full)
        } else if (ev.delta?.type === 'thinking_delta' && typeof ev.delta.thinking === 'string') {
          b.thinking = (b.thinking || '') + ev.delta.thinking
          thinking += ev.delta.thinking
          onThinking?.(ev.delta.thinking, thinking)
        } else if (ev.delta?.type === 'input_json_delta') {
          b._json = (b._json || '') + (ev.delta.partial_json || '')
        }
      } else if (ev.type === 'message_delta') {
        if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason
        if (ev.usage) {
          roundUsage = mergeUsage(roundUsage, ev.usage)
          onUsage?.(sumUsage(turnUsage, roundUsage))
        }
      } else if (ev.type === 'error') {
        err = new Error(ev.error?.message || '流式响应出错')
      }
    })
    if (err) throw err
    turnUsage = sumUsage(turnUsage, roundUsage) // 本轮结束，累加进整轮总量（供下一轮叠加）

    const toolUses = blocks
      .filter((b) => b && b.type === 'tool_use')
      .map((b) => {
        let input = {}
        try {
          input = b._json ? JSON.parse(b._json) : {}
        } catch {
          /* 不完整 JSON 当空参 */
        }
        return { id: b.id, name: b.name, input }
      })

    // 没有工具调用 → 正常结束
    if (stopReason !== 'tool_use' || !toolUses.length) {
      pushSnapshot()
      return full
    }

    // 回放本轮 assistant 内容块（只保留 text + tool_use；不回 thinking，避免签名要求）
    const assistantContent = []
    for (const b of blocks) {
      if (!b) continue
      if (b.type === 'text' && b.text) assistantContent.push({ type: 'text', text: b.text })
      else if (b.type === 'tool_use') {
        const tu = toolUses.find((t) => t.id === b.id)
        assistantContent.push({ type: 'tool_use', id: b.id, name: b.name, input: tu?.input || {} })
      }
    }
    apiMessages.push({ role: 'assistant', content: assistantContent })

    // 逐个执行工具，构造 tool_result（失败也回结果文本，让模型知道并自处理）
    const toolResults = []
    for (const tu of toolUses) {
      onToolUse?.({ phase: 'call', id: tu.id, name: tu.name, input: tu.input })
      let resultText
      try {
        resultText = await runTool(tu.name, tu.input)
      } catch (e) {
        resultText = '工具执行失败：' + (e?.message || e)
      }
      onToolUse?.({ phase: 'result', id: tu.id, name: tu.name, input: tu.input, result: resultText })
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: resultText })
    }
    apiMessages.push({ role: 'user', content: toolResults })
    // 进入下一轮
  }

  pushSnapshot()
  return full // 达到轮数上限兜底
}

// ── 本机 Claude CLI（走订阅）─────────────────────────────
// 配合 chat-server.cjs（项目根目录，node 启动）；后端协议：
//   POST {baseUrl}/chat   body { system, messages }
//   响应：SSE 流，默认事件 data: { text }；自定义事件 done / error
async function streamClaudeCli({ provider, model, system, messages, signal, onDelta, onThinking, onToolUse }) {
  // system 可能是分段对象（见 chatSystemPrompt）；本机桥只吃字符串，拼回去（含跨窗口衔接段）
  const sys = system && typeof system === 'object' ? [system.stable, system.semi, system.carry, system.summary ? '【本次对话此前内容的摘要】\n' + system.summary : '', system.volatile].filter(Boolean).join('\n') : system
  // model 透传给后端；跳过"本机订阅"这种占位（让 claude 走自己的默认）
  const payloadModel = model && model !== '本机订阅' ? model : ''
  // 桥协议的消息：{role, content, images?}——只有末条 user 消息带当轮图（_imgs），
  // 桥会把图落成临时文件让 claude 用 Read 看；历史轮不带图（桥端只加"[附了图片]"标注）
  const bridgeMessages = messages.map((m, i) => ({
    role: m.role,
    content: m.content,
    ...(i === messages.length - 1 && Array.isArray(m._imgs) && m._imgs.length
      ? { images: m._imgs.map((im) => ({ data: im.data, media_type: im.media_type || 'image/jpeg' })) }
      : m.images?.length ? { had_images: true } : {}),
  }))

  // ── 直连通道自动选择（信箱中转已退役 2026-07-31：无流式无思考还慢，静怡拍板拔掉）──
  // 1) 页面自己的来源就是桥吗？——同源探 /health 看身份标记（cc.emethome.com / localhost:8000）。
  // 2) 否则探 provider.baseUrl（电脑上开云端家 → 探本机 localhost 桥，最快）。
  // 3) 否则探 cc 门（手机上开云端家 → 带 Access 登录 cookie 跨域直连，需每月在 cc 门登录一次）。
  // 全探不到 → 直接明说怎么恢复，不再悄悄降级成又慢又哑的信箱。
  let directBase = null
  if (typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)) {
    const sameOrigin = window.location.origin.replace(/\/+$/, '')
    if (await bridgeReachable(sameOrigin)) directBase = sameOrigin
  }
  if (!directBase) {
    const cand = (provider.baseUrl || 'http://localhost:8000').replace(/\/+$/, '')
    if (await bridgeReachable(cand)) directBase = cand
  }
  if (!directBase && typeof window !== 'undefined' && window.location.origin !== CC_DOOR) {
    if (await bridgeReachable(CC_DOOR)) directBase = CC_DOOR
  }

  if (!directBase) throw new Error(NO_BRIDGE_MSG)
  try {
    return await streamClaudeDirect({ base: directBase, apiKey: provider.apiKey, sys, messages: bridgeMessages, payloadModel, signal, onDelta, onThinking, onToolUse })
  } catch (e) {
    // 405/404 = 探测误判，那个"桥"其实是静态托管（旧缓存/域名搬家）→ 同样给恢复指引
    if (e && (e.status === 405 || e.status === 404)) throw new Error(NO_BRIDGE_MSG)
    throw e
  }
}

// 书房门：电脑开着时的流式直连入口（Access 邮箱锁在前，浏览器带登录 cookie 过闸）
const CC_DOOR = 'https://cc.emethome.com'
const NO_BRIDGE_MSG =
  '流式通道没接上：手机→打开 cc.emethome.com 登录一次再回来；电脑→确认「启动本机聊天」窗口开着（还不行就双击重开一次）。'

// 探测某来源是不是"本机桥"：/health 必须回带 bridge:'emet-local' 标记。
// 只看 r.ok 不够——SPA（pages.dev）对任意路径都回 index.html 200，会误判。
// 短超时；混合内容（https 页探 http）会立即抛错 → false。
async function bridgeReachable(base) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1500)
    // no-store：绕开 SW/HTTP 缓存——/health 是实时身份探测，吃到旧缓存会误判直连
    // credentials:'include'：探 cc 门要带 Access 登录 cookie（同站子域，Lax 也会带）；对 localhost 无副作用
    const r = await fetch(base + '/health', { signal: ctrl.signal, cache: 'no-store', credentials: 'include' })
    clearTimeout(timer)
    if (!r.ok) return false
    const j = await r.json().catch(() => null)
    return j?.bridge === 'emet-local'
  } catch {
    return false
  }
}

// 直连本机桥：SSE 流式，逐字回显正文与思考（电脑/隧道场景）
async function streamClaudeDirect({ base, apiKey, sys, messages, payloadModel, signal, onDelta, onThinking, onToolUse }) {
  const headers = { 'content-type': 'application/json' }
  // apiKey 在 claude-cli 协议里是"暗号"，对应 chat-server 的 CC_BRIDGE_TOKEN
  if (apiKey) headers.authorization = 'Bearer ' + apiKey
  // cc 门在 Access 登录墙后面：浏览器的"预检"请求(OPTIONS)按规范不带 cookie，
  // 会被登录墙拦下 → 整个跨域直连失败，除非去 Cloudflare 后台配一堆 CORS(静怡看不懂)。
  // 解法：把请求伪装成"简单请求"(text/plain + 无 authorization 头) → 浏览器不发预检，
  // 带着登录 cookie 的正式请求直达。桥端 readBody 解析从不看 content-type；
  // cc 门的鉴权靠 Access 注入的邮箱头，桥不看暗号——两个头都可以安全省掉。
  if (base === CC_DOOR) {
    headers['content-type'] = 'text/plain;charset=UTF-8'
    delete headers.authorization
  }
  let res
  try {
    res = await fetch(base + '/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ system: sys, messages, model: payloadModel }),
      signal,
      credentials: 'include', // 走 cc 门要带 Access 登录 cookie；同源/localhost 场景无副作用
    })
  } catch (e) {
    throw new Error('连不上本机后端：' + (e?.message || e) + '。请先在电脑上启动本机桥')
  }
  if (!res.ok) await throwHttpError(res)

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let full = ''
  let thinking = ''
  let err = null

  outer: for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let sep
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      let event = 'message'
      let data = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (event === 'error') {
        let msg = '本机后端错误'
        try { msg = JSON.parse(data)?.message || msg } catch { /* 原样 */ }
        err = new Error(msg)
        break outer
      }
      if (event === 'done') break outer
      if (!data) continue
      let payload
      try { payload = JSON.parse(data) } catch { continue }
      if (event === 'thinking' && payload?.thinking) {
        thinking += payload.thinking
        onThinking?.(payload.thinking, thinking)
      } else if (event === 'tool' && payload?.id) {
        // 桥转发的工具调用事件（{phase:'start'|'input'|'result', id, name, input, result}）
        // 直接喂给 Chat.jsx 的 onToolUse，复用 API 路线的工具展示（调用中/参数/结果）
        onToolUse?.(payload)
      } else if (payload?.text) {
        full += payload.text
        onDelta?.(payload.text, full)
      }
    }
  }
  if (err) throw err
  return full
}

// （云端信箱中转 relayViaWorker 已于 2026-07-31 退役删除：无流式无思考还慢。
//   worker 侧 /api/relay/* 接口暂留但无人调用；如需考古看 git 历史。）

// ── OpenAI 兼容（中转站常见格式）─────────────────────────
async function streamOpenAI({ provider, model, system, messages, temperature, maxTokens, onDelta, onThinking, signal }) {
  // system 可能是分段对象（见 chatSystemPrompt）；OpenAI 兼容格式只吃字符串，拼回去（含跨窗口衔接段）
  const sys = system && typeof system === 'object' ? [system.stable, system.semi, system.carry, system.summary ? '【本次对话此前内容的摘要】\n' + system.summary : '', system.volatile].filter(Boolean).join('\n') : system
  const oaiMessages = [
    ...(sys ? [{ role: 'system', content: sys }] : []),
    ...messages.map((m, i) => {
      // 当轮末条带图 → OpenAI 兼容的 image_url data URI 块；历史轮不重发（同 Anthropic 路线）
      const imgs = i === messages.length - 1 && Array.isArray(m._imgs) ? m._imgs : null
      if (imgs && imgs.length) {
        return {
          role: m.role,
          content: [
            ...imgs.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.media_type || 'image/jpeg'};base64,${im.data}` } })),
            { type: 'text', text: m.content },
          ],
        }
      }
      return { role: m.role, content: m.content }
    }),
  ]
  const body = { model, stream: true, max_tokens: maxTokens || 4096, messages: oaiMessages }
  // temperature 仅 OpenAI 兼容协议发送（Anthropic 原生那些模型不接受）
  if (typeof temperature === 'number') body.temperature = temperature
  const res = await fetch(endpoint(provider.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) await throwHttpError(res)

  let full = ''
  let thinking = ''
  await readSSE(res, (payload) => {
    if (payload === '[DONE]') return
    let ev
    try {
      ev = JSON.parse(payload)
    } catch {
      return
    }
    const d = ev.choices?.[0]?.delta || {}
    // 思考过程：部分中转站（如 DeepSeek 系）放在 reasoning_content；没有就忽略，不报错
    if (typeof d.reasoning_content === 'string' && d.reasoning_content) {
      thinking += d.reasoning_content
      onThinking?.(d.reasoning_content, thinking)
    }
    if (typeof d.content === 'string' && d.content) {
      full += d.content
      onDelta?.(d.content, full)
    }
  })
  return full
}
