// 浏览器直调 Anthropic Messages API（流式 SSE）。
// Key/模型从设置页存的 localStorage 读；CORS 需要
// anthropic-dangerous-direct-browser-access 头（Key 只在本机，风险自担）。

export function getApiKey() {
  return localStorage.getItem('emet.anthropicKey') || ''
}

export function getModel() {
  return localStorage.getItem('emet.model') || 'claude-fable-5'
}

// 流式对话。onDelta(增量文本, 累计全文) 逐块回调，返回完整回复。
// 注意：Fable 5 / Opus 4.8 不接受 temperature / budget_tokens，
// 一律不传采样参数、不传 thinking（按需省略即默认行为）。
export async function streamChat({ system, messages, onDelta, signal }) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('NO_KEY')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: getModel(),
      max_tokens: 4096,
      stream: true,
      system,
      messages,
    }),
    signal,
  })

  if (!res.ok) {
    let msg = `API ${res.status}`
    try {
      const j = await res.json()
      if (j?.error?.message) msg = j.error.message
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new Error(msg)
  }

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload) continue
      let ev
      try {
        ev = JSON.parse(payload)
      } catch {
        continue
      }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        full += ev.delta.text
        onDelta?.(ev.delta.text, full)
      } else if (ev.type === 'error') {
        throw new Error(ev.error?.message || '流式响应出错')
      }
    }
  }
  return full
}
