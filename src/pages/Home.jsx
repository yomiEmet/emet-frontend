import { useState, useEffect } from 'react'
import { MessageSquare, Heart, Moon, BarChart3 } from 'lucide-react'
import WhisperCard from '../components/WhisperCard.jsx'
import TodayCard from '../components/TodayCard.jsx'
import MoodPicker from '../components/MoodPicker.jsx'
import TodoList from '../components/TodoList.jsx'
import Heatmap from '../components/Heatmap.jsx'
import MilestoneList from '../components/MilestoneList.jsx'
import { greeting, longDate, daysTogether, sinceLabel, nowCST, nowLogical, dayKey, logicalDayKey } from '../utils/time.js'
import { homeSummary, healthLatest, subscribeData, memoryAll } from '../api.js'
import { loadSessions } from '../utils/sessions.js'
import { pull as chatPull } from '../utils/sync.js'

// whisper 数据源：moments 里 #whisper 最新一条；都没有时用这句占位
const WHISPER_FALLBACK = '今天的番茄又红了一点。'

// ── 热力图数据（真数据，按逻辑日归属：凌晨4点换天）─────────
// 色阶阈值分开定：记忆每天 0-6 条，互动动辄几十轮
const levelMemory = (c) => (c <= 0 ? 0 : c <= 1 ? 1 : c <= 3 ? 2 : c <= 6 ? 3 : 4)
const levelChat = (c) => (c <= 0 ? 0 : c <= 5 ? 1 : c <= 15 ? 2 : c <= 30 ? 3 : 4)

// 每日互动计数：只数静怡发的消息（拍板口径），今日互动卡与热力图共用
function chatDayCounts() {
  const counts = new Map()
  for (const s of loadSessions()) {
    if (!s || s.deleted) continue
    for (const m of s.messages || []) {
      if (m?.role !== 'user' || !m.ts) continue // 老数据无 ts 的消息跳过
      const k = logicalDayKey(m.ts)
      counts.set(k, (counts.get(k) || 0) + 1)
    }
  }
  return counts
}

// 每日记忆计数：normMemory 的 date 已是逻辑日 key，直接用
function memoryDayCounts(list) {
  const counts = new Map()
  for (const m of list || []) {
    if (!m?.date) continue
    counts.set(m.date, (counts.get(m.date) || 0) + 1)
  }
  return counts
}

// 数字展示：加载中显示占位短横
function Num({ value }) {
  return <strong>{value == null ? '—' : value}</strong>
}

export default function Home() {
  const now = nowCST()
  const [summary, setSummary] = useState(null)
  const [health, setHealth] = useState(null) // Apple Watch 数据，无则 null
  const [memCounts, setMemCounts] = useState(() => new Map())
  const [chatCounts, setChatCounts] = useState(() => chatDayCounts())

  useEffect(() => {
    let alive = true
    const load = () => {
      homeSummary()
        .then((s) => alive && setSummary(s))
        .catch(() => alive && setSummary(null))
      healthLatest().then((h) => alive && setHealth(h))
      memoryAll()
        .then((list) => alive && setMemCounts(memoryDayCounts(list)))
        .catch(() => {})
      setChatCounts(chatDayCounts())
    }
    load()
    // 拉一次云端聊天增量再重数（刚在别的设备聊过也准）；失败静默，本地数据够用
    chatPull()
      .then((n) => n && alive && setChatCounts(chatDayCounts()))
      .catch(() => {})
    // 后台刷新落地后自动重载首页数据（不用切页）
    const unsub = subscribeData(load)
    return () => {
      alive = false
      unsub()
    }
  }, [])

  // 今日互动 = 互动热力里"逻辑日今天"这格，同一口径同一来源
  const todayMessages = chatCounts.get(dayKey(nowLogical())) || 0

  const counts = summary?.counts || {}

  // 睡眠：Apple Watch 数据优先；没数据时兜底用 moments #睡眠 标签解析（旧路径）
  // 只留小时数字，"小时"走 unit 小字，和心率卡的 bpm 一致，窄屏不换行
  const sleepHours = health?.sleep_duration_min
    ? (health.sleep_duration_min / 60).toFixed(1)
    : summary?.sleep || null

  return (
    <div className="page stack">
      {/* ── 第一区：问候 ───────────────────────── */}
      <header className="home-header">
        <div className="home-header__date">{longDate(now)}</div>
        <h1 className="home-header__greet">{greeting('静怡', now)}</h1>
      </header>
      <WhisperCard text={summary?.whisper || WHISPER_FALLBACK} />

      {/* ── 第二区：Emet Memory（slogan 收小）── */}
      <div className="card emet-brand">
        <div className="emet-brand__name">EMET MEMORY</div>
        <p className="emet-brand__slogan">When we see each other, we exist.</p>
        <div className="emet-brand__counter">
          <strong>{daysTogether(now)}</strong> days together
          <span className="faint"> · since {sinceLabel()}</span>
        </div>
      </div>

      {/* ── 第三区：今日数据 ─────────────────────── */}
      <section>
        <div className="section-label">今日数据</div>
        <MoodPicker />
        <div className="today-grid3">
          <TodayCard
            icon={<MessageSquare size={15} />}
            label="今日互动"
            value={todayMessages}
            unit=" 条"
          />
          <TodayCard
            icon={<Heart size={15} />}
            label="心率"
            value={health?.heart_rate ? Math.round(health.heart_rate) : null}
            unit=" bpm"
            muted={!health?.heart_rate}
          />
          <TodayCard
            icon={<Moon size={15} />}
            label="睡眠"
            value={sleepHours}
            unit=" 小时"
            muted={!sleepHours}
          />
        </div>
      </section>

      {/* ── 第四区：待办 ─────────────────────────── */}
      <TodoList />

      {/* ── 第五区：热力图（记忆/互动 双tab，真数据）── */}
      <Heatmap
        datasets={[
          { key: 'memory', label: '记忆', unit: '条', counts: memCounts, level: levelMemory },
          { key: 'chat', label: '互动', unit: '轮', counts: chatCounts, level: levelChat },
        ]}
      />

      {/* ── 第六区：Milestones（可编辑，存本地+设置云同步）── */}
      <section>
        <div className="section-label">Milestones</div>
        <MilestoneList />
      </section>

      {/* ── 第七区：stats 摘要 ───────────────────── */}
      <section className="card stats-bar">
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
