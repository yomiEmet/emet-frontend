import { useState, useEffect } from 'react'
import { Droplets } from 'lucide-react'
import { dayKey, nowLogical } from '../utils/time.js'
import { waterGet, waterSet } from '../api.js'

const TOTAL = 7

function getToday() {
  return dayKey(nowLogical())
}
function loadLocal() {
  try {
    const d = JSON.parse(localStorage.getItem('emet-water') || '{}')
    return d[getToday()] || 0
  } catch { return 0 }
}
function saveLocal(count) {
  try {
    const d = JSON.parse(localStorage.getItem('emet-water') || '{}')
    d[getToday()] = count
    localStorage.setItem('emet-water', JSON.stringify(d))
  } catch { /* */ }
}

export default function WaterCard() {
  const [count, setCount] = useState(loadLocal)

  useEffect(() => {
    waterGet(getToday())
      .then(r => { if (r?.count > 0) { setCount(r.count); saveLocal(r.count) } })
      .catch(() => {})
  }, [])

  const tap = () => {
    const next = count >= TOTAL ? 0 : count + 1
    setCount(next)
    saveLocal(next)
    waterSet(getToday(), next).catch(() => {})
  }

  return (
    <div className="card today-card" onClick={tap} style={{ cursor: 'pointer' }}>
      <div className="today-card__label">
        <Droplets size={15} />
        <span>喝水</span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        {Array.from({ length: TOTAL }, (_, i) => (
          <div key={i} style={{
            width: 10, height: 10, borderRadius: '50%',
            background: i < count ? 'var(--accent)' : 'var(--line)',
            transition: 'background 0.15s'
          }} />
        ))}
      </div>
    </div>
  )
}
