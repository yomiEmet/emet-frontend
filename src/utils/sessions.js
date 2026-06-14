// ═══════════════════════════════════════════════════════════
// 聊天会话存储（localStorage emet.chatSessions）+ 导出/导入 + 合并。
// 会话形状：{ id, title, created_at, updated_at?, deleted?, messages:[{mid,ts,role,content,thinking?,tools?}] }
// Chat.jsx、设置页、云同步层都从这里读写，单一来源。
// 合并函数 mergeSession/mergeMessages 与后端 worker.js 同构（多设备同步）。
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

// 新消息：带 mid（唯一）+ ts（创建时间），做消息级合并的依据。
let _mseq = 0
export function newMessage(role, extra = {}) {
  return {
    mid: 'm' + Date.now().toString(36) + (_mseq++).toString(36),
    ts: new Date().toISOString(),
    role,
    content: '',
    ...extra,
  }
}

// ── 合并（与后端 worker.js 的 mergeMessages/mergeSession 同构）──
// messages：按 mid 并集去重（同 mid 取 content 更长的一份）、按 ts 排序；
//           无 mid（老数据）退化为"更长的一方胜"。
export function mergeMessages(a = [], b = []) {
  const hasMid = (arr) => arr.length > 0 && arr.every((m) => m && m.mid)
  if (hasMid(a) && hasMid(b)) {
    const map = new Map()
    for (const m of [...a, ...b]) {
      const ex = map.get(m.mid)
      if (!ex || (m.content || '').length > (ex.content || '').length) map.set(m.mid, m)
    }
    return [...map.values()].sort((x, y) => {
      const xt = x.ts || '', yt = y.ts || ''
      return xt < yt ? -1 : xt > yt ? 1 : 0
    })
  }
  return a.length >= b.length ? a : b
}

// 会话级字段（标题/删除标记）取 updated_at 较新的一方；messages 走并集。
export function mergeSession(a, b) {
  if (!a) return b
  if (!b) return a
  const newer = (a.updated_at || '') >= (b.updated_at || '') ? a : b
  const older = newer === a ? b : a
  return {
    ...newer,
    created_at: older.created_at || newer.created_at,
    messages: mergeMessages(a.messages || [], b.messages || []),
  }
}

// 把 incoming 会话数组并入 local（按 id 用 mergeSession），按时间倒序返回。
export function mergeSessionLists(local = [], incoming = []) {
  const byId = new Map(local.map((s) => [s.id, s]))
  for (const s of incoming) {
    if (!s || !s.id) continue
    byId.set(s.id, mergeSession(byId.get(s.id), s))
  }
  return [...byId.values()].sort((a, b) => sessionTime(b) - sessionTime(a))
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
// 合并走 mergeSession（消息级并集）：相同会话 id 不再整条覆盖，而是并消息、不丢。
export function importSessions(parsed) {
  if (!parsed || typeof parsed !== 'object' || parsed.format !== EXPORT_FORMAT) {
    throw new Error('文件格式不对：不是会话存档')
  }
  if (typeof parsed.version !== 'number' || parsed.version > EXPORT_VERSION) {
    throw new Error(`不支持的存档版本：v${parsed.version}（当前支持到 v${EXPORT_VERSION}）`)
  }
  const incoming = Array.isArray(parsed.sessions) ? parsed.sessions : []
  const local = loadSessions()
  const localIds = new Set(local.map((s) => s.id))

  let added = 0
  let updated = 0
  for (const s of incoming) {
    if (!s || !s.id) continue
    if (localIds.has(s.id)) updated++
    else added++
  }

  const merged = mergeSessionLists(local, incoming)
  saveSessions(merged)
  return { added, updated, total: merged.length }
}
