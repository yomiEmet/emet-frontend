// 聊天请求层：按供应商协议类型构造请求 + 解析流式响应。
// - Anthropic 原生：POST {base}/v1/messages，x-api-key 头，
//   SSE 事件 content_block_delta.text_delta
// - OpenAI 兼容：POST {base}/v1/chat/completions，Authorization Bearer 头，
//   system 放 messages 第一条，SSE data 行 choices[0].delta.content，[DONE] 结束
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
export async function streamChat({ system, messages, temperature, maxTokens, tools, runTool, onDelta, onThinking, onToolUse, signal }) {
  const target = getActiveTarget()
  if (!target) throw new Error('NO_PROVIDER')
  const { provider, model } = target
  if (provider.protocol === 'openai') {
    // 第一版工具调用只在 Anthropic 原生启用；OpenAI 兼容照旧纯文本聊天
    return streamOpenAI({ provider, model, system, messages, temperature, maxTokens, onDelta, onThinking, signal })
  }
  return streamAnthropic({ provider, model, system, messages, maxTokens, tools, runTool, onDelta, onThinking, onToolUse, signal })
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

// ── Anthropic 原生 ───────────────────────────────────────
// 注意：Fable 5 / Opus 4.8 不接受 temperature / budget_tokens，
// 一律不传采样参数、不主动请求 thinking（thinking 只解析返回里已有的块）。
//
// 带 tools 时变成 agentic 循环：模型 stop_reason=tool_use → 执行工具 → 回
// tool_result → 再请求，直到正常收尾或达轮数上限。正文跨轮累计。
const MAX_TOOL_ROUNDS = 5

async function streamAnthropic({ provider, model, system, messages, maxTokens, tools, runTool, onDelta, onThinking, onToolUse, signal }) {
  // 内部 API 消息数组（可含 tool_use / tool_result 内容块），从 UI 的纯文本消息起步
  const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }))
  let full = '' // 跨轮累计的正文，最终返回

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const body = { model, max_tokens: maxTokens || 4096, stream: true, system, messages: apiMessages }
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
      if (ev.type === 'content_block_start') {
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

// ── OpenAI 兼容（中转站常见格式）─────────────────────────
async function streamOpenAI({ provider, model, system, messages, temperature, maxTokens, onDelta, onThinking, signal }) {
  const oaiMessages = [
    ...(system ? [{ role: 'system', content: system }] : []),
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
