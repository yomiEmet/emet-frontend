import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Droplets, ChevronRight } from 'lucide-react'
import { dayKey, nowLogical } from '../utils/time.js'
import { waterGet } from '../api.js'

const TOTAL = 7

function getToday() {
  return dayKey(nowLogical())
}
function loadLocal(day) {
  try {
    const d = JSON.parse(localStorage.getItem('emet-water') || '{}')
    const v = d[day]
    // 旧缓存是数字（杯数），新缓存是 {count,total_ml}
    if (typeof v === 'number') return { count: v, total_ml: 0 }
    return v || { count: 0, total_ml: 0 }
  } catch { return { count: 0, total_ml: 0 } }
}
function saveLocal(day, val) {
  try {
    const d = JSON.parse(localStorage.getItem('emet-water') || '{}')
    d[day] = val
    localStorage.setItem('emet-water', JSON.stringify(d))
  } catch { /* */ }
}

// 主页喝水卡：只展示进度，点击进 /water 详情页记录（ml/饮品类别/提醒都在里面）
export default function WaterCard() {
  const navigate = useNavigate()
  const [state, setState] = useState(() => loadLocal(getToday()))

  useEffect(() => {
    const today = getToday()
    waterGet(today)
      .then(r => {
        const next = { count: r?.count || 0, total_ml: r?.total_ml || 0 }
        setState(next)
        saveLocal(today, next)
      })
      .catch(() => {})
  }, [])

  return (
    <button className="card today-card" onClick={() => navigate('/water')} style={{ cursor: 'pointer', textAlign: 'left' }}>
      <div className="today-card__label">
        <Droplets size={15} />
        <span>喝水</span>
        <ChevronRight size={14} style={{ marginLeft: 'auto', color: 'var(--ink-faint)' }} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
        {Array.from({ length: TOTAL }, (_, i) => (
          <div key={i} style={{
            width: 10, height: 10, borderRadius: '50%',
            background: i < state.count ? 'var(--accent)' : 'var(--line)',
            transition: 'background 0.15s'
          }} />
        ))}
        {state.total_ml > 0 && (
          <span style={{ fontSize: 11, color: 'var(--ink-faint)', marginLeft: 2 }}>{state.total_ml}ml</span>
        )}
      </div>
    </button>
  )
}
