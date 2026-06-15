import Archive from '../components/Archive.jsx'

// 对话档案页：整屏渲染 Archive 组件。
// Archive 自带 100vh 独立布局与内部导航，无需外层返回栏；
// 全局 TabBar 在 /archive 路由由 App 隐藏（见 App.jsx）。
export default function ArchivePage() {
  return <Archive />
}
