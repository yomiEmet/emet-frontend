import { useState, useEffect } from 'react'
import { Flame } from 'lucide-react'
import { dayKey, nowLogical } from '../utils/time.js'
import { exerciseGet, exerciseSet } from '../api.js'

function getToday() {
  return dayKey(nowLogical())
}
function loadLocal(day) {
  try {
    const d = JSON.parse(localStorage.getItem('emet-exercise') || '{}')
    return d[day] || 0
  } catch { return 0 }
}
function saveLocal(day, mins) {
  try {
    const d = JSON.parse(localStorage.getItem('emet-exercise') || '{}')
    d[day] = mins
    localStorage.setItem('emet-exercise', JSON.stringify(d))
  } catch { /* */ }
}

export default function ExerciseCard() {
  const [day, setDay] = useState(getToday)
  const [mins, setMins] = useState(() => loadLocal(getToday()))

  useEffect(() => {
    const today = getToday()
    exerciseGet(today)
      // 只有服务端真实记录（含 0）才覆盖本地，见 WaterCard 同注释
      .then(r => {
        if (r && r.updated_at != null) {
          setDay(today)
          setMins(r.minutes || 0)
          saveLocal(today, r.minutes || 0)
        }
      })
      .catch(() => {})
  }, [])

  const tap = () => {
    const today = getToday()
    // 跨凌晨4点未重挂载时，昨天的分钟数不能顺延进今天
    const base = today === day ? mins : 0
    const next = base + 15
    setDay(today)
    setMins(next)
    saveLocal(today, next)
    exerciseSet(today, next).catch(() => {})
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
