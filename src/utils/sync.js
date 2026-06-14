// ═══════════════════════════════════════════════════════════
// 会话云同步层。打后端 /api/chat（走 client.js request，自动带 X-Admin-Key）。
// 策略：增量同步 + 消息级合并（mergeSessionLists），云端为唯一真相源。
//   pull()          挂载时拉增量并入本地
//   schedulePush()  收发后防抖推送单条会话
//   deleteRemote()  删除即写云端墓碑
//   syncAll()       全量对账（设置页"立即同步"）
// 失败（离线/无密钥）不抛给 UI 阻塞聊天，由调用方 catch 吞掉，下次再补。
// ═══════════════════════════════════════════════════════════

import { request } from '../api/client.js'
import { loadSessions, saveSessions, mergeSessionLists } from './sessions.js'

const LAST_SYNC = 'emet.chatSyncAt'

export function getLastSync() {
  return localStorage.getItem(LAST_SYNC) || ''
}
function setLastSync(t) {
  if (t) localStorage.setItem(LAST_SYNC, t)
}

// 拉取（增量）：合并服务端会话进本地。返回拉到的条数。
export async function pull() {
  const since = getLastSync()
  const data = await request('/api/chat', { params: since ? { since } : undefined })
  const incoming = data?.sessions || []
  if (incoming.length) saveSessions(mergeSessionLists(loadSessions(), incoming))
  if (data?.server_time) setLastSync(data.server_time)
  return incoming.length
}

// 推送单条会话（PUT，服务端也 merge），并把服务端合并结果并回本地。
export async function pushSession(session) {
  if (!session || !session.id) return
  const data = await request(`/api/chat/${session.id}`, { method: 'PUT', body: session })
  if (data?.item) saveSessions(mergeSessionLists(loadSessions(), [data.item]))
}

// 防抖推送：按会话 id 合并连续变更，fire 时读最新版本再推。
const _timers = new Map()
export function schedulePush(sessionId, delay = 1500) {
  if (!sessionId) return
  clearTimeout(_timers.get(sessionId))
  _timers.set(
    sessionId,
    setTimeout(() => {
      _timers.delete(sessionId)
      const s = loadSessions().find((x) => x.id === sessionId)
      if (s) pushSession(s).catch(() => {})
    }, delay),
  )
}

// 删除：写云端墓碑（后端 DELETE 标 deleted:true，不真删）。
export async function deleteRemote(id) {
  if (!id) return
  await request(`/api/chat/${id}`, { method: 'DELETE' })
}

// 全量对账：上传本地全部，服务端 merge 后回权威全量，再并回本地。返回总数。
export async function syncAll() {
  const local = loadSessions()
  const data = await request('/api/chat/sync', { method: 'POST', body: { sessions: local } })
  const incoming = data?.sessions || []
  const merged = mergeSessionLists(local, incoming)
  saveSessions(merged)
  if (data?.server_time) setLastSync(data.server_time)
  return merged.length
}
