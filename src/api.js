// ════════════════════════════════════════════════════════
// 统一 API 层 —— 所有 v66 请求都走这里。
//
// v66 worker 的实际接口（已确认，见 worker.js handleAPIv2）：
//   GET /api/data   一把拉全部 { memories, moments, diaries, messages, handoffs, ideas, games }
//   GET /api/stats  统计
//   GET /api/memory/:id 等单条详情
// 没有 /api/xxx/list 列表路由、也没有 REST 语义搜索 —— 所以前端拉 /api/data
// 一次，本地筛选/排序/搜索。
// 后端已安全加固：所有 /api/* 请求（含 GET）都必须带 X-Admin-Key，否则 401。
// 实际请求统一经 ./api/client.js 发出（自动附加密钥 + 统一 401 处理）。
// ════════════════════════════════════════════════════════

import { nowCST } from './utils/time.js'
import { loadAssistant } from './utils/assistant.js'
import { smartSearch } from './utils/search.js'
import { BASE_URL, request } from './api/client.js'

// BASE_URL 现在定义在统一请求模块 client.js，这里再导出一次，兼容旧引用
export { BASE_URL }

// ── 读：统一走 client.request（自动带 X-Admin-Key + 统一 401 处理）──
function getJSON(path, params) {
  return request(path, { params })
}

// ── 写（PUT/POST/DELETE）：同样走 client.request ──
// 401 由 client 统一处理（清密钥 + 友好提示）；423 = 条目已锁定。
async function writeJSON(method, path, body) {
  let json
  try {
    json = await request(path, { method, body })
  } catch (e) {
    if (e.status === 423) throw new Error('条目已锁定，需先解锁')
    throw e
  }
  invalidateData() // 写完让缓存失效，下次读最新
  return json
}

// ── 本地持久缓存（localStorage）────────────────────────────
// 目的：冷启动/重开 App 时先用上次的数据秒显示，再后台刷新（stale-while-revalidate）。
// 存不下（配额满/隐私模式）一律静默跳过，绝不影响使用。私密数据只存本机。
const DATA_CACHE_KEY = 'emet.cache.data.v1'
const VIZ_CACHE_KEY = 'emet.cache.viz.v1'

function readCache(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const obj = JSON.parse(raw)
    return obj && obj.data !== undefined ? obj.data : null
  } catch {
    return null
  }
}
function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ v: 1, at: new Date().toISOString(), data }))
  } catch {
    // 配额满/隐私模式：跳过持久化，内存缓存仍在，功能不受影响
  }
}
function clearPersistCache() {
  try {
    localStorage.removeItem(DATA_CACHE_KEY)
    localStorage.removeItem(VIZ_CACHE_KEY)
  } catch {
    /* 忽略 */
  }
}

// 后台刷新落地后通知：页面可 subscribeData 订阅，在当前画面自动更新到最新。
// 没有订阅者也不影响——内存缓存已更新，下次切页/重开自然是最新。
const _dataSubs = new Set()
export function subscribeData(cb) {
  _dataSubs.add(cb)
  return () => _dataSubs.delete(cb)
}
function emitDataUpdate() {
  _dataSubs.forEach((cb) => {
    try {
      cb()
    } catch {
      /* 单个订阅者出错不影响其它 */
    }
  })
}

// ── /api/data 缓存（内存 + 本地持久，stale-while-revalidate）──
let _dataPromise = null
let _dataRevalidating = false

function fetchData() {
  return getJSON('/api/data')
    .then((d) => {
      writeCache(DATA_CACHE_KEY, d)
      return d
    })
    .catch((e) => {
      _dataPromise = null // 失败不缓存，下次可重试
      throw e
    })
}

// 后台静默刷新：成功则更新本地+内存并通知；失败继续用缓存；401 清掉本地私密缓存
function revalidateData() {
  if (_dataRevalidating) return
  _dataRevalidating = true
  getJSON('/api/data')
    .then((d) => {
      writeCache(DATA_CACHE_KEY, d)
      _dataPromise = Promise.resolve(d)
      emitDataUpdate()
    })
    .catch((e) => {
      if (e && e.status === 401) clearPersistCache()
    })
    .finally(() => {
      _dataRevalidating = false
    })
}

export function getData(force = false) {
  if (force) _dataPromise = null
  if (!_dataPromise) {
    const cached = force ? null : readCache(DATA_CACHE_KEY)
    if (cached) {
      _dataPromise = Promise.resolve(cached) // 秒显示缓存
      revalidateData() // 后台刷新最新
    } else {
      _dataPromise = fetchData() // 无缓存：正常走网络
    }
  }
  return _dataPromise
}
export function invalidateData() {
  _dataPromise = null
  _vizPromise = null // 星图缓存一并失效：连藤/拆藤后再进星图能看到最新（修 Bug 2）
  clearPersistCache() // 写后清本地缓存，强制下次走网络，避免看到写前的旧数据
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
    updated_at: m.updated_at || m.created_at || '',
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

// 走 smartSearch（关键词分词+三维加权）。withLinked=true 时把命中条目的藤蔓另一头也带出（弱分排在直接命中之后）。
// 空查询沿用旧逻辑（按 recent 排），保持浏览态行为不变。
export async function memorySearch({ query, category = 'all', withLinked = false } = {}) {
  const data = await getData()
  let list = (data.memories || []).map(normMemory)
  if (category && category !== 'all') list = list.filter((m) => m.category === category)
  const q = (query || '').trim()
  if (!q) return { items: sortMemories(list, 'recent') }
  return { items: smartSearch(list, q, { withLinked }) }
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

// 删除一条记忆（锁定的后端会 423 拒绝）
export function memoryDelete(id) {
  return writeJSON('DELETE', `/api/memory/${id}`)
}

// 类型互转（记忆/瞬记/日记/故事/便条/想法），后端 move_item 搬 KV
export function memoryMove(id, fromType, toType) {
  return writeJSON('POST', '/api/move', { id, from_type: fromType, to_type: toType })
}

// 织藤 / 拆藤（双向，后端 memory_link / memory_unlink 处理两头）
export function memoryLink(fromId, toId, relation) {
  return writeJSON('POST', '/api/link', { from_id: fromId, to_id: toId, relation })
}
export function memoryUnlink(fromId, toId) {
  return writeJSON('POST', '/api/unlink', { from_id: fromId, to_id: toId })
}

// 星图数据：/api/viz-data 返回带 2D 坐标(x,y∈[-1,1])的节点。单独缓存（同 data 走 SWR）。
let _vizPromise = null
let _vizRevalidating = false

function fetchViz() {
  return getJSON('/api/viz-data')
    .then((d) => {
      writeCache(VIZ_CACHE_KEY, d)
      return d
    })
    .catch((e) => {
      _vizPromise = null
      throw e
    })
}
function revalidateViz() {
  if (_vizRevalidating) return
  _vizRevalidating = true
  getJSON('/api/viz-data')
    .then((d) => {
      writeCache(VIZ_CACHE_KEY, d)
      _vizPromise = Promise.resolve(d)
      emitDataUpdate()
    })
    .catch((e) => {
      if (e && e.status === 401) clearPersistCache()
    })
    .finally(() => {
      _vizRevalidating = false
    })
}

export function vizData(force = false) {
  if (force) _vizPromise = null
  if (!_vizPromise) {
    const cached = force ? null : readCache(VIZ_CACHE_KEY)
    if (cached) {
      _vizPromise = Promise.resolve(cached)
      revalidateViz()
    } else {
      _vizPromise = fetchViz()
    }
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

// ── 日记 CRUD（与 memory 同套模式）─────────────────────────
export function diaryCreate(payload) {
  return writeJSON('POST', '/api/diary', payload)
}
export function diaryUpdate(id, patch) {
  return writeJSON('PUT', `/api/diary/${id}`, patch)
}
export function diaryDelete(id) {
  return writeJSON('DELETE', `/api/diary/${id}`)
}

// ── 瞬记 CRUD ──────────────────────────────────────────────
export function momentCreate(payload) {
  return writeJSON('POST', '/api/moment', payload)
}
export function momentUpdate(id, patch) {
  return writeJSON('PUT', `/api/moment/${id}`, patch)
}
export function momentDelete(id) {
  return writeJSON('DELETE', `/api/moment/${id}`)
}

// ── 年轮：瞬记 / 日记（一期第 5 步）──────────────────────
export async function momentAll() {
  const data = await getData()
  return [...(data.moments || [])].sort(byCreatedDesc)
}

// 日记展示日期优先 diary_date（补写的日记 created_at 是补写时间，不是日记当天）
export function diaryDate(d) {
  return d.diary_date || (d.created_at || '').slice(0, 10)
}

export async function diaryAll() {
  const data = await getData()
  return [...(data.diaries || [])].sort((a, b) => {
    const da = diaryDate(a)
    const db = diaryDate(b)
    return da < db ? 1 : da > db ? -1 : byCreatedDesc(a, b)
  })
}

export async function diaryGet(id) {
  const list = await diaryAll()
  return list.find((d) => d.id === id) || null
}

// ── 留言板 / 灵感板（一期第 6 步，写入走 X-Admin-Key）────
export async function messageAll() {
  const data = await getData()
  return [...(data.messages || [])].sort(byCreatedDesc)
}

// 后端 message_leave：不传 from/to 会默认成 emet→yomi，前端发的一律 yomi→emet
export function messageLeave(content) {
  return writeJSON('POST', '/api/message', { content, from: 'yomi', to: 'emet' })
}

export async function ideaAll() {
  const data = await getData()
  return [...(data.ideas || [])].sort(byCreatedDesc)
}

// ── 信件：交接信 / 日常信，共用 handoffs 表 用 kind 区分 ──
// 字段: id / title / content / kind ('handoff'|'daily') / created_at / locked / window_from
// 旧版若没存 kind，按 'handoff' 兜底（迁移前的数据都是交接信）。
export async function letterAll() {
  const data = await getData()
  return [...(data.handoffs || [])]
    .map((h) => ({
      id: h.id,
      title: h.title || (h.window_from ? `交接信 · ${h.window_from}` : '交接信'),
      content: h.content || '',
      kind: h.kind || 'handoff',
      created_at: h.created_at || '',
      locked: !!h.locked,
      window_from: h.window_from || '',
    }))
    .sort(byCreatedDesc)
}

// 后端 idea_save：tags 传逗号分隔字符串（同 memory_save）
export function ideaCreate({ content, tags }) {
  return writeJSON('POST', '/api/idea', {
    content,
    tags: Array.isArray(tags) ? tags.join(',') : tags || '',
  })
}

export function ideaDelete(id) {
  return writeJSON('DELETE', `/api/idea/${id}`)
}

// ── 聊天（三期）：简单版 system prompt ────────────────────
// 最近 10 条记忆 + 最近 3 篇日记摘要 + 当前东八区时间。
export async function chatSystemPrompt() {
  // /api/data 与 /api/health/context 并行，省一个串行 RTT
  const [d, healthLine] = await Promise.all([getData(), healthContext()])
  const mems = [...(d.memories || [])].sort(byCreatedDesc).slice(0, 10)
  const diaries = [...(d.diaries || [])]
    .filter((x) => x.author !== 'story')
    .sort(byCreatedDesc)
    .slice(0, 3)

  const now = nowCST()
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const timeStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${weekdays[now.getDay()]} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  const memLines = mems
    .map((m) => `- ${(m.content || '').replace(/\s+/g, ' ').slice(0, 120)}`)
    .join('\n')
  const diaryLines = diaries
    .map((x) => `- ${x.title || x.diary_date || ''}：${(x.content || '').replace(/\s+/g, ' ').slice(0, 100)}…`)
    .join('\n')

  // 分段供 prompt caching：稳定段（人设）+ 准静态段（记忆/日记）可打缓存断点；
  // 易变段（时间/身体状态）放最后、绝不缓存，否则每轮变动会作废整个缓存前缀。
  // 返回对象，由 streamAnthropic 据此拼 cache_control 块；旧的纯字符串用法仍兼容。
  const stable = loadAssistant().systemPrompt
  const semi = ['【最近的记忆】', memLines || '（暂无）', '', '【最近的日记摘要】', diaryLines || '（暂无）'].join('\n')
  const volatile = [`当前时间（东八区）：${timeStr}`, ...(healthLine ? ['', '【身体状态】', healthLine] : [])].join('\n')
  return { stable, semi, volatile }
}

// ── 健康数据（Apple Watch via iOS 快捷指令上报）─────────
// 路由失败一律静默，不影响主页/聊天
export async function healthLatest() {
  try {
    const r = await getJSON('/api/health/latest')
    return r?.record || null
  } catch { return null }
}

export async function healthContext() {
  try {
    const r = await getJSON('/api/health/context')
    return r?.context || ''
  } catch { return '' }
}

// ── 设置页（一期第 7 步）─────────────────────────────────
export function healthCheck() {
  return getJSON('/health') // { status:'ok', version:'6.8.2', timestamp }
}

export function statsGet() {
  return getJSON('/api/stats') // { total_memories, total_moments, ... }
}

export function backupExport() {
  return getJSON('/api/backup') // 全量数据 JSON，前端转 Blob 下载
}

// ── Web Push（阶段 0 / 见 docs/阶段0-web-push.md）─────────
export function pushVapidKey() {
  return getJSON('/api/push/vapid-public-key') // { publicKey }
}
export function pushSubscribe(sub) {
  return writeJSON('POST', '/api/push/subscribe', sub) // body=PushSubscription JSON
}
export function pushUnsubscribe() {
  return writeJSON('DELETE', '/api/push/subscribe')
}
export function pushSend(payload) {
  return writeJSON('POST', '/api/push/send', payload) // { title, body, url?, source? }
}
export function pushLatest() {
  return getJSON('/api/push/latest') // { notification }；SW 主要用，前端可调试
}

// ── 心跳系统（阶段 4 / 见 docs/阶段4-心跳系统.md）─────────
// 默认 enabled=false，前端开关显式开启
export function heartbeatConfigGet() {
  return getJSON('/api/config/heartbeat') // { config: { enabled, cooldown_min } }
}
export function heartbeatConfigSet(cfg) {
  return writeJSON('POST', '/api/config/heartbeat', cfg)
}

// ── 自动笔记（每天 22:30 cron 兜底写一篇当日观察）──
export function dailyConfigGet() {
  return getJSON('/api/config/daily') // { config: { enabled } }
}
export function dailyConfigSet(cfg) {
  return writeJSON('POST', '/api/config/daily', cfg)
}

// ── 凌晨守护（iOS app 事件触发，凌晨时段催睡）──
export function nightGuardConfigGet() {
  return getJSON('/api/config/night-guard') // { config: { enabled, start, end, monitor_apps, cooldown_min } }
}
export function nightGuardConfigSet(cfg) {
  return writeJSON('POST', '/api/config/night-guard', cfg)
}

// ── 心情日历（静怡 who=yomi 走前端，Emet who=emet 走 MCP）──
export function moodList({ start, end } = {}) {
  return getJSON('/api/mood', { start, end }) // { moods: [{ date, who, mood, note, valence }] }
}
export function moodSet({ mood, note, who = 'yomi', date }) {
  // 不走 writeJSON（它会清 /api/data 缓存，心情跟 data 无关，没必要）
  return request('/api/mood', { method: 'POST', body: { mood, note, who, date } })
}

// ── 主页摘要：一次 /api/data 算出 whisper + 各项计数 ──────
export async function homeSummary() {
  const d = await getData()
  const messages = d.messages || []
  const diaries = d.diaries || []
  const moments = [...(d.moments || [])].sort(byCreatedDesc)
  const ym = monthKeyCST()

  const monthMessages = messages.filter((m) => (m.created_at || '').slice(0, 7) === ym).length

  // whisper：moments 里带 #whisper 标签的最新一条；没有则空（前端用占位文案）
  const whisperM = moments.find((m) => (m.tags || []).includes('whisper'))

  // 睡眠：moments 里带 #睡眠 标签的最新一条，解析"X 小时/h"；解析不出就原文截断
  const sleepM = moments.find((m) => (m.tags || []).includes('睡眠'))
  let sleep = null
  if (sleepM) {
    const t = sleepM.content || ''
    const hm = t.match(/(\d+(?:\.\d+)?)\s*(?:个?小时|h)/i)
    sleep = hm ? `${hm[1]} 小时` : t.replace(/\s+/g, ' ').slice(0, 10)
  }

  return {
    whisper: whisperM?.content || '',
    sleep,
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
