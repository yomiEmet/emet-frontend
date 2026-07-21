import { useState, useEffect } from 'react'
import { Droplets } from 'lucide-react'
import { dayKey, nowLogical } from '../utils/time.js'
import { waterGet, waterSet } from '../api.js'

const TOTAL = 7

function getToday() {
  return dayKey(nowLogical())
}
function loadLocal(day) {
  try {
    const d = JSON.parse(localStorage.getItem('emet-water') || '{}')
    return d[day] || 0
  } catch { return 0 }
}
function saveLocal(day, count) {
  try {
    const d = JSON.parse(localStorage.getItem('emet-water') || '{}')
    d[day] = count
    localStorage.setItem('emet-water', JSON.stringify(d))
  } catch { /* */ }
}

export default function WaterCard() {
  const [day, setDay] = useState(getToday)
  const [count, setCount] = useState(() => loadLocal(getToday()))

  useEffect(() => {
    const today = getToday()
    waterGet(today)
      // 只有服务端存在真实记录（含 count=0）才覆盖本地——用 updated_at 区分
      // "服务端确有此天记录" 与 "缺省兜底的 {count:0}"，避免另一设备清零无法同步下来。
      .then(r => {
        if (r && r.updated_at != null) {
          setDay(today)
          setCount(r.count || 0)
          saveLocal(today, r.count || 0)
        }
      })
      .catch(() => {})
  }, [])

  const tap = () => {
    const today = getToday()
    // 跨过逻辑日边界（凌晨4点）后组件没重挂载：昨天的 count 不能顺延进今天
    const base = today === day ? count : 0
    const next = base >= TOTAL ? 0 : base + 1
    setDay(today)
    setCount(next)
    saveLocal(today, next)
    waterSet(today, next).catch(() => {})
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
