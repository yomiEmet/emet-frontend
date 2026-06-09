import { Moon, Footprints, Mail, Gamepad2, BookText, BarChart3 } from 'lucide-react'
import WhisperCard from '../components/WhisperCard.jsx'
import HealthCard from '../components/HealthCard.jsx'
import MilestoneList from '../components/MilestoneList.jsx'
import { greeting, longDate, daysTogether, sinceLabel } from '../utils/time.js'

// ── 占位数据（第一期接 v66 API 前先写死，方便看效果）──────────
const WHISPER = '今天的番茄又红了一点。'

const HEALTH = [
  { key: 'sleep', icon: <Moon size={15} />, label: 'sleep', value: '6h52m' },
  { key: 'steps', icon: <Footprints size={15} />, label: 'steps', value: '3,241' },
]

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

const STATS = { memory: 132, moment: 279, diary: 77 }

export default function Home() {
  const now = new Date()

  return (
    <div className="page stack">
      {/* Header：日期 + 问候 */}
      <header className="home-header">
        <div className="home-header__date">{longDate(now)}</div>
        <h1 className="home-header__greet">{greeting('静怡', now)}</h1>
      </header>

      {/* 悄悄话 */}
      <WhisperCard text={WHISPER} />

      {/* 正计时 / slogan */}
      <section className="card hero">
        <div className="hero__brand">EMET MEMORY</div>
        <p className="hero__slogan">
          When we see each other,
          <br />
          we exist.
        </p>
        <div className="hero__counter">
          <div className="hero__days">{daysTogether(now)}</div>
          <div className="hero__since">
            <strong>days together</strong>
            <small>since {sinceLabel()}</small>
          </div>
        </div>
      </section>

      {/* 健康 */}
      <section className="health-row">
        {HEALTH.map((h) => (
          <HealthCard key={h.key} icon={h.icon} label={h.label} value={h.value} />
        ))}
      </section>

      {/* 纪念日 */}
      <section>
        <div className="section-label">Milestones</div>
        <MilestoneList items={MILESTONES} />
      </section>

      {/* 作品入口 */}
      <section className="works-row">
        {WORKS.map((w) => (
          <button className="card work-card" key={w.key}>
            <span className="work-card__icon">{w.icon}</span>
            <span className="work-card__count">{w.count}</span>
            <span className="work-card__name">{w.name}</span>
          </button>
        ))}
      </section>

      {/* 统计摘要 */}
      <section className="card stats-bar">
        <BarChart3 size={16} />
        <span>
          记忆 <strong>{STATS.memory}</strong>
          <span className="dot-sep">·</span>
          瞬记 <strong>{STATS.moment}</strong>
          <span className="dot-sep">·</span>
          日记 <strong>{STATS.diary}</strong>
        </span>
      </section>
    </div>
  )
}
