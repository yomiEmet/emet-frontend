// ═══════════════════════════════════════════════════════════
// 聊天会话存储（localStorage emet.chatSessions）+ 导出/导入。
// 会话形状：{ id, title, created_at, updated_at?, messages:[{role,content,thinking?,tools?}] }
// Chat.jsx 与设置页都从这里读写，单一来源。
// ═══════════════════════════════════════════════════════════

export const LS_KEY = 'emet.chatSessions'

// 导出文件格式标识 + 版本号（导入时先校验）
export const EXPORT_FORMAT = 'emet-chat-sessions'
export const EXPORT_VERSION = 1

export function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || []
  } catch {
    return []
  }
}

export function saveSessions(sessions) {
  localStorage.setItem(LS_KEY, JSON.stringify(sessions))
}

// 判会话新旧：优先 updated_at，退回 created_at；都没有当 0。
function sessionTime(s) {
  const t = s?.updated_at || s?.created_at
  const ms = t ? new Date(t).getTime() : 0
  return Number.isFinite(ms) ? ms : 0
}

// 构造导出对象（含格式版本号 + 导出时间）
export function buildExport() {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    sessions: loadSessions(),
  }
}

// 校验 + 合并导入。返回 { added, updated, total }；格式/版本不对则抛错。
// 合并规则：相同会话 id 冲突时，保留 sessionTime 较新的一份；新 id 直接加入。
export function importSessions(parsed) {
  if (!parsed || typeof parsed !== 'object' || parsed.format !== EXPORT_FORMAT) {
    throw new Error('文件格式不对：不是会话存档')
  }
  if (typeof parsed.version !== 'number' || parsed.version > EXPORT_VERSION) {
    throw new Error(`不支持的存档版本：v${parsed.version}（当前支持到 v${EXPORT_VERSION}）`)
  }
  const incoming = Array.isArray(parsed.sessions) ? parsed.sessions : []
  const byId = new Map(loadSessions().map((s) => [s.id, s]))

  let added = 0
  let updated = 0
  for (const s of incoming) {
    if (!s || !s.id) continue
    const exist = byId.get(s.id)
    if (!exist) {
      byId.set(s.id, s)
      added++
    } else if (sessionTime(s) > sessionTime(exist)) {
      byId.set(s.id, s) // 冲突保留较新
      updated++
    }
  }

  const merged = [...byId.values()].sort((a, b) => sessionTime(b) - sessionTime(a))
  saveSessions(merged)
  return { added, updated, total: merged.length }
}
