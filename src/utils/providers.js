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

// 跟 CC 当前可选的模型保持一致：
// - Opus 4.8 / Sonnet 4.6 / Haiku 4.5 是主推
// - Opus 4.7 / 4.6 在 CC 的"More models"里能选
// - Fable 5 当前 Anthropic 标 Currently unavailable，先不列；以后回来再补
export const DEFAULT_ANTHROPIC_MODELS = [
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-opus-4-7',
  'claude-opus-4-6',
]

// 本机 Claude（订阅）走的是同一批模型，列表与 DEFAULT_ANTHROPIC_MODELS 完全一致
// 全名形式直接传给 claude --model，claude -p 支持全名也支持别名
export const LOCAL_CLAUDE_MODELS = DEFAULT_ANTHROPIC_MODELS

// 本机 Claude 的模型清单始终跟随 LOCAL_CLAUDE_MODELS（Anthropic 那边可选模型变化时自动跟齐）。
// 与现存清单不一致就覆盖：fable-5 下架要清掉，opus-4-6 上架要补上，都靠这一步。
function pickLocalDefault() {
  return LOCAL_CLAUDE_MODELS.find((m) => m.includes('sonnet')) || LOCAL_CLAUDE_MODELS[0]
}
function migrateLocalClaude(arr) {
  let changed = false
  for (const p of arr) {
    if (p.protocol !== 'claude-cli') continue
    const same =
      Array.isArray(p.models) &&
      p.models.length === LOCAL_CLAUDE_MODELS.length &&
      p.models.every((m, i) => m === LOCAL_CLAUDE_MODELS[i])
    if (same) continue
    p.models = [...LOCAL_CLAUDE_MODELS]
    if (!LOCAL_CLAUDE_MODELS.includes(p.defaultModel)) p.defaultModel = pickLocalDefault()
    changed = true
  }
  if (changed) {
    try {
      localStorage.setItem(LS, JSON.stringify(arr))
      // 当前选中的 model 已经不在新清单里 → 把指向本机供应商的 target 切到默认（sonnet）
      try {
        const t = JSON.parse(localStorage.getItem(LS_TARGET) || 'null')
        if (t && !LOCAL_CLAUDE_MODELS.includes(t.model)) {
          const owner = arr.find((p) => p.id === t.providerId)
          if (owner?.protocol === 'claude-cli') {
            localStorage.setItem(LS_TARGET, JSON.stringify({ providerId: t.providerId, model: pickLocalDefault() }))
          }
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
