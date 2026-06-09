import { Mail } from 'lucide-react'

export default function Messages() {
  return (
    <div className="page">
      <div className="placeholder">
        <Mail size={48} strokeWidth={1.4} />
        <h2>留言</h2>
        <p>留言板 + 灵感板。第一期第 6 步接上 message / idea API。</p>
      </div>
    </div>
  )
}
