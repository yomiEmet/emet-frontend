import { useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'

// 旧路由 /mail 迁到 /space/messages。保留 ?tab= 转发——旧推送/信件深链
//（如做梦推送的 /mail?tab=feed）的 tab 命名与 Messages 完全一致，转发后老链接全部复活。
function MailRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/space/messages${search}`} replace />
}
import { getAdminKey } from './api/client.js'
import { pullSettings } from './utils/settingsSync.js'
import TabBar from './components/TabBar.jsx'
// 首屏两页(主页/聊天)静态引入——最常打开，不该为它们多等一次网络往返。
import Home from './pages/Home.jsx'
import Chat from './pages/Chat.jsx'
// 其余按路由懒加载：打开哪页才下载哪页的代码。
// 手机首开原本要吞下整包 573KB（21 个页面全在里面），拆开后首屏只load 用得着的部分。
const Memory = lazy(() => import('./pages/Memory.jsx'))
const MemoryDetail = lazy(() => import('./pages/MemoryDetail.jsx'))
const DiaryDetail = lazy(() => import('./pages/DiaryDetail.jsx'))
const MomentDetail = lazy(() => import('./pages/MomentDetail.jsx'))
const ArchivePage = lazy(() => import('./pages/ArchivePage.jsx'))
const Tags = lazy(() => import('./pages/Tags.jsx'))
const TagDetail = lazy(() => import('./pages/TagDetail.jsx'))
const Messages = lazy(() => import('./pages/Messages.jsx'))
const SpacePage = lazy(() => import('./pages/SpacePage.jsx'))
const IdeasPage = lazy(() => import('./pages/IdeasPage.jsx'))
const MoodPage = lazy(() => import('./pages/MoodPage.jsx'))
const WaterPage = lazy(() => import('./pages/WaterPage.jsx'))
const Settings = lazy(() => import('./pages/Settings.jsx'))
const Automations = lazy(() => import('./pages/Automations.jsx'))
const IdleJournal = lazy(() => import('./pages/IdleJournal.jsx'))
const PeriodCalendar = lazy(() => import('./pages/PeriodCalendar.jsx'))
const Bookshelf = lazy(() => import('./pages/Bookshelf.jsx'))
const BookReader = lazy(() => import('./pages/BookReader.jsx'))

export default function App() {
  // 档案页是整屏独立布局，隐藏全局底部 TabBar。
  const location = useLocation()
  // 档案与共读阅读器是整屏沉浸布局，隐藏底部 TabBar（阅读器底部有批注条，避免重叠）
  const hideTabBar = location.pathname === '/archive' || location.pathname === '/mood' || location.pathname === '/water' || location.pathname.startsWith('/books/')

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
      {/* 懒加载页面到达前的占位：极轻，避免白屏闪动 */}
      <Suspense fallback={<p className="faint list-hint" style={{ padding: '24px 16px' }}>加载中…</p>}>
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
        <Route path="/water" element={<WaterPage />} />
        <Route path="/space" element={<SpacePage />} />
        <Route path="/space/messages" element={<Messages />} />
        <Route path="/space/ideas" element={<IdeasPage />} />
        <Route path="/mail" element={<MailRedirect />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/automations" element={<Automations />} />
        <Route path="/archive" element={<ArchivePage />} />
        <Route path="/idle" element={<IdleJournal />} />
        <Route path="/period" element={<PeriodCalendar />} />
        <Route path="/books" element={<Bookshelf />} />
        <Route path="/books/:id" element={<BookReader />} />
      </Routes>
      </Suspense>
      {!hideTabBar && <TabBar wide={location.pathname === '/chat'} />}
    </div>
  )
}
