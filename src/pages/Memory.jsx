import { BookOpen } from 'lucide-react'

export default function Memory() {
  return (
    <div className="page">
      <div className="placeholder">
        <BookOpen size={48} strokeWidth={1.4} />
        <h2>记忆</h2>
        <p>记忆管理 + 年轮时间线。第一期第 4、5 步接上 v66 API。</p>
      </div>
    </div>
  )
}
