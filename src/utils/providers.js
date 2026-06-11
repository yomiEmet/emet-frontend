// ═══════════════════════════════════════════════════════════
// 多供应商管理（参考 Kelivo）。
// localStorage emet.providers = [{
//   id, name, baseUrl, apiKey,
//   protocol: 'anthropic' | 'openai',   // 原生 / OpenAI 兼容（中转站常见）
//   models: ['model-id', ...], defaultModel, enabled
// }]
// emet.chatTarget = { providerId, model }  当前聊天用哪个
// ═══════════════════════════════════════════════════════════

const LS = 'emet.providers'
const LS_TARGET = 'emet.chatTarget'

export const DEFAULT_ANTHROPIC_MODELS = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
]

export function loadProviders() {
  let arr = null
  try {
    arr = JSON.parse(localStorage.getItem(LS))
  } catch {
    /* 坏数据当不存在 */
  }
  if (Array.isArray(arr)) return arr

  // ── 迁移：旧的单 Key 配置（emet.anthropicKey / emet.model）→ 第一个供应商
  const oldKey = localStorage.getItem('emet.anthropicKey')
  if (oldKey) {
    const oldModel = localStorage.getItem('emet.model') || 'claude-fable-5'
    arr = [
      {
        id: 'p-official',
        name: '官方',
        baseUrl: 'https://api.anthropic.com',
        apiKey: oldKey,
        protocol: 'anthropic',
        models: [...DEFAULT_ANTHROPIC_MODELS],
        defaultModel: oldModel,
        enabled: true,
      },
    ]
    saveProviders(arr)
    localStorage.removeItem('emet.anthropicKey')
    localStorage.removeItem('emet.model')
    return arr
  }
  return []
}

export function saveProviders(arr) {
  localStorage.setItem(LS, JSON.stringify(arr))
}

// 当前聊天目标：{ provider, model }；没有可用供应商返回 null
export function getActiveTarget() {
  const enabled = loadProviders().filter((p) => p.enabled && p.apiKey)
  let t = null
  try {
    t = JSON.parse(localStorage.getItem(LS_TARGET))
  } catch {
    /* ignore */
  }
  if (t) {
    const p = enabled.find((x) => x.id === t.providerId)
    if (p && p.models.includes(t.model)) return { provider: p, model: t.model }
  }
  const p = enabled[0]
  if (!p || !p.models.length) return null
  const model = p.defaultModel && p.models.includes(p.defaultModel) ? p.defaultModel : p.models[0]
  return { provider: p, model }
}

export function setActiveTarget(providerId, model) {
  localStorage.setItem(LS_TARGET, JSON.stringify({ providerId, model }))
}
