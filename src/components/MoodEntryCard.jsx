import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { moodList } from '../api.js'
import { moodOf } from '../utils/moods.js'
import { dayKey, nowLogical } from '../utils/time.js'

export default function MoodEntryCard() {
  const navigate = useNavigate()
  const [mood, setMood] = useState(null)

  useEffect(() => {
    const today = dayKey(nowLogical())
    moodList({ start: today, end: today })
      .then(r => {
        const mine = (r?.moods || []).find(m => m.who === 'yomi' && m.date === today)
        if (mine) setMood(mine)
      })
      .catch(() => {})
  }, [])

  const meta = mood ? moodOf(mood) : null
  const label = meta?.label || '未记录'
  const emoji = meta?.emoji || '🫥'
  // valence -1..1 → 0..100% 进度
  const pct = meta ? ((meta.valence + 1) / 2) * 100 : 0

  return (
    <button className="card today-card" onClick={() => navigate('/mood')} style={{ cursor: 'pointer' }}>
      <div className="today-card__label">
        <span style={{ fontSize: 15 }}>{emoji}</span>
        <span>今日心情</span>
        <ChevronRight size={14} style={{ marginLeft: 'auto', color: 'var(--ink-faint)' }} />
      </div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          flex: 1, height: 4, borderRadius: 2, background: 'var(--line)',
          position: 'relative', overflow: 'hidden'
        }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${pct}%`,
            borderRadius: 2,
            background: 'linear-gradient(90deg, var(--accent-soft), var(--accent))'
          }} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink-soft)', minWidth: 36 }}>{label}</span>
      </div>
    </button>
  )
}
