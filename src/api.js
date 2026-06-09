// ════════════════════════════════════════════════════════
// 统一 API 层 —— 所有 v66 请求都走这里。
//
// v66 worker 的实际接口（已确认，见 worker.js handleAPIv2）：
//   GET /api/data   一把拉全部 { memories, moments, diaries, messages, handoffs, ideas, games }
//   GET /api/stats  统计
//   GET /api/memory/:id 等单条详情
// 没有 /api/xxx/list 列表路由、也没有 REST 语义搜索 —— 所以前端拉 /api/data
// 一次，本地筛选/排序/搜索。GET 全部免鉴权、CORS 全开，可直接跨域调。
// 写操作（二期）才需要 header X-Admin-Key。
// ════════════════════════════════════════════════════════

import { nowCST } from './utils/time.js'

export const BASE_URL = 'https://emet-memoty-v66.aandxiaobao.workers.dev'

function authHeaders() {
  // 读不需要；写（二期）需要 X-Admin-Key
  const key = localStorage.getItem('emet.adminKey')
  return key ? { 'X-Admin-Key': key } : {}
}

async function getJSON(path, params) {
  const url = new URL(BASE_URL + path)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') url.searchParams.set(k, v)
    }
  }
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json()
}

// ── 写操作需要 X-Admin-Key（密码，第一期先用浏览器 prompt 存本地）──
// 之后会挪到设置页。401 时清掉重新问。
export function ensureAdminKey() {
  let key = localStorage.getItem('emet.adminKey')
  if (!key) {
    key = window.prompt('记忆库密码（写操作需要，只存在本机）')
    if (key) localStorage.setItem('emet.adminKey', key.trim())
  }
  return localStorage.getItem('emet.adminKey')
}

async function writeJSON(method, path, body) {
  const key = ensureAdminKey()
  if (!key) throw new Error('需要密码')
  const res = await fetch(BASE_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
    body: JSON.stringify(body),
  })
  if (res.status === 401) {
    localStorage.removeItem('emet.adminKey')
    throw new Error('密码错误，请重试')
  }
  if (res.status === 423) throw new Error('条目已锁定，需先解锁')
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  invalidateData() // 写完让缓存失效，下次读最新
  return res.json()
}

// ── /api/data 缓存（同一次会话里多页共享一次请求）────────
let _dataPromise = null
export function getData(force = false) {
  if (force) _dataPromise = null
  if (!_dataPromise) {
    _dataPromise = getJSON('/api/data').catch((e) => {
      _dataPromise = null // 失败不缓存，下次可重试
      throw e
    })
  }
  return _dataPromise
}
export function invalidateData() {
  _dataPromise = null
}

// ── 归一化：把后端记忆对象转成前端用的形状 ───────────────
// importance 后端是 1-10，卡片用 5 个圆点显示 → 折半（rawImportance 保留原值给详情滑块）。
// 旧分类做兼容映射（沿用旧前端 transformAPIData）。
const LEGACY_CAT = { daily: 'semantic', event: 'scene', preference: 'semantic', other: 'semantic' }

export function normMemory(m) {
  let cat = m.category || 'semantic'
  if (LEGACY_CAT[cat]) cat = LEGACY_CAT[cat]
  const raw = m.importance || 5
  return {
    id: m.id,
    category: cat,
    importance: Math.max(1, Math.min(5, Math.round(raw / 2))),
    rawImportance: raw,
    arousal: m.arousal == null ? 0.5 : m.arousal,
    valence: m.valence == null ? 0 : m.valence,
    content: m.content || '',
    tags: Array.isArray(m.tags) ? m.tags : [],
    linked: Array.isArray(m.linked) ? m.linked : [],
    linkRel: m.link_rel || {},
    pinned: !!m.pinned,
    locked: !!m.locked,
    date: (m.created_at || '').slice(0, 10),
    activations: m.activations || 0,
    created_at: m.created_at || '',
  }
}

function byCreatedDesc(a, b) {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
}

function sortMemories(list, sort) {
  const copy = [...list]
  if (sort === 'importance') copy.sort((a, b) => b.rawImportance - a.rawImportance)
  else copy.sort(byCreatedDesc) // recent
  return copy
}

// ── 记忆 ─────────────────────────────────────────────────
export async function memoryList({ category = 'all', sort = 'recent', limit = 300 } = {}) {
  const data = await getData()
  let list = (data.memories || []).map(normMemory)
  if (category && category !== 'all') list = list.filter((m) => m.category === category)
  return { items: sortMemories(list, sort).slice(0, limit) }
}

export async function memorySearch({ query, category = 'all' } = {}) {
  const data = await getData()
  let list = (data.memories || []).map(normMemory)
  if (category && category !== 'all') list = list.filter((m) => m.category === category)
  const q = (query || '').trim().toLowerCase()
  if (q) {
    list = list.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }
  return { items: sortMemories(list, 'recent') }
}

// 全部记忆（归一化），记忆页一次拉取后本地筛选/排序/统计/按月。
export async function memoryAll() {
  const data = await getData()
  return (data.memories || []).map(normMemory)
}

// 单条记忆（含 linked/link_rel）——从已缓存的 /api/data 里取，避免多余请求。
export async function memoryGet(id) {
  const list = await memoryAll()
  return list.find((m) => m.id === id) || null
}

// 各分类数量统计 { all, core, scene, ... }
export function countByCategory(list) {
  const counts = { all: list.length }
  for (const m of list) counts[m.category] = (counts[m.category] || 0) + 1
  return counts
}

// 更新一条记忆（content/category/importance/arousal/valence/pinned/tags/linked）
export function memoryUpdate(id, patch) {
  return writeJSON('PUT', `/api/memory/${id}`, patch)
}

// 织藤 / 拆藤（双向，后端 memory_link / memory_unlink 处理两头）
export function memoryLink(fromId, toId, relation) {
  return writeJSON('POST', '/api/link', { from_id: fromId, to_id: toId, relation })
}
export function memoryUnlink(fromId, toId) {
  return writeJSON('POST', '/api/unlink', { from_id: fromId, to_id: toId })
}

// 星图数据：/api/viz-data 返回带 2D 坐标(x,y∈[-1,1])的节点。单独缓存。
let _vizPromise = null
export function vizData(force = false) {
  if (force) _vizPromise = null
  if (!_vizPromise) {
    _vizPromise = getJSON('/api/viz-data').catch((e) => {
      _vizPromise = null
      throw e
    })
  }
  return _vizPromise
}

// 新建记忆。后端 memory_save：tags 传逗号分隔字符串。
export function memoryCreate({ content, category, importance, arousal, valence, tags }) {
  return writeJSON('POST', '/api/memory', {
    content,
    category,
    importance,
    arousal,
    valence,
    tags: Array.isArray(tags) ? tags.join(',') : tags || '',
  })
}

// ── 主页摘要：一次 /api/data 算出 whisper + 各项计数 ──────
export async function homeSummary() {
  const d = await getData()
  const messages = d.messages || []
  const diaries = d.diaries || []
  const ym = monthKeyCST()

  const monthMessages = messages.filter((m) => (m.created_at || '').slice(0, 7) === ym).length
  const emetMsgs = messages.filter((m) => m.from === 'emet').sort(byCreatedDesc)

  return {
    whisper: emetMsgs[0]?.content || '',
    counts: {
      memory: (d.memories || []).length,
      moment: (d.moments || []).length,
      diary: diaries.filter((x) => x.author !== 'story').length,
      story: diaries.filter((x) => x.author === 'story').length,
      letter: (d.handoffs || []).length,
      game: (d.games || []).length,
      monthMessages,
    },
  }
}

function monthKeyCST() {
  const d = nowCST()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
