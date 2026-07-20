import { useState } from 'react'
import { Flame } from 'lucide-react'
import { dayKey, nowLogical } from '../utils/time.js'

function getToday() {
  return dayKey(nowLogical())
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem('emet-exercise') || '{}')
    return d[getToday()] || 0
  } catch { return 0 }
}
function save(mins) {
  try {
    const d = JSON.parse(localStorage.getItem('emet-exercise') || '{}')
    d[getToday()] = mins
    localStorage.setItem('emet-exercise', JSON.stringify(d))
  } catch { /* */ }
}

export default function ExerciseCard() {
  const [mins, setMins] = useState(load)

  const tap = () => {
    const next = mins + 15
    setMins(next)
    save(next)
  }

  return (
    <div className="card today-card" onClick={tap} style={{ cursor: 'pointer' }}>
      <div className="today-card__label">
        <Flame size={15} />
        <span>运动</span>
      </div>
      <div className="today-card__value">
        {mins > 0 ? (
          <>{mins}<span className="today-card__unit"> 分钟</span></>
        ) : (
          <span className="today-card__value is-muted" style={{ fontSize: 13 }}>点击记录</span>
        )}
      </div>
    </div>
  )
}
