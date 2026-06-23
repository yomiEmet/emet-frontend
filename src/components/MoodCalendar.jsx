import { useState, useEffect, useMemo } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react'
import MoodFace from './MoodFace.jsx'
import { MOODS, moodMeta, WHO_LABEL } from '../utils/moods.js'
import { moodList, moodSet } from '../api.js'
import { showToast } from '../utils/toast.js'

// 心情日历：月历（每天 静怡 + Emet 两张脸）+ 心情分布 + 心情趋势。
// 静怡点日期记自己的（who=yomi）；Emet 的脸由 MCP 记录后自动显示。

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function pad(n) {
  return String(n).padStart(2, '0')
}
// 今天（按本机时区，app 一直当东八区用）
function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function MoodCalendar({ onClose }) {
  const today = todayKey()
  const [ym, setYm] = useState(today.slice(0, 7)) // 'YYYY-MM'
  const [entries, setEntries] = useState([]) // 当月两人全部记录
  const [loading, setLoading] = useState(true)
  const [recordDay, setRecordDay] = useState(null) // 正在记录的日期
  const [statsWho, setStatsWho] = useState('yomi') // 分布/趋势看谁的

  const [year, month] = ym.split('-').map(Number)

  const load = () => {
    setLoading(true)
    const start = `${ym}-01`
    const end = `${ym}-${pad(new Date(year, month, 0).getDate())}`
    moodList({ start, end })
      .then((r) => setEntries(r?.moods || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }
  useEffect(load, [ym]) // eslint-disable-line react-hooks/exhaustive-deps

  // date → { yomi, emet }
  const byDay = useMemo(() => {
    const m = {}
    for (const e of entries) {
      if (!m[e.date]) m[e.date] = {}
      m[e.date][e.who] = e
    }
    return m
  }, [entries])

  // 当月日历格子（周一起）
  const cells = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate()
    const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7 // 周一=0
    const arr = []
    for (let i = 0; i < firstDow; i++) arr.push(null)
    for (let d = 1; d <= daysInMonth; d++) arr.push(d)
    return arr
  }, [year, month])

  const goMonth = (delta) => {
    const d = new Date(year, month - 1 + delta, 1)
    setYm(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
    setRecordDay(null)
  }

  const record = async (date, moodId) => {
    try {
      await moodSet({ mood: moodId, who: 'yomi', date })
      // 本地乐观更新
      const meta = moodMeta(moodId)
      setEntries((prev) => {
        const rest = prev.filter((e) => !(e.date === date && e.who === 'yomi'))
        return [...rest, { date, who: 'yomi', mood: moodId, valence: meta.valence, note: '' }]
      })
      setRecordDay(null)
      showToast('已记下')
    } catch (e) {
      showToast(e?.message || '保存失败')
    }
  }

  // ── 当月分布（statsWho 的 7 种心情计数）──
  const dist = useMemo(() => {
    const c = {}
    for (const e of entries) if (e.who === statsWho) c[e.mood] = (c[e.mood] || 0) + 1
    const max = Math.max(1, ...Object.values(c))
    return MOODS.map((m) => ({ ...m, count: c[m.id] || 0, ratio: (c[m.id] || 0) / max }))
  }, [entries, statsWho])

  // ── 当月趋势（statsWho 每天 valence）──
  const trend = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate()
    const pts = []
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${ym}-${pad(d)}`
      const e = byDay[key]?.[statsWho]
      if (e) pts.push({ d, v: e.valence })
    }
    return { pts, daysInMonth }
  }, [byDay, statsWho, year, month, ym])

  const monthLabel = `${year}年${month}月`

  return (
    <div className="moodcal">
      <header className="moodcal-head">
        <button className="detail-back" onClick={onClose} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <span className="moodcal-title">心情日历</span>
        <span style={{ width: 20 }} />
      </header>

      <div className="moodcal-nav">
        <button onClick={() => goMonth(-1)} aria-label="上个月"><ChevronLeft size={18} /></button>
        <span>{monthLabel}</span>
        <button onClick={() => goMonth(1)} aria-label="下个月"><ChevronRight size={18} /></button>
      </div>

      {/* ── 月历 ── */}
      <div className="card moodcal-card">
        <div className="moodcal-grid moodcal-grid--head">
          {WEEKDAYS.map((w) => (
            <div key={w} className="moodcal-wd">{w}</div>
          ))}
        </div>
        <div className="moodcal-grid">
          {cells.map((d, i) => {
            if (d == null) return <div key={`e${i}`} className="moodcal-cell is-empty" />
            const key = `${ym}-${pad(d)}`
            const day = byDay[key] || {}
            const isToday = key === today
            return (
              <button
                key={key}
                className={'moodcal-cell' + (isToday ? ' is-today' : '')}
                onClick={() => setRecordDay(key)}
              >
                <span className="moodcal-dnum">{d}</span>
                <span className="moodcal-faces">
                  {day.yomi ? (
                    <i className="moodcal-face" style={{ color: moodMeta(day.yomi.mood)?.color }}>
                      <MoodFace mood={day.yomi.mood} size={16} />
                    </i>
                  ) : null}
                  {day.emet ? (
                    <i className="moodcal-face" style={{ color: moodMeta(day.emet.mood)?.color }}>
                      <MoodFace mood={day.emet.mood} size={16} />
                    </i>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
        {loading && <p className="faint" style={{ textAlign: 'center', fontSize: 12, marginTop: 8 }}>加载中…</p>}
        <div className="moodcal-legend">
          <span><i className="lg-dot" style={{ background: 'var(--accent)' }} /> 静怡</span>
          <span><i className="lg-dot" style={{ background: 'var(--ink-soft)' }} /> Emet</span>
          <span className="faint">点日期记今天/补记</span>
        </div>
      </div>

      {/* ── 看谁的统计 ── */}
      <div className="moodcal-whoswitch">
        {['yomi', 'emet'].map((w) => (
          <button
            key={w}
            className={'mc-whobtn' + (statsWho === w ? ' is-active' : '')}
            onClick={() => setStatsWho(w)}
          >
            {WHO_LABEL[w]}
          </button>
        ))}
      </div>

      {/* ── 心情分布 ── */}
      <div className="card moodcal-card">
        <div className="moodcal-section-label">心情分布</div>
        <div className="mc-dist">
          {dist.map((m) => (
            <div className="mc-dist-row" key={m.id}>
              <i className="mc-dist-dot" style={{ background: m.color }} />
              <div className="mc-dist-bar">
                <i style={{ width: `${Math.max(m.count ? 14 : 0, m.ratio * 100)}%`, background: m.color }} />
              </div>
              <span className="mc-dist-label">{m.label}</span>
              <span className="mc-dist-count">{m.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 心情趋势 ── */}
      <div className="card moodcal-card">
        <div className="moodcal-section-label">心情趋势</div>
        <MoodTrend trend={trend} />
      </div>

      {/* ── 记录弹层 ── */}
      {recordDay && (
        <>
          <div className="moodcal-scrim" onClick={() => setRecordDay(null)} />
          <div className="moodcal-sheet card">
            <div className="moodcal-sheet-head">
              <span>{recordDay === today ? '今天心情' : recordDay.slice(5).replace('-', '.') + ' 心情'}</span>
              <button onClick={() => setRecordDay(null)} aria-label="关闭"><X size={16} /></button>
            </div>
            <div className="moodcal-sheet-faces">
              {MOODS.map((m) => {
                const cur = byDay[recordDay]?.yomi?.mood === m.id
                return (
                  <button
                    key={m.id}
                    className={'moodcal-pick' + (cur ? ' is-selected' : '')}
                    style={{ '--mc': m.color }}
                    onClick={() => record(recordDay, m.id)}
                    title={m.label}
                  >
                    <i style={{ color: m.color }}><MoodFace mood={m.id} size={26} /></i>
                    <span>{m.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// 简单 SVG 折线（valence -1..1 → y）
function MoodTrend({ trend }) {
  const { pts, daysInMonth } = trend
  const W = 300
  const H = 90
  const padX = 6
  const padY = 12
  if (!pts.length) {
    return <p className="faint" style={{ fontSize: 12, textAlign: 'center', padding: '16px 0' }}>本月还没有记录</p>
  }
  const x = (d) => padX + ((d - 1) / Math.max(1, daysInMonth - 1)) * (W - padX * 2)
  const y = (v) => padY + ((1 - v) / 2) * (H - padY * 2)
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.d).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mc-trend" preserveAspectRatio="none">
      <line x1={padX} y1={y(0)} x2={W - padX} y2={y(0)} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p) => (
        <circle key={p.d} cx={x(p.d)} cy={y(p.v)} r="2.6" fill="var(--accent)" />
      ))}
    </svg>
  )
}
