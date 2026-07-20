import { useNavigate } from 'react-router-dom'
import { Mail, MessageSquare, BookOpen, Moon, Lightbulb, Rss } from 'lucide-react'

const ENTRIES = [
  { icon: Mail,          label: '信件',     desc: '交接信与日常信',      to: '/space/messages?tab=letter' },
  { icon: MessageSquare, label: '留言板',   desc: '给彼此的留言',        to: '/space/messages?tab=board' },
  { icon: Rss,           label: '动态',     desc: '日常动态流',          to: '/space/messages?tab=feed' },
  { icon: BookOpen,      label: '书架',     desc: '一起读过的书',        to: '/books' },
  { icon: Moon,          label: '独处手账', desc: '安静时的记录',        to: '/idle' },
  { icon: Lightbulb,     label: '灵感板',   desc: '随手记下的想法',      to: '/space/ideas' },
]

export default function SpacePage() {
  const navigate = useNavigate()

  return (
    <div className="page stack">
      <header style={{ marginBottom: 4 }}>
        <h1 style={{ fontFamily: 'var(--serif-zh)', fontSize: 20, fontWeight: 500 }}>空间</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-faint)', marginTop: 4 }}>属于我们的角落</p>
      </header>

      <div className="space-grid">
        {ENTRIES.map(({ icon: Icon, label, desc, to }) => (
          <button key={to} className="card space-entry" onClick={() => navigate(to)}>
            <div className="space-entry__icon">
              <Icon size={20} />
            </div>
            <div className="space-entry__label">{label}</div>
            <div className="space-entry__desc">{desc}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
