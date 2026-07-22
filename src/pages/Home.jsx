import { useState, useEffect } from 'react'
import { MessageSquare, Moon, BarChart3 } from 'lucide-react'
import WhisperCard from '../components/WhisperCard.jsx'
import TodayCard from '../components/TodayCard.jsx'
import MoodEntryCard from '../components/MoodEntryCard.jsx'
import WaterCard from '../components/WaterCard.jsx'
import ExerciseCard from '../components/ExerciseCard.jsx'
import TodoList from '../components/TodoList.jsx'
import ReceiptCard from '../components/ReceiptCard.jsx'
import UnifiedCalendar from '../components/UnifiedCalendar.jsx'
import MilestoneList from '../components/MilestoneList.jsx'
import { greeting, longDate, daysTogether, sinceLabel, nowCST, nowLogical, dayKey, logicalDayKey } from '../utils/time.js'
import { homeSummary, subscribeData } from '../api.js'
import { loadSessions } from '../utils/sessions.js'
import { pull as chatPull } from '../utils/sync.js'

const WHISPER_FALLBACK = '今天的番茄又红了一点。'

function chatDayCounts() {
  const counts = new Map()
  for (const s of loadSessions()) {
    if (!s || s.deleted) continue
    for (const m of s.messages || []) {
      if (m?.role !== 'user' || !m.ts) continue
      const k = logicalDayKey(m.ts)
      counts.set(k, (counts.get(k) || 0) + 1)
    }
  }
  return counts
}

function Num({ value }) {
  return <strong>{value == null ? '—' : value}</strong>
}

export default function Home() {
  const now = nowCST()
  const [summary, setSummary] = useState(null)
  const [chatCounts, setChatCounts] = useState(() => chatDayCounts())

  useEffect(() => {
    let alive = true
    const load = () => {
      homeSummary()
        .then((s) => alive && setSummary(s))
        .catch(() => alive && setSummary(null))
      setChatCounts(chatDayCounts())
    }
    load()
    chatPull()
      .then((n) => n && alive && setChatCounts(chatDayCounts()))
      .catch(() => {})
    const unsub = subscribeData(load)
    return () => { alive = false; unsub() }
  }, [])

  const todayMessages = chatCounts.get(dayKey(nowLogical())) || 0
  const counts = summary?.counts || {}
  const sleepHours = summary?.sleep || null

  return (
    <div className="page home-stack">
      {/* ── 问候区：日期 + 问候 + days together ── */}
      <header className="home-header">
        <div className="home-header__date">{longDate(now)}</div>
        <h1 className="home-header__greet">{greeting('静怡', now)}</h1>
        <div style={{
          fontSize: 13, color: 'var(--ink-faint)',
          fontFamily: "'Trebuchet MS', var(--sans-en)",
          marginTop: 4, letterSpacing: '0.02em'
        }}>
          {daysTogether(now)} days together · since {sinceLabel()}
        </div>
      </header>

      <WhisperCard text={summary?.whisper || WHISPER_FALLBACK} />

      {/* ── 今日状态：2x2 网格 + 1 全宽行 ── */}
      <section>
        <div className="section-label">今日状态</div>
        <div className="today-grid">
          <MoodEntryCard />
          <TodayCard
            icon={<Moon size={15} />}
            label="睡眠"
            value={sleepHours}
            unit=" 小时"
            muted={!sleepHours}
          />
          <WaterCard />
          <ExerciseCard />
        </div>
        <div style={{ marginTop: 'var(--gap-card)' }}>
          <TodayCard
            icon={<MessageSquare size={15} />}
            label="今日互动"
            value={todayMessages}
            unit=" 条"
            wide
          />
        </div>
      </section>

      {/* ── 待办 ── */}
      <TodoList />

      {/* ── 今日小票（emet.receipt 开关关时自渲染为空）── */}
      <ReceiptCard />

      {/* ── 综合月历 ── */}
      <UnifiedCalendar />

      {/* ── 里程碑 ── */}
      <section>
        <div className="section-label">Milestones</div>
        <MilestoneList />
      </section>

      {/* ── 统计摘要 ── */}
      <section className="card stats-bar" style={{ justifyContent: 'center' }}>
        <BarChart3 size={16} />
        <span>
          记忆 <Num value={counts.memory} />
          <span className="dot-sep">·</span>
          瞬记 <Num value={counts.moment} />
          <span className="dot-sep">·</span>
          日记 <Num value={counts.diary} />
          <span className="dot-sep">·</span>
          本月消息 <Num value={counts.monthMessages} />
        </span>
      </section>
    </div>
  )
}
