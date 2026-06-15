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
// 鉴权：复用全局 X-Admin-Key（client.js）。无密钥时云端操作跳过并出声提示，
//       Archive 退化为纯本地（刷新即丢，因 data 不进 localStorage）。
//
// 诊断：pull/push 全程 console 打点（前缀 [archiveSync]），失败不再静默吞掉——
//       推送失败会 toast，便于定位"上传后云端没存上"这类问题。
// ═══════════════════════════════════════════════════════════

import { request, getAdminKey } from '../api/client.js'
import { showToast } from './toast.js'

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
  if (!getAdminKey()) {
    console.warn('[archiveSync] pullArchive 跳过：未设置访问密钥（X-Admin-Key），档案为纯本地模式')
    return null
  }
  console.log('[archiveSync] pullArchive 调用中…')
  try {
    const res = await request('/api/archive', {})
    const blob = res?.archive || null
    console.log(
      '[archiveSync] pullArchive 返回：',
      blob ? `命中（${blob.data?.conversations?.length ?? 0} 条对话）` : '云端暂无档案（archive:data 不存在）',
    )
    return blob
  } catch (e) {
    // 401 已由 client.js 统一 toast，这里只记日志，避免重复打扰
    console.error('[archiveSync] pullArchive 失败：', e)
    return null
  }
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
    pushArchive(b).catch(() => {}) // 错误已在 pushArchive 内 toast + log
  }, delay)
}

export async function pushArchive(blob) {
  if (!getAdminKey()) {
    console.warn('[archiveSync] pushArchive 跳过：未设置访问密钥，无法保存到云端（刷新后本地数据会丢失）')
    showToast('未设置访问密钥，档案没存到云端')
    return
  }
  const body = { ...blob, updated_at: new Date().toISOString() }
  const convCount = body.data?.conversations?.length ?? 0
  // 体积自检：KV 单值上限 25MB，超了 PUT 必失败，提前给出可读提示
  let sizeMB = 0
  try {
    sizeMB = new Blob([JSON.stringify(body)]).size / (1024 * 1024)
  } catch {
    /* 忽略 */
  }
  console.log(`[archiveSync] pushArchive 调用中…（${convCount} 条对话，约 ${sizeMB.toFixed(2)}MB）`)
  if (sizeMB > 24) {
    console.error('[archiveSync] pushArchive 取消：体积超过 KV 25MB 上限')
    showToast(`档案过大（${sizeMB.toFixed(1)}MB），超出云端上限，未保存`)
    return
  }
  try {
    await request('/api/archive', { method: 'PUT', body })
    console.log('[archiveSync] pushArchive 成功，已保存到云端')
  } catch (e) {
    console.error('[archiveSync] pushArchive 失败：', e)
    showToast('档案云端保存失败：' + (e?.message || e))
  }
}
