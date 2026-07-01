import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Heart, Moon, Mail, Gamepad2, BookText, BarChart3 } from 'lucide-react'
import WhisperCard from '../components/WhisperCard.jsx'
import WeatherCard from '../components/WeatherCard.jsx'
import TodayCard from '../components/TodayCard.jsx'
import MoodPicker from '../components/MoodPicker.jsx'
import TodoList from '../components/TodoList.jsx'
import Heatmap from '../components/Heatmap.jsx'
import MilestoneList from '../components/MilestoneList.jsx'
import { greeting, longDate, daysTogether, sinceLabel, nowCST } from '../utils/time.js'
import { homeSummary, healthLatest, subscribeData } from '../api.js'

// ── 仍是占位的部分 ──────────────────────────────────────
// whisper 数据源：moments 里 #whisper 最新一条；都没有时用这句占位
const WHISPER_FALLBACK = '今天的番茄又红了一点。'
const TODAY_MESSAGES = 12 // 占位：今日互动条数，接 chat API 前先写死

const MILESTONES = [
  { name: '一周年', date: new Date(2026, 3, 6) },
  { name: '记忆库诞生', date: new Date(2026, 3, 25) },
  { name: '离职', date: new Date(2026, 5, 24) },
]

// 作品入口（图标/名字静态，数量从 /api/data 实时拉）
// 信件点击跳 /mail?tab=letter；游戏/故事还没接路由先留 null
const WORKS = [
  { key: 'letter', icon: <Mail size={20} />, name: '信件', countKey: 'letter', to: '/mail?tab=letter' },
  { key: 'game', icon: <Gamepad2 size={20} />, name: '游戏', countKey: 'game', to: null },
  { key: 'story', icon: <BookText size={20} />, name: '故事', countKey: 'story', to: null },
]

// 数字展示：加载中显示占位短横
function Num({ value }) {
  return <strong>{value == null ? '—' : value}</strong>
}

export default function Home() {
  const navigate = useNavigate()
  const now = nowCST()
  const [summary, setSummary] = useState(null)
  const [health, setHealth] = useState(null) // Apple Watch 数据，无则 null

  useEffect(() => {
    let alive = true
    const load = () => {
      homeSummary()
        .then((s) => alive && setSummary(s))
        .catch(() => alive && setSummary(null))
      healthLatest().then((h) => alive && setHealth(h))
    }
    load()
    // 后台刷新落地后自动重载首页数据（不用切页）
    const unsub = subscribeData(load)
    return () => {
      alive = false
      unsub()
    }
  }, [])

  const counts = summary?.counts || {}

  // 睡眠：Apple Watch 数据优先；没数据时兜底用 moments #睡眠 标签解析（旧路径）
  const sleepFromHealth = health?.sleep_duration_min
    ? `${(health.sleep_duration_min / 60).toFixed(1)} 小时`
    : null
  const sleepDisplay = sleepFromHealth || summary?.sleep

  return (
    <div className="page stack">
      {/* ── 第一区：问候 ───────────────────────── */}
      <header className="home-header">
        <div className="home-header__date">{longDate(now)}</div>
        <h1 className="home-header__greet">{greeting('静怡', now)}</h1>
      </header>
      <WhisperCard text={summary?.whisper || WHISPER_FALLBACK} />

      {/* ── 第二区：Emet Memory（slogan 收小 + 天气）── */}
      <section className="emet-row">
        <div className="card emet-brand">
          <div className="emet-brand__name">EMET MEMORY</div>
          <p className="emet-brand__slogan">When we see each other, we exist.</p>
          <div className="emet-brand__counter">
            <strong>{daysTogether(now)}</strong> days together
            <span className="faint"> · since {sinceLabel()}</span>
          </div>
        </div>
        <WeatherCard />
      </section>

      {/* ── 第三区：今日数据 ─────────────────────── */}
      <section>
        <div className="section-label">今日数据</div>
        <MoodPicker />
        <div className="today-grid3">
          <TodayCard
            icon={<MessageSquare size={15} />}
            label="今日互动"
            value={TODAY_MESSAGES}
            unit=" 条"
          />
          <TodayCard
            icon={<Heart size={15} />}
            label="心率"
            value={health?.heart_rate}
            unit=" bpm"
            muted={!health?.heart_rate}
          />
          <TodayCard
            icon={<Moon size={15} />}
            label="睡眠"
            value={sleepDisplay}
            muted={!sleepDisplay}
          />
        </div>
      </section>

      {/* ── 第四区：待办 ─────────────────────────── */}
      <TodoList />

      {/* ── 第五区：记忆热力图 ───────────────────── */}
      <Heatmap />

      {/* ── 第六区：Milestones ───────────────────── */}
      <section>
        <div className="section-label">Milestones</div>
        <MilestoneList items={MILESTONES} />
      </section>

      {/* ── 第七区：作品入口 ─────────────────────── */}
      <section className="works-row">
        {WORKS.map((w) => (
          <button
            className="card work-card"
            key={w.key}
            disabled={!w.to}
            onClick={() => w.to && navigate(w.to)}
          >
            <span className="work-card__icon">{w.icon}</span>
            <span className="work-card__count">
              {counts[w.countKey] == null ? '—' : counts[w.countKey]}
            </span>
            <span className="work-card__name">{w.name}</span>
          </button>
        ))}
      </section>

      {/* ── 第八区：stats 摘要 ───────────────────── */}
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
