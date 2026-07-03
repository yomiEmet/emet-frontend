import { useNavigate } from 'react-router-dom'
import Archive from '../components/Archive.jsx'

// 对话档案页：整屏渲染 Archive 组件。
// Archive 自带 100vh 独立布局与内部导航；全局 TabBar 在 /archive 路由由 App 隐藏（见 App.jsx）。
// onExit 提供页内退出（Archive 本身不依赖 router，保持纯净）：
// 优先返回上一页，直接输入 URL 进来没历史时兜底回记忆页。
export default function ArchivePage() {
  const nav = useNavigate()
  const onExit = () => {
    if (window.history.length > 1) nav(-1)
    else nav('/memory')
  }
  return <Archive onExit={onExit} />
}
