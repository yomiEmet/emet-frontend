import { Routes, Route } from 'react-router-dom'
import TabBar from './components/TabBar.jsx'
import Home from './pages/Home.jsx'
import Chat from './pages/Chat.jsx'
import Memory from './pages/Memory.jsx'
import MemoryDetail from './pages/MemoryDetail.jsx'
import DiaryDetail from './pages/DiaryDetail.jsx'
import Messages from './pages/Messages.jsx'
import Settings from './pages/Settings.jsx'

export default function App() {
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/memory" element={<Memory />} />
        <Route path="/memory/:id" element={<MemoryDetail />} />
        <Route path="/diary/:id" element={<DiaryDetail />} />
        <Route path="/mail" element={<Messages />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
      <TabBar />
    </div>
  )
}
