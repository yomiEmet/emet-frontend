import { NavLink } from 'react-router-dom'
import { Home, MessageSquare, BookOpen, Layers, Settings } from 'lucide-react'

const TABS = [
  { to: '/', label: '主页', Icon: Home, end: true },
  { to: '/chat', label: '消息', Icon: MessageSquare },
  { to: '/memory', label: '记忆', Icon: BookOpen },
  { to: '/space', label: '空间', Icon: Layers },
  { to: '/settings', label: '设置', Icon: Settings },
]

// wide=true：铺满全宽（聊天页是全宽布局，680px 居中的 TabBar 会在宽屏底部两侧露出空带）
export default function TabBar({ wide = false }) {
  return (
    <nav className={'tabbar' + (wide ? ' tabbar--wide' : '')}>
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
