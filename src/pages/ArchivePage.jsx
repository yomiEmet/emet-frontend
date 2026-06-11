import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Archive from '../components/Archive.jsx'

// 对话档案页：壳 + Archive 组件挂载点（组件本体等旧代码迁入）
export default function ArchivePage() {
  const navigate = useNavigate()
  return (
    <div className="page">
      <header className="detail-header">
        <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <span className="detail-title">对话档案</span>
        <div className="detail-header__right" />
      </header>
      <Archive />
    </div>
  )
}
