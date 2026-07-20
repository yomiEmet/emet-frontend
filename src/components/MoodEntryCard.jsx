import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { moodList } from '../api.js'
import { dayKey, nowLogical } from '../utils/time.js'

const MOOD_LABELS = ['', '很差', '差', '低落', '一般', '平静', '还好', '不错', '开心', '很开心', '超开心']
const MOOD_EMOJI = ['', '😞', '😔', '🫤', '😐', '😌', '🙂', '😊', '😄', '🥰', '🤩']

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

  const val = mood?.valence ?? 5
  const label = MOOD_LABELS[val] || '平静'
  const emoji = MOOD_EMOJI[val] || '😌'

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
            width: `${val * 10}%`,
            borderRadius: 2,
            background: 'linear-gradient(90deg, var(--accent-soft), var(--accent))'
          }} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink-soft)', minWidth: 36 }}>{label}</span>
      </div>
    </button>
  )
}
