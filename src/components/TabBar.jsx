import { NavLink } from 'react-router-dom'
import { Home, MessageSquare, BookOpen, Mail, Settings } from 'lucide-react'

const TABS = [
  { to: '/', label: '主页', Icon: Home, end: true },
  { to: '/chat', label: '消息', Icon: MessageSquare },
  { to: '/memory', label: '记忆', Icon: BookOpen },
  { to: '/mail', label: '留言', Icon: Mail },
  { to: '/settings', label: '设置', Icon: Settings },
]

export default function TabBar() {
  return (
    <nav className="tabbar">
      {TABS.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            'tabbar__item' + (isActive ? ' is-active' : '')
          }
        >
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
