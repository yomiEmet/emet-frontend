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

import { nowCST, logicalDayKey, nowLogical } from './utils/time.js'
import { loadAssistant } from './utils/assistant.js'
import { smartSearch } from './utils/search.js'
import { BASE_URL, request, getAdminKey } from './api/client.js'

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

// 数据涨到 1000+ 条时，一把拉全部会撞 Worker 单次调用 1000 子请求上限 → 后端 1101 崩。
// 改为 7 类各拉一次（后端 ?only=<类>），每次独立 Worker 调用各有独立额度，再合并成
// 老的 { memories, moments, ... } 形状——前端其它地方无感。
const DATA_TYPES = ['memories', 'moments', 'diaries', 'messages', 'handoffs', 'ideas', 'games']

function loadAllData() {
  return Promise.all(
    DATA_TYPES.map((t) =>
      getJSON('/api/data?only=' + t).then(
        (r) => [t, r[t] || [], null],
        (err) => [t, null, err], // 单类失败先记 null + 原始错误，下面判断整体成败
      ),
    ),
  ).then((pairs) => {
    const d = {}
    let firstErr = null
    for (const [t, v, err] of pairs) {
      if (v == null && !firstErr) firstErr = err
      d[t] = v || []
    }
    // 有任一类彻底失败就当整体失败（不写半截缓存，避免"部分空白"假象）。
    // 透传首个真实错误的 status，页面才能说清是"密钥不对"还是"后端出错"（而非笼统的"没拉全"）
    if (firstErr !== null || pairs.some(([, v]) => v == null)) {
      const e = new Error(firstErr?.message || '部分数据加载失败')
      e.partial = true
      if (firstErr?.status) e.status = firstErr.status
      throw e
    }
    return d
  })
}

function fetchData() {
  return loadAllData()
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
  loadAllData()
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
    // 逻辑日归属：凌晨 0-4 点写的记忆算前一天，且修掉旧 slice(0,10) 按 UTC 切、
    // 东八区 0-8 点整体偏一天的老毛病
    date: m.created_at ? logicalDayKey(m.created_at) : '',
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
// 瞬记语义搜索（Recall 同款向量检索，layer=moment）：返回 { results: [{id,...}] }
export function momentSearch(query, n = 12) {
  return writeJSON('POST', '/api/mem2/moment-search', { query, n })
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

// ── 动态流（二期 2-1）：独立游标分页接口，不进 /api/data 缓存 ──
// 写操作走 request 而非 writeJSON：动态与 /api/data 无关，别清它的缓存（同 moodSet 理由）
export function feedList({ before, limit = 20 } = {}) {
  return getJSON('/api/feed', { before, limit }) // { items, next_before, server_time }
}
// images: [{ data: base64, media_type }]（≤3 张，compressImage 压过再传）；不带图时字段省略
export function feedCreate(content, images) {
  return request('/api/feed', {
    method: 'POST',
    body: {
      content,
      author: 'yomi',
      source: 'manual',
      ...(Array.isArray(images) && images.length ? { images } : {}),
    },
  })
}
// 注：图片直链 feedImageUrl/chatImageUrl 已于 2026-08-02 退役——密钥进 URL 会渗进
// 浏览器历史/DOM/日志。改用 components/AuthImg.jsx：fetch 带 X-Admin-Key 头 → blob URL。
// worker 端两种鉴权都认（checkMcpAuth：头或 ?key=），故后端无需改动。
// 动态回应（朋友圈化）：Emet 延迟路过点赞/评论的总开关，config 路由与独处/做梦同款
export function feedReactConfigGet() {
  return getJSON('/api/config/feed-react') // { config: { enabled, model } }
}
export function feedReactConfigSet(cfg) {
  return request('/api/config/feed-react', { method: 'POST', body: cfg })
}
export function feedUpdate(id, content) {
  return request(`/api/feed/${id}`, { method: 'PUT', body: { content } })
}
export function feedDelete(id) {
  return request(`/api/feed/${id}`, { method: 'DELETE' })
}
export function feedLike(id, who = 'yomi') {
  return request(`/api/feed/${id}/like`, { method: 'POST', body: { who } }) // 切换式：再点=取消
}
export function feedComment(id, content, author = 'yomi') {
  return request(`/api/feed/${id}/comment`, { method: 'POST', body: { author, content } })
}
export function feedCommentDelete(id, cid) {
  return request(`/api/feed/${id}/comment/${cid}`, { method: 'DELETE' })
}

// ── 自动化控制台：各自动化的 prompt 模板/渠道/模型（/automations 页）──
export function autopromptGet() {
  return getJSON('/api/autoprompt') // { config, defs }
}
export function autopromptSet(body) {
  return request('/api/autoprompt', { method: 'POST', body }) // { task, providerId?, model?, prompt? }，空串=清除
}

// ── 聊天图片（发消息带图）：先传图拿 id，消息体只存 id 引用 ──
// images: [{ data: base64, media_type }]（≤3、compressImage 压过）→ { ids }
export function chatImageUpload(images) {
  return request('/api/chat-image', { method: 'POST', body: { images } })
}

// ── 留言/灵感/信件的编辑与删除（worker 路由早已就绪，纯前端补齐）──
// restPut 白名单外的字段会被忽略；423 = 已锁定，writeJSON 统一提示
export function messageUpdate(id, patch) {
  return writeJSON('PUT', `/api/message/${id}`, patch)
}

export function messageDelete(id) {
  return writeJSON('DELETE', `/api/message/${id}`)
}

// PUT /api/idea 的 tags 传数组或逗号串都行（restPut 两种都归一化）
export function ideaUpdate(id, patch) {
  return writeJSON('PUT', `/api/idea/${id}`, patch)
}

// 新建信件——旧版 v6.8.2 信件 tab FAB 的功能，React 迁移时漏掉的补齐
export function letterCreate({ title, content, kind = 'daily' }) {
  return writeJSON('POST', '/api/letter', { title, content, kind })
}

// 信件编辑走 handoff 路由（与旧版一致，信件存 handoffs 表）
export function letterUpdate(id, patch) {
  return writeJSON('PUT', `/api/handoff/${id}`, patch)
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
  const volatile = [
    `当前时间（东八区）：${timeStr}`,
    ...(healthLine ? ['', '【身体状态】', healthLine] : []),
    ...todoLines(),
    ...annivLines(),
  ].join('\n')
  return { stable, semi, volatile }
}

// 纪念日注入（4-3）：只读、只进 volatile 段（缓存纪律同 todoLines）。
// 基于 emet.milestones，按周年（MM-DD）计算；开关 emet.anniv={enabled,advanceDays} 默认关。
// 不做贺卡弹窗——就在动态区注入一行日历备忘录式提醒。
function annivLines() {
  try {
    const cfg = JSON.parse(localStorage.getItem('emet.anniv') || 'null')
    if (!cfg?.enabled) return []
    const advance = Number.isInteger(cfg.advanceDays) ? cfg.advanceDays : 3
    const saved = JSON.parse(localStorage.getItem('emet.milestones') || 'null')
    const items = saved?.items || []
    if (!items.length) return []
    const today = nowLogical() // 东八区 + 4 点逻辑日
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    const hits = []
    for (const it of items) {
      if (!it?.name || !it?.date) continue
      const [, m, d] = it.date.split('-').map(Number)
      if (!m || !d) continue
      // 下一次周年：今年的 MM-DD；已过则明年
      let occ = new Date(today.getFullYear(), m - 1, d).getTime()
      if (occ < t0) occ = new Date(today.getFullYear() + 1, m - 1, d).getTime()
      const days = Math.round((occ - t0) / 86400000)
      if (days === 0) hits.push(`- 今天是 ${it.name} 纪念日`)
      else if (days <= advance) hits.push(`- 还有 ${days} 天是 ${it.name} 纪念日`)
    }
    if (!hits.length) return []
    return ['', '【纪念日】', ...hits, '（话题合适时可以自然提一句，不必刻意；不做仪式感的贺卡。）']
  } catch {
    return []
  }
}

// 待办注入（只读）：主页待办的未完成项，最多 10 条。
// 必须待在 volatile 段——它在全部缓存断点之后，勾选/增删待办不会作废任何缓存前缀；
// 千万别挪进 semi（会连坐作废 semi/summary/BP4 三段缓存）。
// 模型没有写权限：提醒靠看见，增删改仍全部由静怡手动操作（拍板决定）。
function todoLines() {
  try {
    const saved = JSON.parse(localStorage.getItem('emet.todos') || 'null')
    const open = (saved?.items || []).filter((t) => t && t.text && !t.done).slice(0, 10)
    if (!open.length) return []
    const lines = open.map((t) => {
      let age = ''
      if (t.created_at) {
        const days = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000)
        if (days >= 1) age = `（已挂 ${days} 天）`
      }
      return `- ${t.text}${age}`
    })
    return ['', '【静怡的待办清单】', ...lines, '（话题合适时可以自然提醒她，不必每轮都提；你没有修改待办的权限。）']
  } catch {
    return []
  }
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

// ── 缓存保活（worker 定时重放请求快照，续期 prompt cache）──
// 不走 writeJSON：与 /api/data 无关，别清它的缓存
export function keepaliveConfigGet() {
  return getJSON('/api/config/keepalive') // { config: { enabled } }
}
export function keepaliveConfigSet(cfg) {
  return request('/api/config/keepalive', { method: 'POST', body: cfg })
}
export function keepaliveStatusGet() {
  return getJSON('/api/keepalive/status') // { config, paused, lastBeat, snapshot, today, recent }
}

// ── Paramecium 记忆网关（L0 原文存档 + L1 摘录 + 目录注入）──
// 注入走独立 fetch 不走 request()：要 5 秒硬超时，失败降级为不注入、绝不拦聊天
export async function memInject(context, echo) {
  const res = await fetch(BASE_URL + '/api/mem2/inject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': getAdminKey() },
    body: JSON.stringify({ context, echo }),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error('inject ' + res.status)
  return res.json() // { injection, hits, echo_hits, token_estimate }
}
export function mem2StatusGet() {
  return getJSON('/api/mem2/status') // { windows, raw_rows, l1_memories, dirty_pending, archived_convs, last_run }
}
export function extractionConfigGet() {
  return getJSON('/api/config/extraction') // { config: { enabled, model } }
}
export function extractionConfigSet(cfg) {
  return request('/api/config/extraction', { method: 'POST', body: cfg })
}
export function mem2ExtractsGet(limit = 20) {
  return getJSON('/api/mem2/extracts', { limit }) // { extracts: [{ id, content, quote, date, conv_id, ... }] }
}
export function mem2ExtractBackfill() {
  return request('/api/mem2/extract-backfill', { method: 'POST' })
}

// ── 自动笔记（每天 22:30 cron 兜底写一篇当日观察）──
export function dailyConfigGet() {
  return getJSON('/api/config/daily') // { config: { enabled } }
}
export function dailyConfigSet(cfg) {
  return writeJSON('POST', '/api/config/daily', cfg)
}

// ── 共读书架（三期）──────────────────────────────────
export function bookList() {
  return getJSON('/api/books') // { books:[{id,title,author,chapter_count,bookmark}] }
}
export function bookCreate({ title, author }) {
  return request('/api/books', { method: 'POST', body: { title, author } })
}
export function bookDelete(id) {
  return request(`/api/books/${id}`, { method: 'DELETE' })
}
export function bookMeta(id) {
  return getJSON(`/api/books/${id}/meta`) // { book, chapters:[{idx,title}], bookmark }
}
export function bookChapterUpload(id, { idx, title, text }) {
  return request(`/api/books/${id}/chapter`, { method: 'POST', body: { idx, title, text } })
}
export function bookChapter(id, idx) {
  return getJSON(`/api/books/${id}/chapter/${idx}`) // { chapter:{idx,title,text} }
}
export function bookAnnotations(id) {
  return getJSON(`/api/books/${id}/annotations`) // { annotations:[...] }
}
export function bookAnnotate(id, { chapter_idx, start, end, quote, note, color, author = 'yomi' }) {
  return request(`/api/books/${id}/annotations`, { method: 'POST', body: { chapter_idx, start, end, quote, note, color, author } })
}
export function bookAnnotationDelete(id, annoId) {
  return request(`/api/books/${id}/annotations/${annoId}`, { method: 'DELETE' })
}
export function bookmarkGet(id) {
  return getJSON(`/api/books/${id}/bookmark`) // { bookmark }
}
export function bookmarkSet(id, { chapter_idx, offset }) {
  return request(`/api/books/${id}/bookmark`, { method: 'PUT', body: { chapter_idx, offset } })
}

// ── 今日小票（四期 4-1）：按 4 点逻辑日一张，双端可记 ──
export function receiptList(date) {
  return getJSON('/api/receipt', date ? { date } : undefined) // { day, items:[{id,text,added_by,created_at}] }
}
export function receiptAdd(text, date) {
  return request('/api/receipt', { method: 'POST', body: { text, added_by: 'yomi', date } })
}
export function receiptDelete(day, itemId) {
  return request(`/api/receipt/${day}/${itemId}`, { method: 'DELETE' })
}

// ── 经期月历（四期 4-2）：统计口径由后端一份实现，前端只读 stats ──
export function periodList() {
  return getJSON('/api/period') // { logs:[{start_date,end_date,note,...}], stats:{...} }
}
export function periodSave({ start_date, end_date, note }) {
  return request('/api/period', { method: 'POST', body: { start_date, end_date, note } })
}
export function periodDelete(startDate) {
  return request(`/api/period/${startDate}`, { method: 'DELETE' })
}

// ── 独处时间（二期 2-2）+ 做梦（2-3）：开关默认关，config 路由与心跳同款 ──
export function idleConfigGet() {
  return getJSON('/api/config/idle') // { config: { enabled, windows, daily_max, model } }
}
export function idleConfigSet(cfg) {
  return request('/api/config/idle', { method: 'POST', body: cfg })
}
export function dreamConfigGet() {
  return getJSON('/api/config/dream') // { config: { enabled, push, model } }
}
export function dreamConfigSet(cfg) {
  return request('/api/config/dream', { method: 'POST', body: cfg })
}
// 独处手账：游标分页（before 传上一页最后一条 ts）
export function idleLogList({ before, limit = 30 } = {}) {
  return getJSON('/api/idle/log', { before, limit }) // { entries, next_before }
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
export function moodSet({ mood, level, note, who = 'yomi', date }) {
  // 不走 writeJSON（它会清 /api/data 缓存，心情跟 data 无关，没必要）
  // level(1-7 愉悦度) 与 mood(具名) 二选一；静怡新版发 level，Emet/旧数据发 mood。
  return request('/api/mood', { method: 'POST', body: { mood, level, note, who, date } })
}

// ── 情绪：当下感受，一天可多条带时间（区别于 mood 每天一条整体心情）──
export function emotionList({ start, end } = {}) {
  return getJSON('/api/emotion', { start, end }) // { emotions: [{id, who, date, ts, level, valence, note}] }
}
export function emotionAdd({ level, note, date, who = 'yomi' }) {
  return request('/api/emotion', { method: 'POST', body: { level, note, date, who } })
}
export function emotionDelete({ id, date }) {
  return request(`/api/emotion?id=${encodeURIComponent(id)}&date=${encodeURIComponent(date)}`, { method: 'DELETE' })
}

// ── 喝水 / 运动（日计数，走 KV 直存）──────────────
export function waterGet(date) {
  return getJSON('/api/water', { date }) // { date, count, total_ml, entries:[{id,ts,ml,kind}] }
}
export function waterSet(date, count) {
  return request('/api/water', { method: 'POST', body: { date, count } })
}
// 喝水明细：一条 = ml + 饮品类别 + 服务端时间戳
export function waterEntryAdd({ date, ml, kind }) {
  return request('/api/water/entry', { method: 'POST', body: { date, ml, kind } })
}
export function waterEntryDelete({ date, id }) {
  return request(`/api/water/entry?date=${encodeURIComponent(date)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}
// 喝水提醒（cron 推送）：{ enabled, interval_min, start_hour, end_hour, target_cups }
export function waterReminderConfigGet() {
  return getJSON('/api/config/water-reminder')
}
export function waterReminderConfigSet(cfg) {
  return request('/api/config/water-reminder', { method: 'POST', body: cfg })
}
export function exerciseGet(date) {
  return getJSON('/api/exercise', { date })
}
export function exerciseSet(date, minutes) {
  return request('/api/exercise', { method: 'POST', body: { date, minutes } })
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

  // 睡眠：moments 里带 #睡眠 标签的最新一条，解析"X 小时/h"只取小时数字；
  // 解析不出算无数据（原文截断塞进大字号会被挤断，宁可显示"暂无数据"）
  const sleepM = moments.find((m) => (m.tags || []).includes('睡眠'))
  let sleep = null
  if (sleepM) {
    const hm = (sleepM.content || '').match(/(\d+(?:\.\d+)?)\s*(?:个?小时|h)/i)
    sleep = hm ? hm[1] : null
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
