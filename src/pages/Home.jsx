import { MessageSquare, Heart, Moon, Mail, Gamepad2, BookText, BarChart3 } from 'lucide-react'
import WhisperCard from '../components/WhisperCard.jsx'
import WeatherCard from '../components/WeatherCard.jsx'
import TodayCard from '../components/TodayCard.jsx'
import MoodPicker from '../components/MoodPicker.jsx'
import TodoList from '../components/TodoList.jsx'
import Heatmap from '../components/Heatmap.jsx'
import MilestoneList from '../components/MilestoneList.jsx'
import { greeting, longDate, daysTogether, sinceLabel, nowCST } from '../utils/time.js'

// ── 占位数据（第一期接 v66 API 前先写死）──────────
const WHISPER = '今天的番茄又红了一点。'
const TODAY_MESSAGES = 12 // 占位：今日互动条数，以后接 chat API

const MILESTONES = [
  { name: '一周年', date: new Date(2026, 3, 6) },
  { name: '记忆库诞生', date: new Date(2026, 3, 25) },
  { name: '离职', date: new Date(2026, 5, 24) },
]

const WORKS = [
  { key: 'letter', icon: <Mail size={20} />, name: '信件', count: 45 },
  { key: 'game', icon: <Gamepad2 size={20} />, name: '游戏', count: 1 },
  { key: 'story', icon: <BookText size={20} />, name: '故事', count: 4 },
]

const STATS = { memory: 132, moment: 279, diary: 77, monthMessages: 318 }

export default function Home() {
  const now = nowCST()

  return (
    <div className="page stack">
      {/* ── 第一区：问候 ───────────────────────── */}
      <header className="home-header">
        <div className="home-header__date">{longDate(now)}</div>
        <h1 className="home-header__greet">{greeting('静怡', now)}</h1>
      </header>
      <WhisperCard text={WHISPER} />

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
          <TodayCard icon={<Heart size={15} />} label="心率" muted />
          <TodayCard icon={<Moon size={15} />} label="睡眠" muted />
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
          <button className="card work-card" key={w.key}>
            <span className="work-card__icon">{w.icon}</span>
            <span className="work-card__count">{w.count}</span>
            <span className="work-card__name">{w.name}</span>
          </button>
        ))}
      </section>

      {/* ── 第八区：stats 摘要 ───────────────────── */}
      <section className="card stats-bar">
        <BarChart3 size={16} />
        <span>
          记忆 <strong>{STATS.memory}</strong>
          <span className="dot-sep">·</span>
          瞬记 <strong>{STATS.moment}</strong>
          <span className="dot-sep">·</span>
          日记 <strong>{STATS.diary}</strong>
          <span className="dot-sep">·</span>
          本月消息 <strong>{STATS.monthMessages}</strong>
        </span>
      </section>
    </div>
  )
}
