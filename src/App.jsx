import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
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
import SpacePage from './pages/SpacePage.jsx'
import MoodPage from './pages/MoodPage.jsx'
import Settings from './pages/Settings.jsx'
import IdleJournal from './pages/IdleJournal.jsx'
import PeriodCalendar from './pages/PeriodCalendar.jsx'
import Bookshelf from './pages/Bookshelf.jsx'
import BookReader from './pages/BookReader.jsx'

export default function App() {
  // 档案页是整屏独立布局，隐藏全局底部 TabBar。
  const location = useLocation()
  // 档案与共读阅读器是整屏沉浸布局，隐藏底部 TabBar（阅读器底部有批注条，避免重叠）
  const hideTabBar = location.pathname === '/archive' || location.pathname === '/mood' || location.pathname.startsWith('/books/')

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
        <Route path="/mood" element={<MoodPage />} />
        <Route path="/space" element={<SpacePage />} />
        <Route path="/space/messages" element={<Messages />} />
        <Route path="/mail" element={<Navigate to="/space" replace />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/archive" element={<ArchivePage />} />
        <Route path="/idle" element={<IdleJournal />} />
        <Route path="/period" element={<PeriodCalendar />} />
        <Route path="/books" element={<Bookshelf />} />
        <Route path="/books/:id" element={<BookReader />} />
      </Routes>
      {!hideTabBar && <TabBar wide={location.pathname === '/chat'} />}
    </div>
  )
}
