// 经期月历（四期 4-2）：记录（含 end_date、可回溯补记）+ 月历高亮 + 统计。
// 统计口径全来自后端 computePeriodStats（前端只读 stats），保证与 period_status 工具一致。

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { periodList, periodSave, periodDelete } from '../api.js'
import { showToast } from '../utils/toast.js'
import { nowLogical, dayKey } from '../utils/time.js'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

function ymd(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export default function PeriodCalendar() {
  const navigate = useNavigate()
  const [logs, setLogs] = useState(null)
  const [stats, setStats] = useState(null)
  const [busy, setBusy] = useState(false)
  const today = dayKey(nowLogical())
  const [cursor, setCursor] = useState(() => {
    const n = nowLogical()
    return { y: n.getFullYear(), m: n.getMonth() }
  })

  const load = () =>
    periodList()
      .then((r) => {
        setLogs(r.logs || [])
        setStats(r.stats || null)
      })
      .catch(() => setLogs((prev) => prev || []))

  useEffect(() => {
    let alive = true
    periodList()
      .then((r) => {
        if (!alive) return
        setLogs(r.logs || [])
        setStats(r.stats || null)
      })
      .catch(() => alive && setLogs([]))
    return () => {
      alive = false
    }
  }, [])

  const ongoing = stats?.ongoing || null

  // 某天是否落在任一次经期区间内（含单日 start=end 情况）
  const inPeriod = (dateStr) =>
    (logs || []).some((l) => {
      const end = l.end_date || l.start_date
      return dateStr >= l.start_date && dateStr <= end
    })

  const startToday = async () => {
    if (busy) return
    setBusy(true)
    try {
      await periodSave({ start_date: today })
      await load()
      showToast('已记录这次开始')
    } catch (e) {
      showToast(e?.message || '记录失败')
    } finally {
      setBusy(false)
    }
  }

  const endOngoing = async () => {
    if (busy || !ongoing) return
    setBusy(true)
    try {
      await periodSave({ start_date: ongoing.start_date, end_date: today })
      await load()
      showToast('已记录结束')
    } catch (e) {
      showToast(e?.message || '记录失败')
    } finally {
      setBusy(false)
    }
  }

  // 月历格子
  const first = new Date(cursor.y, cursor.m, 1)
  const startWeekday = (first.getDay() + 6) % 7 // 周一为 0
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const prevMonth = () => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))
  const nextMonth = () => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))

  return (
    <div className="page detail">
      <header className="detail-header">
        <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <span className="detail-title">经期月历</span>
        <div className="detail-header__right" />
      </header>

      {/* 统计条 */}
      <div className="card period-stats">
        {stats?.days_until_next != null ? (
          <div className="period-stat period-stat--main">
            <strong>{stats.days_until_next >= 0 ? stats.days_until_next : 0}</strong>
            <span className="faint">天后预测下次</span>
          </div>
        ) : (
          <div className="period-stat period-stat--main">
            <strong>—</strong>
            <span className="faint">记录满两次后预测</span>
          </div>
        )}
        <div className="period-stat">
          <strong>{stats?.avg_cycle_days ?? '—'}</strong>
          <span className="faint">平均周期</span>
        </div>
        <div className="period-stat">
          <strong>{stats?.avg_duration_days ?? '—'}</strong>
          <span className="faint">平均经期</span>
        </div>
      </div>

      {ongoing && (
        <p className="period-ongoing">这次从 {ongoing.start_date.slice(5).replace('-', '.')} 开始，进行中</p>
      )}

      {/* 记录按钮 */}
      <div className="period-actions">
        {ongoing ? (
          <button className="set-btn set-btn--accent" disabled={busy} onClick={endOngoing}>
            记录结束（今天）
          </button>
        ) : (
          <button className="set-btn set-btn--accent" disabled={busy} onClick={startToday}>
            <Plus size={14} /> 记录这次开始（今天）
          </button>
        )}
      </div>

      {/* 月历 */}
      <div className="card period-cal">
        <div className="period-cal__head">
          <button className="period-cal__nav" onClick={prevMonth} aria-label="上个月">
            <ChevronLeft size={18} />
          </button>
          <span className="period-cal__title">
            {cursor.y} 年 {cursor.m + 1} 月
          </span>
          <button className="period-cal__nav" onClick={nextMonth} aria-label="下个月">
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="period-cal__grid">
          {WEEK.map((w) => (
            <div key={w} className="period-cal__wd faint">
              {w}
            </div>
          ))}
          {cells.map((d, i) => {
            if (d == null) return <div key={'e' + i} className="period-cal__cell" />
            const ds = ymd(cursor.y, cursor.m, d)
            const on = inPeriod(ds)
            const isToday = ds === today
            const isPredict = stats?.predicted_next === ds
            return (
              <div
                key={ds}
                className={
                  'period-cal__cell period-cal__day' +
                  (on ? ' is-on' : '') +
                  (isToday ? ' is-today' : '') +
                  (isPredict ? ' is-predict' : '')
                }
              >
                {d}
              </div>
            )
          })}
        </div>
        <div className="period-cal__legend faint">
          <span className="period-legend period-legend--on">经期</span>
          <span className="period-legend period-legend--predict">预测</span>
        </div>
      </div>

      {/* 记录列表 */}
      <section className="set-group">
        <div className="section-label">记录</div>
        {logs === null ? (
          <p className="faint list-hint">加载中…</p>
        ) : logs.length === 0 ? (
          <p className="faint list-hint">还没有记录。经期开始那天点上面的按钮，或在下面补记历史。</p>
        ) : (
          <div className="stack">
            {logs.map((l) => (
              <PeriodRow key={l.start_date} log={l} busy={busy} onChanged={load} setBusy={setBusy} />
            ))}
          </div>
        )}
        <BackfillRow onChanged={load} />
      </section>
    </div>
  )
}

function PeriodRow({ log, busy, onChanged, setBusy }) {
  const [end, setEnd] = useState(log.end_date || '')

  const saveEnd = async (v) => {
    setEnd(v)
    if (!v) return
    setBusy(true)
    try {
      await periodSave({ start_date: log.start_date, end_date: v })
      await onChanged()
    } catch (e) {
      showToast(e?.message || '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (busy || !window.confirm('删除这条记录？')) return
    setBusy(true)
    try {
      await periodDelete(log.start_date)
      await onChanged()
    } catch (e) {
      showToast(e?.message || '删除失败')
      setBusy(false)
    }
  }

  return (
    <div className="card period-row">
      <div className="period-row__dates">
        <span className="period-row__start">{log.start_date.slice(5).replace('-', '.')}</span>
        <span className="faint"> → </span>
        <input
          className="period-row__end"
          type="date"
          value={end}
          min={log.start_date}
          onChange={(e) => saveEnd(e.target.value)}
        />
        {!end && <span className="faint period-row__ongoing">进行中</span>}
      </div>
      <button className="period-row__del faint" onClick={remove} aria-label="删除">
        <X size={14} />
      </button>
    </div>
  )
}

// 回溯补记：选一个开始日期加历史记录
function BackfillRow({ onChanged }) {
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!date || busy) return
    setBusy(true)
    try {
      await periodSave({ start_date: date })
      setDate('')
      await onChanged()
      showToast('已补记')
    } catch (e) {
      showToast(e?.message || '补记失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card period-backfill">
      <span className="faint">补记历史（选开始日期）</span>
      <div className="period-backfill__row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="set-btn" disabled={!date || busy} onClick={add}>
          <Plus size={14} /> 补记
        </button>
      </div>
    </div>
  )
}
