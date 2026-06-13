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
// 返回完整正文。
export async function streamChat({ system, messages, temperature, maxTokens, onDelta, onThinking, signal }) {
  const target = getActiveTarget()
  if (!target) throw new Error('NO_PROVIDER')
  const { provider, model } = target
  if (provider.protocol === 'openai') {
    return streamOpenAI({ provider, model, system, messages, temperature, maxTokens, onDelta, onThinking, signal })
  }
  return streamAnthropic({ provider, model, system, messages, maxTokens, onDelta, onThinking, signal })
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
async function streamAnthropic({ provider, model, system, messages, maxTokens, onDelta, onThinking, signal }) {
  const res = await fetch(endpoint(provider.baseUrl, '/messages'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens || 4096, stream: true, system, messages }),
    signal,
  })
  if (!res.ok) await throwHttpError(res)

  let full = ''
  let thinking = ''
  let err = null
  await readSSE(res, (payload) => {
    let ev
    try {
      ev = JSON.parse(payload)
    } catch {
      return
    }
    if (ev.type === 'content_block_delta') {
      // 正文增量
      if (ev.delta?.type === 'text_delta') {
        full += ev.delta.text
        onDelta?.(ev.delta.text, full)
      // 思考过程增量（模型若返回 thinking 块就实时累计）
      } else if (ev.delta?.type === 'thinking_delta' && typeof ev.delta.thinking === 'string') {
        thinking += ev.delta.thinking
        onThinking?.(ev.delta.thinking, thinking)
      }
    } else if (ev.type === 'error') {
      err = new Error(ev.error?.message || '流式响应出错')
    }
  })
  if (err) throw err
  return full
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
