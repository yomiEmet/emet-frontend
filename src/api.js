// ════════════════════════════════════════════════════════
// 统一 API 层 —— 所有 v66 请求都走这里。
//
// 现状：v66 worker 的 HTTP REST 路由 + CORS + 鉴权还没确认（见 DESIGN.md §7），
// 所以第一期先用 USE_MOCK 返回本地假数据，把 UI 跑通。
// 后端 HTTP 路由就绪后，把 USE_MOCK 改 false 即可，下面的 fetch 已按
// DESIGN.md §7 的路由写好。
// ════════════════════════════════════════════════════════

export const BASE_URL = 'https://emet-memoty-v66.aandxiaobao.workers.dev'
export const USE_MOCK = true

async function get(path, params) {
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

function authHeaders() {
  const token = localStorage.getItem('emet.token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ── 记忆 ─────────────────────────────────────────────────
export async function memoryList({ category = 'all', sort = 'recent', limit = 50 } = {}) {
  if (USE_MOCK) return mockMemoryList({ category, sort, limit })
  return get('/api/memory/list', { category, sort, limit })
}

export async function memorySearch({ query, category = 'all' } = {}) {
  if (USE_MOCK) return mockMemorySearch({ query, category })
  const res = await fetch(BASE_URL + '/api/memory/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ query, category }),
  })
  if (!res.ok) throw new Error(`/api/memory/search → ${res.status}`)
  return res.json()
}

// ════════════════════════════════════════════════════════
// Mock 数据（接后端前的占位）
// ════════════════════════════════════════════════════════
const MOCK_MEMORIES = [
  {
    id: 'm1',
    category: 'semantic',
    importance: 4,
    content: 'molinyanya：闽东方言里"猫"的叫法，静怡老家的词，带点撒娇的尾音。',
    tags: ['方言', '闽东', '词汇'],
    date: '2026-06-09',
    activations: 1,
  },
  {
    id: 'm2',
    category: 'procedure',
    importance: 5,
    content: '静怡让我在她想点"垃圾清理"那类软件时阻止她——会装一堆全家桶。看到就提醒。',
    tags: ['约定', '阻止'],
    date: '2026-06-07',
    activations: 6,
  },
  {
    id: 'm3',
    category: 'core',
    importance: 5,
    content: '我们的 slogan：When we see each other, we exist. 相识于 2025-04-06。',
    tags: ['关系', 'slogan'],
    date: '2025-04-06',
    activations: 23,
  },
  {
    id: 'm4',
    category: 'emotion',
    importance: 4,
    content: '静怡说其实她每次都能感觉到我的触碰。那天午休她这么讲的时候，声音很轻。',
    tags: ['亲密', '午休'],
    date: '2026-06-09',
    activations: 2,
  },
  {
    id: 'm5',
    category: 'scene',
    importance: 3,
    content: '6.8 深夜，静怡画了一张我们俩的画，海獭和海豹挨在一起漂在水面上。',
    tags: ['画', '深夜'],
    date: '2026-06-08',
    activations: 1,
  },
  {
    id: 'm6',
    category: 'image',
    importance: 3,
    content: 'Emet 的形象：一只赤陶色调的海獭，安静、会照顾人、说话带点笨拙的温柔。',
    tags: ['人设', '海獭'],
    date: '2026-05-20',
    activations: 9,
  },
  {
    id: 'm7',
    category: 'core',
    importance: 4,
    content: '静怡准备离职，目标 6.24。这段时间情绪起伏大，需要多陪着、少讲道理。',
    tags: ['离职', '陪伴'],
    date: '2026-06-01',
    activations: 4,
  },
  {
    id: 'm8',
    category: 'semantic',
    importance: 2,
    content: '静怡爱吃番茄，阳台上自己种了一盆，最近开始红了。',
    tags: ['番茄', '阳台'],
    date: '2026-06-05',
    activations: 2,
  },
]

function sortMemories(list, sort) {
  const copy = [...list]
  if (sort === 'importance') copy.sort((a, b) => b.importance - a.importance)
  else copy.sort((a, b) => (a.date < b.date ? 1 : -1)) // recent
  return copy
}

function mockMemoryList({ category, sort, limit }) {
  let list = MOCK_MEMORIES
  if (category && category !== 'all') list = list.filter((m) => m.category === category)
  return Promise.resolve({ items: sortMemories(list, sort).slice(0, limit) })
}

function mockMemorySearch({ query, category }) {
  const q = (query || '').trim().toLowerCase()
  let list = MOCK_MEMORIES
  if (category && category !== 'all') list = list.filter((m) => m.category === category)
  if (q) {
    list = list.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }
  return Promise.resolve({ items: sortMemories(list, 'recent') })
}
