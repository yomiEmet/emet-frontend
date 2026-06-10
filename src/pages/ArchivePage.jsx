import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Archive } from 'lucide-react'

// 对话档案占位。下一步把旧前端的 Archive 组件（conversations.json 浏览器）迁过来。
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
      <div className="placeholder">
        <Archive size={48} strokeWidth={1.4} />
        <h2>对话档案</h2>
        <p>上传 conversations.json 浏览聊天记录。旧 Archive 组件待迁入。</p>
      </div>
    </div>
  )
}
