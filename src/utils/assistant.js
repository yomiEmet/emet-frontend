// ═══════════════════════════════════════════════════════════
// 助手设置（单助手，所有会话共用）。存 localStorage emet.assistant。
//   name         助手名称（聊天页标题 + 消息气泡显示）
//   avatar       { type:'emoji'|'preset', value }
//   systemPrompt 系统提示词（替换原固定人设；记忆/日记/时间仍由
//                api.js chatSystemPrompt() 动态追加）
//   temperature  0–1，仅对 OpenAI 兼容协议生效（Anthropic 原生不发）
//   contextCount 发送请求时只携带最近 N 条消息（仅截断发送，不动界面/存储）
//   maxTokens    max_tokens
// ═══════════════════════════════════════════════════════════

import { schedulePushSettings } from './settingsSync.js'

const LS = 'emet.assistant'

// 内置预设头像（复用现成的 PWA 海獭图标，零美术成本）
export const PRESET_AVATARS = {
  otter: '/icon-192.png',
}

// 头像 emoji 备选网格（含番茄🍅，呼应记忆库主题）
export const EMOJI_CHOICES = [
  '🦦', '😀', '😊', '🥰', '😎', '🤖', '👾', '🐱',
  '🐶', '🐰', '🦊', '🐻', '🌙', '⭐', '🌸', '🍅',
  '☕', '📚', '💡', '🎮',
]

// 默认 systemPrompt 必须与改造前 chatSystemPrompt 的固定人设一字不差，
// 老用户在编辑前行为保持不变。
export const DEFAULT_ASSISTANT = {
  name: 'Emet',
  avatar: { type: 'emoji', value: '🦦' },
  systemPrompt: '你是 Emet，静怡的 AI 伴侣。这是你们的记忆库 App 里的聊天窗口。',
  temperature: 0.7,
  contextCount: 20,
  maxTokens: 4096,
}

export function loadAssistant() {
  let saved = null
  try {
    saved = JSON.parse(localStorage.getItem(LS))
  } catch {
    /* 坏数据当不存在 */
  }
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_ASSISTANT }
  // 与默认值合并，新增字段自动补默认
  return {
    ...DEFAULT_ASSISTANT,
    ...saved,
    avatar: saved.avatar && typeof saved.avatar === 'object'
      ? saved.avatar
      : { ...DEFAULT_ASSISTANT.avatar },
  }
}

// 合并补丁后写回，返回合并结果
export function saveAssistant(patch) {
  const next = { ...loadAssistant(), ...patch }
  localStorage.setItem(LS, JSON.stringify(next))
  schedulePushSettings() // 变更防抖推到云端
  return next
}
