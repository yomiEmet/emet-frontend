// 聊天请求层：按供应商协议类型构造请求 + 解析流式响应。
// - Anthropic 原生：POST {base}/v1/messages，x-api-key 头，
//   SSE 事件 content_block_delta.text_delta
// - OpenAI 兼容：POST {base}/v1/chat/completions，Authorization Bearer 头，
//   system 放 messages 第一条，SSE data 行 choices[0].delta.content，[DONE] 结束
// - 本机 claude-cli：POST {baseUrl}/chat，把对话+system 交给本机 chat-server.cjs，
//   后端 spawn `claude -p` 把订阅额度当聊天用，文字流 SSE 吐回（无 [DONE]，靠 done/error 事件）
import { getActiveTarget } from './providers.js'

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
    return streamClaudeCli({ provider, model, system, messages, signal, onDelta })
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
  throw new Error(msg)
}

// 合并 usage：message_start 带 input/cache 字段，message_delta 带最终 output_tokens，
// 逐字段并入（只覆盖非空值），避免后到的事件把缓存字段冲成 undefined。
function mergeUsage(acc, u) {
  const out = { ...(acc || {}) }
  if (u) for (const k in u) if (u[k] != null) out[k] = u[k]
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
  let usageAcc = null // 用量累计（缓存命中探针：读 usage 显示到前端，不改请求）

  // system 归一成 block 数组（只构造一次，跨轮不变）：
  //   对象 { stable, semi, volatile } → 稳定段(人设)+准静态段(记忆/日记)各打一个 cache_control 断点，
  //   易变段(时间/身体状态)放最后、不打断点；工具在 system 之前，断点会连工具一起缓存。
  //   字符串（对话沉淀 DISTILL_SYSTEM）→ 原样单块、不缓存。默认 5 分钟 TTL（先证明命中，再升 1h）。
  let systemBlocks
  if (system && typeof system === 'object') {
    systemBlocks = []
    if (system.stable) systemBlocks.push({ type: 'text', text: system.stable, cache_control: { type: 'ephemeral' } })
    if (system.semi) systemBlocks.push({ type: 'text', text: system.semi, cache_control: { type: 'ephemeral' } })
    if (system.volatile) systemBlocks.push({ type: 'text', text: system.volatile })
  } else if (typeof system === 'string' && system) {
    systemBlocks = [{ type: 'text', text: system }]
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

    await readSSE(res, (payload) => {
      let ev
      try {
        ev = JSON.parse(payload)
      } catch {
        return
      }
      if (ev.type === 'message_start') {
        usageAcc = mergeUsage(usageAcc, ev.message?.usage)
        onUsage?.(usageAcc)
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
          usageAcc = mergeUsage(usageAcc, ev.usage)
          onUsage?.(usageAcc)
        }
      } else if (ev.type === 'error') {
        err = new Error(ev.error?.message || '流式响应出错')
      }
    })
    if (err) throw err

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
    if (stopReason !== 'tool_use' || !toolUses.length) return full

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

  return full // 达到轮数上限兜底
}

// ── 本机 Claude CLI（走订阅）─────────────────────────────
// 配合 chat-server.cjs（项目根目录，node 启动）；后端协议：
//   POST {baseUrl}/chat   body { system, messages }
//   响应：SSE 流，默认事件 data: { text }；自定义事件 done / error
async function streamClaudeCli({ provider, model, system, messages, signal, onDelta }) {
  const base = (provider.baseUrl || 'http://localhost:8000').replace(/\/+$/, '')
  // system 可能是分段对象（见 chatSystemPrompt）；本机桥只吃字符串，拼回去
  const sys = system && typeof system === 'object' ? [system.stable, system.semi, system.volatile].filter(Boolean).join('\n') : system
  // apiKey 在 claude-cli 协议里是"暗号"，对应 chat-server 启动时的 CC_BRIDGE_TOKEN 环境变量
  const headers = { 'content-type': 'application/json' }
  if (provider.apiKey) headers.authorization = 'Bearer ' + provider.apiKey
  // model 透传给后端，由 chat-server 转成 claude --model 参数；
  // 跳过"本机订阅"这种占位（让 claude 走自己的默认）
  const payloadModel = model && model !== '本机订阅' ? model : ''
  let res
  try {
    res = await fetch(base + '/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ system: sys, messages, model: payloadModel }),
      signal,
    })
  } catch (e) {
    throw new Error('连不上本机后端：' + (e?.message || e) + '。请先在终端跑 `node chat-server.cjs`')
  }
  if (!res.ok) await throwHttpError(res)

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let full = ''
  let err = null

  outer: for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    // SSE 帧以空行（\n\n）分隔
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
      if (data) {
        let payload
        try { payload = JSON.parse(data) } catch { continue }
        if (payload?.text) {
          full += payload.text
          onDelta?.(payload.text, full)
        }
      }
    }
  }
  if (err) throw err
  return full
}

// ── OpenAI 兼容（中转站常见格式）─────────────────────────
async function streamOpenAI({ provider, model, system, messages, temperature, maxTokens, onDelta, onThinking, signal }) {
  // system 可能是分段对象（见 chatSystemPrompt）；OpenAI 兼容格式只吃字符串，拼回去
  const sys = system && typeof system === 'object' ? [system.stable, system.semi, system.volatile].filter(Boolean).join('\n') : system
  const oaiMessages = [
    ...(sys ? [{ role: 'system', content: sys }] : []),
    ...messages.map((m) => ({ role: m.role, content: m.content })),
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
