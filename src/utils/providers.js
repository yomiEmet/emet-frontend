// ═══════════════════════════════════════════════════════════
// 多供应商管理（参考 Kelivo）。
// localStorage emet.providers = [{
//   id, name, baseUrl, apiKey,
//   protocol: 'anthropic' | 'openai' | 'claude-cli',
//     // anthropic   = 原生 API（API key 烧余额）
//     // openai      = OpenAI 兼容（中转站常见，API key 烧余额）
//     // claude-cli  = 本机 chat-server.cjs → claude -p（烧订阅额度，不需要 apiKey）
//   models: ['model-id', ...], defaultModel, enabled
// }]
// emet.chatTarget = { providerId, model }  当前聊天用哪个
// ═══════════════════════════════════════════════════════════

// claude-cli 类型不需要 apiKey 也算"可用"；其它协议必须有 key。
export const isProviderReady = (p) => p.enabled && (p.protocol === 'claude-cli' || !!p.apiKey)
const isReady = isProviderReady

import { schedulePushSettings, notifyKeyChanged } from './settingsSync.js'

const LS = 'emet.providers'
const LS_TARGET = 'emet.chatTarget'

export const DEFAULT_ANTHROPIC_MODELS = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
]

// 本机 Claude（订阅）支持的模型别名，传给 claude --model
// 顺序就是下拉里出现的顺序
export const LOCAL_CLAUDE_MODELS = ['sonnet', 'opus', 'haiku', 'fable']

// 老的本机供应商可能只有 ['本机订阅'] 这种占位 model，迁到正式模型列表上
function migrateLocalClaude(arr) {
  let changed = false
  for (const p of arr) {
    if (p.protocol !== 'claude-cli') continue
    const onlyPlaceholder = p.models.length === 1 && p.models[0] === '本机订阅'
    if (onlyPlaceholder) {
      p.models = [...LOCAL_CLAUDE_MODELS]
      p.defaultModel = 'sonnet'
      changed = true
    }
  }
  if (changed) {
    try {
      localStorage.setItem(LS, JSON.stringify(arr))
      // 当前 target 如果还指着旧 model，也迁一下
      try {
        const t = JSON.parse(localStorage.getItem(LS_TARGET) || 'null')
        if (t && t.model === '本机订阅') {
          localStorage.setItem(LS_TARGET, JSON.stringify({ providerId: t.providerId, model: 'sonnet' }))
        }
      } catch { /* ignore */ }
    } catch { /* localStorage 写不进去就算了 */ }
  }
  return arr
}

export function loadProviders() {
  let arr = null
  try {
    arr = JSON.parse(localStorage.getItem(LS))
  } catch {
    /* 坏数据当不存在 */
  }
  if (Array.isArray(arr)) return migrateLocalClaude(arr)

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
  schedulePushSettings() // 变更防抖推到云端
}

// 当前聊天目标：{ provider, model }；没有可用供应商返回 null
export function getActiveTarget() {
  const enabled = loadProviders().filter(isReady)
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
  notifyKeyChanged(LS_TARGET)
}
