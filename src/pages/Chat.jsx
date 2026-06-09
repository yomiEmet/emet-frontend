import { MessageSquare } from 'lucide-react'

export default function Chat() {
  return (
    <div className="page">
      <div className="placeholder">
        <MessageSquare size={48} strokeWidth={1.4} />
        <h2>消息</h2>
        <p>和 Emet 聊天的地方。第三期接入 Anthropic API 后启用。</p>
      </div>
    </div>
  )
}
