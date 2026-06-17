import { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { getAdminKey } from './api/client.js'
import { pullSettings } from './utils/settingsSync.js'
import TabBar from './components/TabBar.jsx'
import Home from './pages/Home.jsx'
import Chat from './pages/Chat.jsx'
import Memory from './pages/Memory.jsx'
import MemoryDetail from './pages/MemoryDetail.jsx'
import DiaryDetail from './pages/DiaryDetail.jsx'
import MomentDetail from './pages/MomentDetail.jsx'
import ArchivePage from './pages/ArchivePage.jsx'
import Tags from './pages/Tags.jsx'
import TagDetail from './pages/TagDetail.jsx'
import Messages from './pages/Messages.jsx'
import Settings from './pages/Settings.jsx'

export default function App() {
  // 档案页是整屏独立布局，隐藏全局底部 TabBar。
  const location = useLocation()
  const hideTabBar = location.pathname === '/archive'

  // 启动时从云端拉设置（仅有密钥时）；若云端有更新则刷新一次让各组件重读。
  // 刷新后本地已是最新，再拉不会更新 → 不会循环。
  useEffect(() => {
    if (!getAdminKey()) return
    pullSettings()
      .then((applied) => {
        if (applied) window.location.reload()
      })
      .catch(() => {})
  }, [])

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/memory" element={<Memory />} />
        <Route path="/memory/:id" element={<MemoryDetail />} />
        <Route path="/diary/:id" element={<DiaryDetail />} />
        <Route path="/moment/:id" element={<MomentDetail />} />
        <Route path="/tags" element={<Tags />} />
        <Route path="/tags/:tag" element={<TagDetail />} />
        <Route path="/mail" element={<Messages />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/archive" element={<ArchivePage />} />
      </Routes>
      {!hideTabBar && <TabBar />}
    </div>
  )
}
