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

export const WHO_LABEL = { yomi: '静怡', emet: 'Emet' }
