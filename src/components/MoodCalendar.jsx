import { useState, useEffect, useMemo } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react'
import MoodFace from './MoodFace.jsx'
import { MOODS, moodMeta, WHO_LABEL } from '../utils/moods.js'
import { moodList, moodSet } from '../api.js'
import { showToast } from '../utils/toast.js'

// 心情日历：月历（每天 静怡 + Emet 两张脸）+ 月度分布比例 + 心情趋势。
// 静怡点日期记自己的（who=yomi，可写备注）；Emet 的脸由 MCP 记录后自动显示。

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function pad(n) {
  return String(n).padStart(2, '0')
}
function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function MoodCalendar({ onClose }) {
  const today = todayKey()
  const [ym, setYm] = useState(today.slice(0, 7)) // 'YYYY-MM'
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [openDay, setOpenDay] = useState(null) // 当前打开的日期
  const [draftMood, setDraftMood] = useState(null) // 弹层里静怡选中的脸
  const [draftNote, setDraftNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [statsWho, setStatsWho] = useState('yomi')

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

  const byDay = useMemo(() => {
    const m = {}
    for (const e of entries) {
      if (!m[e.date]) m[e.date] = {}
      m[e.date][e.who] = e
    }
    return m
  }, [entries])

  const cells = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate()
    const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7
    const arr = []
    for (let i = 0; i < firstDow; i++) arr.push(null)
    for (let d = 1; d <= daysInMonth; d++) arr.push(d)
    return arr
  }, [year, month])

  const goMonth = (delta) => {
    const d = new Date(year, month - 1 + delta, 1)
    setYm(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
    closeSheet()
  }

  const openSheet = (date) => {
    setOpenDay(date)
    const mine = byDay[date]?.yomi
    setDraftMood(mine?.mood || null)
    setDraftNote(mine?.note || '')
  }
  const closeSheet = () => {
    setOpenDay(null)
    setDraftMood(null)
    setDraftNote('')
  }

  const save = async () => {
    if (!draftMood || saving) return
    setSaving(true)
    try {
      await moodSet({ mood: draftMood, note: draftNote.trim(), who: 'yomi', date: openDay })
      const meta = moodMeta(draftMood)
      setEntries((prev) => {
        const rest = prev.filter((e) => !(e.date === openDay && e.who === 'yomi'))
        return [...rest, { date: openDay, who: 'yomi', mood: draftMood, note: draftNote.trim(), valence: meta.valence }]
      })
      closeSheet()
      showToast('已记下')
    } catch (e) {
      showToast(e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // ── 月度分布（statsWho 各心情几天 + 比例）──
  const dist = useMemo(() => {
    const c = {}
    let total = 0
    for (const e of entries) if (e.who === statsWho) { c[e.mood] = (c[e.mood] || 0) + 1; total++ }
    const max = Math.max(1, ...Object.values(c))
    const rows = MOODS.map((m) => ({
      ...m,
      count: c[m.id] || 0,
      ratio: (c[m.id] || 0) / max, // 横条相对长度
      pct: total ? (c[m.id] || 0) / total : 0, // 占比
    }))
    return { rows, total }
  }, [entries, statsWho])

  // ── 月度趋势（statsWho 每天 valence + mood 用于配色）──
  const trend = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate()
    const pts = []
    for (let d = 1; d <= daysInMonth; d++) {
      const e = byDay[`${ym}-${pad(d)}`]?.[statsWho]
      if (e) pts.push({ d, v: e.valence, mood: e.mood })
    }
    return { pts, daysInMonth }
  }, [byDay, statsWho, year, month, ym])

  const openRec = openDay ? byDay[openDay] || {} : {}

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
        <span>{year}年{month}月</span>
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
                onClick={() => openSheet(key)}
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
          <span className="faint">点日期记录 / 看备注</span>
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

      {/* ── 月度分布（比例图）── */}
      <div className="card moodcal-card">
        <div className="moodcal-section-label">
          月度分布 <span className="faint" style={{ fontWeight: 400 }}>· 共 {dist.total} 天</span>
        </div>
        {dist.total === 0 ? (
          <p className="faint" style={{ fontSize: 12, textAlign: 'center', padding: '8px 0' }}>本月还没有记录</p>
        ) : (
          <>
            {/* 叠加比例条 */}
            <div className="mc-ratiobar">
              {dist.rows.filter((m) => m.count > 0).map((m) => (
                <i key={m.id} style={{ width: `${m.pct * 100}%`, background: m.color }} title={`${m.label} ${Math.round(m.pct * 100)}%`} />
              ))}
            </div>
            {/* 各心情几天 */}
            <div className="mc-dist">
              {dist.rows.map((m) => (
                <div className="mc-dist-row" key={m.id}>
                  <i className="mc-dist-dot" style={{ background: m.color }} />
                  <div className="mc-dist-bar">
                    <i style={{ width: `${Math.max(m.count ? 14 : 0, m.ratio * 100)}%`, background: m.color }} />
                  </div>
                  <span className="mc-dist-label">{m.label}</span>
                  <span className="mc-dist-count">{m.count ? `${m.count}天` : '—'}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── 心情趋势 ── */}
      <div className="card moodcal-card">
        <div className="moodcal-section-label">心情趋势</div>
        <MoodTrend trend={trend} />
      </div>

      {/* ── 记录 / 看备注 弹层 ── */}
      {openDay && (
        <>
          <div className="moodcal-scrim" onClick={closeSheet} />
          <div className="moodcal-sheet card">
            <div className="moodcal-sheet-head">
              <span>{openDay === today ? '今天' : openDay.slice(5).replace('-', '月') + '日'}</span>
              <button onClick={closeSheet} aria-label="关闭"><X size={16} /></button>
            </div>

            {/* 当天两人记录（含备注） */}
            {(openRec.yomi || openRec.emet) && (
              <div className="mc-day-records">
                {['yomi', 'emet'].map((w) => {
                  const e = openRec[w]
                  if (!e) return null
                  const meta = moodMeta(e.mood)
                  return (
                    <div className="mc-day-rec" key={w}>
                      <i className="mc-day-face" style={{ color: meta?.color }}>
                        <MoodFace mood={e.mood} size={20} />
                      </i>
                      <span className="mc-day-who">{WHO_LABEL[w]}</span>
                      <span className="mc-day-moodlabel" style={{ color: meta?.color }}>{meta?.label}</span>
                      {e.note ? <span className="mc-day-note">{e.note}</span> : <span className="faint mc-day-note">（没写备注）</span>}
                    </div>
                  )
                })}
              </div>
            )}

            {/* 静怡记录区 */}
            <div className="mc-rec-label">{openRec.yomi ? '改一下我的心情' : '记我的心情'}</div>
            <div className="moodcal-sheet-faces">
              {MOODS.map((m) => (
                <button
                  key={m.id}
                  className={'moodcal-pick' + (draftMood === m.id ? ' is-selected' : '')}
                  style={{ '--mc': m.color }}
                  onClick={() => setDraftMood(m.id)}
                  title={m.label}
                >
                  <i style={{ color: m.color }}><MoodFace mood={m.id} size={24} /></i>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
            {draftMood && (
              <>
                <textarea
                  className="mc-note-input"
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  placeholder="写一句备注…（可不写）"
                  rows={2}
                />
                <div className="mc-rec-foot">
                  <button className="mini-btn mini-btn--accent" onClick={save} disabled={saving}>
                    {saving ? '记下…' : '记下'}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// SVG 折线，点用对应心情颜色
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
      <path d={path} fill="none" stroke="var(--line)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p) => (
        <circle key={p.d} cx={x(p.d)} cy={y(p.v)} r="3.2" fill={moodMeta(p.mood)?.color || 'var(--accent)'} />
      ))}
    </svg>
  )
}
