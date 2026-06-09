// 主页悄悄话卡片 —— 最新一条 from=emet 的留言
// 数据来源：message_read（第一期接 API 前先用占位文案）
export default function WhisperCard({ text }) {
  return (
    <div className="whisper">
      <div className="whisper__label">
        <span>today&apos;s whisper</span>
      </div>
      <p className="whisper__text">{text}</p>
    </div>
  )
}
