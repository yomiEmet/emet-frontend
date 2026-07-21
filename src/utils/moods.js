// 心情元数据：MoodPicker / MoodCalendar / 趋势 / 分布 共用。
// id 与后端 mood_set 的 enum 一致；valence 与后端 valMap 一致。

export const MOODS = [
  { id: 'excited', label: '兴奋', valence: 0.9, color: '#E07B5A' },
  { id: 'happy', label: '开心', valence: 0.8, color: '#E8A04C' },
  { id: 'heart', label: '心动', valence: 0.7, color: '#D98AA8' },
  { id: 'calm', label: '平静', valence: 0.3, color: '#7EA67E' },
  { id: 'tired', label: '疲惫', valence: -0.2, color: '#9DA3A8' },
  { id: 'anxious', label: '焦虑', valence: -0.4, color: '#6A8EB0' },
  { id: 'sad', label: '难过', valence: -0.6, color: '#8E7CC3' },
]

const BY_ID = Object.fromEntries(MOODS.map((m) => [m.id, m]))

export function moodMeta(id) {
  return BY_ID[id] || null
}

// ── 愉悦度 7 档（静怡新版记录用；情绪+心情共用这套量纲）──────────────
// valence 均匀分布 -1..1；冷→暖的发散配色。Emet 的具名心情按 valence 归到最近档显示。
export const PLEASANT = [
  { level: 1, label: '非常不愉快', valence: -1,      color: '#6A7BA8' },
  { level: 2, label: '不愉快',     valence: -0.6667, color: '#7E96B8' },
  { level: 3, label: '有点不愉快', valence: -0.3333, color: '#9DA8B0' },
  { level: 4, label: '平静',       valence: 0,       color: '#8BA88E' },
  { level: 5, label: '有点愉快',   valence: 0.3333,  color: '#D9B87A' },
  { level: 6, label: '愉快',       valence: 0.6667,  color: '#E39A6A' },
  { level: 7, label: '非常愉快',   valence: 1,       color: '#E07B5A' },
]

const PLEASANT_BY_LEVEL = Object.fromEntries(PLEASANT.map((p) => [p.level, p]))

export function pleasantMeta(level) {
  return PLEASANT_BY_LEVEL[level] || null
}

// 任意 valence（含 Emet 具名心情的 valence）→ 最近的愉悦度档
export function levelOfValence(v) {
  if (v == null) return null
  let best = PLEASANT[0]
  let bd = Infinity
  for (const p of PLEASANT) {
    const d = Math.abs(p.valence - v)
    if (d < bd) { bd = d; best = p }
  }
  return best
}

// 记录（{ level, valence }）→ 愉悦度档：优先自带 level，否则按 valence 归档
export function pleasantOf(record) {
  if (record?.level != null) return pleasantMeta(record.level) || levelOfValence(record.valence)
  return levelOfValence(record?.valence)
}

// 按 valence 从低到高（滑块用：难过 → 平静 → 兴奋，对应"低落←→开心"）
export const MOODS_BY_VALENCE = [...MOODS].sort((a, b) => a.valence - b.valence)

// valence（-1..1 浮点）→ 最接近的 mood 元数据。仅当记录缺 mood id 时兜底用；
// 正常读回优先走 moodMeta(record.mood)。
export function moodByValence(v) {
  if (v == null) return null
  let best = MOODS[0]
  let bestD = Infinity
  for (const m of MOODS) {
    const d = Math.abs(m.valence - v)
    if (d < bestD) { bestD = d; best = m }
  }
  return best
}

// 记录（{ mood, valence }）→ mood 元数据：优先 id，兜底 valence
export function moodOf(record) {
  return moodMeta(record?.mood) || moodByValence(record?.valence)
}

export const WHO_LABEL = { yomi: '静怡', emet: 'Emet' }
