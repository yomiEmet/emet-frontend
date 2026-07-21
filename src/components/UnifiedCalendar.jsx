import { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { moodList, periodList } from '../api.js'
import { pleasantOf } from '../utils/moods.js'
import { dayKey, nowLogical, nowCST, logicalDayKey } from '../utils/time.js'
import { loadSessions } from '../utils/sessions.js'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const TABS = ['心情', '经期', '互动']

function monthDays(year, month) {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const total = new Date(year, month + 1, 0).getDate()
  return { offset, total }
}

function fmtMonth(y, m) {
  return `${y}年${m + 1}月`
}

function chatDayCounts() {
  const counts = {}
  for (const s of loadSessions()) {
    if (!s || s.deleted) continue
    for (const m of s.messages || []) {
      if (m?.role !== 'user' || !m.ts) continue
      const k = logicalDayKey(m.ts)
      counts[k] = (counts[k] || 0) + 1
    }
  }
  return counts
}

export default function UnifiedCalendar() {
  const now = nowCST()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [tab, setTab] = useState(0)
  const [moods, setMoods] = useState({})
  const [periods, setPeriods] = useState([])
  const chatCounts = useMemo(chatDayCounts, [])

  useEffect(() => {
    const start = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const endD = new Date(year, month + 1, 0)
    const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(endD.getDate()).padStart(2, '0')}`
    moodList({ start, end })
      .then(r => {
        const map = {}
        for (const m of r?.moods || []) {
          if (m.who === 'yomi') map[m.date] = m
        }
        setMoods(map)
      })
      .catch(() => {})
    periodList()
      .then(r => setPeriods(r?.logs || []))
      .catch(() => {})
  }, [year, month])

  const { offset, total } = monthDays(year, month)
  const todayKey = dayKey(nowLogical())

  const prev = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  const next = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  const inPeriod = (dateStr) => {
    for (const p of periods) {
      if (dateStr >= p.start_date && (!p.end_date || dateStr <= p.end_date)) return true
    }
    return false
  }

  const cells = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= total; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ day: d, key })
  }

  return (
    <section className="card" style={{ padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button onClick={prev} style={{ padding: 4, color: 'var(--ink-soft)' }}>
          <ChevronLeft size={18} />
        </button>
        <span style={{ fontFamily: 'var(--serif-zh)', fontSize: 15, fontWeight: 500 }}>
          {fmtMonth(year, month)}
        </span>
        <button onClick={next} style={{ padding: 4, color: 'var(--ink-soft)' }}>
          <ChevronRight size={18} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 14 }}>
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} style={{
            fontSize: 12, padding: '3px 14px', borderRadius: 999,
            background: tab === i ? 'var(--accent)' : 'transparent',
            color: tab === i ? '#fff' : 'var(--ink-soft)',
            border: tab === i ? 'none' : '1px solid var(--line)',
            transition: 'all 0.15s'
          }}>{t}</button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {WEEKDAYS.map(w => (
          <div key={w} style={{ textAlign: 'center', fontSize: 11, color: 'var(--ink-faint)', padding: '2px 0' }}>
            {w}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((cell, i) => {
          if (!cell) return <div key={`e${i}`} />
          const isToday = cell.key === todayKey
          const mood = moods[cell.key]
          const isPeriod = inPeriod(cell.key)
          const chatCount = chatCounts[cell.key] || 0

          let dotColor = null
          if (tab === 0 && mood) dotColor = pleasantOf(mood)?.color || 'var(--accent)'
          else if (tab === 1 && isPeriod) dotColor = 'var(--accent)'
          else if (tab === 2 && chatCount > 0) {
            const alpha = Math.min(chatCount / 30, 1) * 0.7 + 0.3
            dotColor = `rgba(198,97,63,${alpha})`
          }

          return (
            <div key={cell.key} style={{
              aspectRatio: '1', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 2,
              borderRadius: 8,
              background: isToday ? 'var(--accent-bg)' : 'transparent'
            }}>
              <span style={{
                fontSize: 12, color: isToday ? 'var(--accent)' : 'var(--ink-soft)',
                fontWeight: isToday ? 600 : 400, fontFamily: 'var(--sans-en)', lineHeight: 1
              }}>{cell.day}</span>
              {dotColor && (
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: dotColor, transition: 'background 0.15s'
                }} />
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
