// ═══════════════════════════════════════════════════════════
// Archive 档案云端同步：整包存取 GET/PUT /api/archive。
//
// 职责划分（与 worker 端约定一致）：
//   - 重数据 `data`（全部对话/项目/记忆/账号）只存云端，不进 localStorage
//     （localStorage 仅 ~5MB，大档案会溢出；云端 KV 上限 25MB）。
//   - 轻量的归类/置顶/重命名/隐藏 maps + 版本信息随同一个 blob 一起同步，
//     方便换设备时一并恢复；version 另在本地缓存一份用于即时显示。
//
// 合并策略：上传新导出包时按 uuid 增量合并（新覆盖同 uuid、旧独有保留），
//          由 Archive 组件在 handleFiles 里调用 mergeConversations，
//          合并后整包推送，worker 端纯覆盖。
//
// 鉴权：复用全局 X-Admin-Key（client.js）。无密钥时云端操作静默跳过，
//       Archive 退化为纯本地上传，不打扰用户。
// ═══════════════════════════════════════════════════════════

import { request, getAdminKey } from '../api/client.js'

const LS_VERSION = 'archive:version' // { importedAt, convCount }

// ── 版本信息本地缓存（用于打开页面时即时显示，不等云端）──
export function loadVersion() {
  try {
    const v = localStorage.getItem(LS_VERSION)
    return v ? JSON.parse(v) : null
  } catch {
    return null
  }
}

export function saveVersion(v) {
  try {
    if (v) localStorage.setItem(LS_VERSION, JSON.stringify(v))
    else localStorage.removeItem(LS_VERSION)
  } catch {
    /* 忽略 */
  }
}

// "2026.6.15" 形式
export function formatVersionDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`
}

// ── 按 uuid 增量合并对话：新覆盖同 uuid，旧独有保留，按 updated_at 倒序 ──
export function mergeConversations(oldList = [], newList = []) {
  const map = new Map()
  for (const c of oldList || []) if (c && c.uuid) map.set(c.uuid, c)
  for (const c of newList || []) if (c && c.uuid) map.set(c.uuid, c) // 新的覆盖同 uuid
  return [...map.values()].sort(
    (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0),
  )
}

// ── 拉取云端档案 blob：{ data, version, maps, updated_at } 或 null ──
export async function pullArchive() {
  if (!getAdminKey()) return null // 无密钥：纯本地模式，不打扰
  const res = await request('/api/archive', {})
  return res?.archive || null
}

// ── 推送（防抖）：data / maps / version 变化后调用 ──
let _timer = null
let _pending = null
export function schedulePushArchive(blob, delay = 1200) {
  _pending = blob
  clearTimeout(_timer)
  _timer = setTimeout(() => {
    const b = _pending
    _pending = null
    pushArchive(b).catch(() => {})
  }, delay)
}

export async function pushArchive(blob) {
  if (!getAdminKey()) return // 无密钥：跳过
  const body = { ...blob, updated_at: new Date().toISOString() }
  await request('/api/archive', { method: 'PUT', body })
}
