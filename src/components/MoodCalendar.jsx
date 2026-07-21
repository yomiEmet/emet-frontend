import { useState, useEffect, useMemo } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react'
import PleasantFace from './PleasantFace.jsx'
import { PLEASANT, pleasantMeta, pleasantOf, levelOfValence, WHO_LABEL } from '../utils/moods.js'
import { moodList, moodSet, emotionList } from '../api.js'
import { toCST } from '../utils/time.js'
import { showToast } from '../utils/toast.js'

// 心情日历：月历（每天 静怡 + Emet 两张愉悦度脸）+ 月度分布 + 心情趋势 + 当天情绪时间线。
// 静怡点日期记自己的整体心情（who=yomi，愉悦度 1-7 + 备注）；Emet 的按 valence 归档显示。

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const MID = 4

function pad(n) {
  return String(n).padStart(2, '0')
}
function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function hhmm(iso) {
  const d = toCST(iso) // 服务端 ts 是 UTC，按东八区显示，不随设备时区漂移
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function MoodCalendar({ onClose }) {
  const today = todayKey()
  const [ym, setYm] = useState(today.slice(0, 7)) // 'YYYY-MM'
  const [entries, setEntries] = useState([])
  const [emotions, setEmotions] = useState([])
  const [loading, setLoading] = useState(true)
  const [openDay, setOpenDay] = useState(null)
  const [draftLevel, setDraftLevel] = useState(MID)
  const [draftNote, setDraftNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [statsWho, setStatsWho] = useState('yomi')

  const [year, month] = ym.split('-').map(Number)

  const load = () => {
    setLoading(true)
    const start = `${ym}-01`
    const end = `${ym}-${pad(new Date(year, month, 0).getDate())}`
    Promise.all([
      moodList({ start, end }).then((r) => r?.moods || []).catch(() => []),
      emotionList({ start, end }).then((r) => r?.emotions || []).catch(() => []),
    ])
      .then(([m, e]) => { setEntries(m); setEmotions(e) })
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

  // 当天情绪按日期分组（who=statsWho 无关，日历里都显示；时间线按 ts 升序）
  const emoByDay = useMemo(() => {
    const m = {}
    for (const e of emotions) {
      if (!m[e.date]) m[e.date] = []
      m[e.date].push(e)
    }
    for (const arr of Object.values(m)) arr.sort((a, b) => (a.ts < b.ts ? -1 : 1))
    return m
  }, [emotions])

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
    const lv = mine ? (mine.level != null ? mine.level : levelOfValence(mine.valence)?.level || MID) : MID
    setDraftLevel(lv)
    setDraftNote(mine?.note || '')
  }
  const closeSheet = () => {
    setOpenDay(null)
    setDraftLevel(MID)
    setDraftNote('')
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      await moodSet({ level: draftLevel, note: draftNote.trim(), who: 'yomi', date: openDay })
      const meta = pleasantMeta(draftLevel)
      setEntries((prev) => {
        const rest = prev.filter((e) => !(e.date === openDay && e.who === 'yomi'))
        return [...rest, { date: openDay, who: 'yomi', mood: null, level: draftLevel, note: draftNote.trim(), valence: meta.valence }]
      })
      closeSheet()
      showToast('已记下')
    } catch (e) {
      showToast(e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // ── 月度分布（statsWho 各愉悦度档几天 + 比例）──
  const dist = useMemo(() => {
    const c = {}
    let total = 0
    for (const e of entries) if (e.who === statsWho) {
      const lv = e.level != null ? e.level : levelOfValence(e.valence)?.level
      if (lv) { c[lv] = (c[lv] || 0) + 1; total++ }
    }
    const max = Math.max(1, ...Object.values(c))
    const rows = PLEASANT.map((p) => ({
      ...p,
      count: c[p.level] || 0,
      ratio: (c[p.level] || 0) / max,
      pct: total ? (c[p.level] || 0) / total : 0,
    }))
    return { rows, total }
  }, [entries, statsWho])

  // ── 月度趋势（statsWho 每天 valence，点按愉悦度配色）──
  const trend = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate()
    const pts = []
    for (let d = 1; d <= daysInMonth; d++) {
      const e = byDay[`${ym}-${pad(d)}`]?.[statsWho]
      if (e) pts.push({ d, v: e.valence })
    }
    return { pts, daysInMonth }
  }, [byDay, statsWho, year, month, ym])

  const openRec = openDay ? byDay[openDay] || {} : {}
  const openEmos = openDay ? emoByDay[openDay] || [] : []

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
            const ym2 = pleasantOf(day.yomi)
            const em2 = pleasantOf(day.emet)
            const emoCount = (emoByDay[key] || []).length
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
                    <i className="moodcal-face" style={{ color: ym2?.color }}>
                      <PleasantFace level={ym2?.level || MID} size={16} />
                    </i>
                  ) : null}
                  {day.emet ? (
                    <i className="moodcal-face" style={{ color: em2?.color }}>
                      <PleasantFace level={em2?.level || MID} size={16} />
                    </i>
                  ) : null}
                </span>
                {emoCount > 0 && <span className="moodcal-emodot" title={`${emoCount} 条情绪`} />}
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
            <div className="mc-ratiobar">
              {dist.rows.filter((m) => m.count > 0).map((m) => (
                <i key={m.level} style={{ width: `${m.pct * 100}%`, background: m.color }} title={`${m.label} ${Math.round(m.pct * 100)}%`} />
              ))}
            </div>
            <div className="mc-dist">
              {dist.rows.map((m) => (
                <div className="mc-dist-row" key={m.level}>
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

            {/* 当天两人整体心情（含备注） */}
            {(openRec.yomi || openRec.emet) && (
              <div className="mc-day-records">
                {['yomi', 'emet'].map((w) => {
                  const e = openRec[w]
                  if (!e) return null
                  const meta = pleasantOf(e)
                  return (
                    <div className="mc-day-rec" key={w}>
                      <i className="mc-day-face" style={{ color: meta?.color }}>
                        <PleasantFace level={meta?.level || MID} size={20} />
                      </i>
                      <span className="mc-day-who">{WHO_LABEL[w]}</span>
                      <span className="mc-day-moodlabel" style={{ color: meta?.color }}>{meta?.label}</span>
                      {e.note ? <span className="mc-day-note">{e.note}</span> : <span className="faint mc-day-note">（没写备注）</span>}
                    </div>
                  )
                })}
              </div>
            )}

            {/* 当天情绪时间线 */}
            {openEmos.length > 0 && (
              <div className="mc-emo-line">
                <div className="mc-emo-line__label faint">这天的情绪</div>
                {openEmos.map((e) => {
                  const meta = pleasantMeta(e.level) || levelOfValence(e.valence)
                  return (
                    <div className="mc-emo-row" key={e.id}>
                      <span className="mc-emo-time">{hhmm(e.ts)}</span>
                      <i style={{ color: meta?.color, display: 'flex' }}><PleasantFace level={meta?.level || MID} size={18} /></i>
                      <span className="mc-emo-label" style={{ color: meta?.color }}>{meta?.label}</span>
                      {e.note && <span className="mc-emo-note">{e.note}</span>}
                    </div>
                  )
                })}
              </div>
            )}

            {/* 静怡记录整体心情（愉悦度滑块）*/}
            <div className="mc-rec-label">{openRec.yomi ? '改一下今天的心情' : '记今天的心情'}</div>
            <div className="mc-sheet-picker">
              <div style={{ color: pleasantMeta(draftLevel).color, display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
                <PleasantFace level={draftLevel} size={40} />
              </div>
              <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-soft)', marginBottom: 10 }}>
                {pleasantMeta(draftLevel).label}
              </div>
              <input
                type="range" min="1" max={PLEASANT.length} value={draftLevel}
                onChange={(e) => setDraftLevel(+e.target.value)}
                className="slider" style={{ width: '100%' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
                <span>不愉快</span><span>平静</span><span>愉快</span>
              </div>
            </div>
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
          </div>
        </>
      )}
    </div>
  )
}

// SVG 折线，点用对应愉悦度颜色
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
        <circle key={p.d} cx={x(p.d)} cy={y(p.v)} r="3.2" fill={levelOfValence(p.v)?.color || 'var(--accent)'} />
      ))}
    </svg>
  )
}
