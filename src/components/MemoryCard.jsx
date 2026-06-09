import { Star, Lock } from 'lucide-react'
import { categoryOf } from '../utils/categories.js'
import { formatDateZh, weekdayZh, formatCardTime } from '../utils/time.js'

// 重要度圆点：●●●○○（设计 6.3）
function Dots({ n = 0, max = 5 }) {
  return (
    <span className="dots" aria-label={`重要度 ${n}/${max}`}>
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={'dot' + (i < n ? ' is-on' : '')} />
      ))}
    </span>
  )
}

// 记忆卡片（迁移自旧前端 buildCardHtml）
export default function MemoryCard({ memory, onClick }) {
  const cat = categoryOf(memory.category)
  const linkCount = memory.linked?.length || 0

  return (
    <button className="card mem-card" onClick={onClick}>
      {/* 角标：置顶 / 锁定 */}
      {(memory.pinned || memory.locked) && (
        <span className="mem-card__corner">
          {memory.pinned && <Star size={14} className="pin-mark" fill="currentColor" />}
          {memory.locked && <Lock size={13} className="lock-mark" />}
        </span>
      )}

      {/* 日期块：大字 + 周几 + 时间 */}
      <div className="mem-card__date">
        <span className="day-big">{formatDateZh(memory.date)}</span>
        <span className="day-sub">{weekdayZh(memory.date)}</span>
        {memory.created_at && (
          <span className="day-time">{formatCardTime(memory.created_at)}</span>
        )}
      </div>

      <p className="mem-card__content">{memory.content}</p>

      {/* 底部：分类 + 重要度 + 藤蔓 + 标签 */}
      <div className="mem-card__foot">
        <span className="mem-tag" style={{ '--tag-color': cat.color }}>
          {cat.label}
        </span>
        <Dots n={memory.importance} />
        {linkCount > 0 && <span className="link-mark">↳ 藤 {linkCount}</span>}
        {memory.activations > 0 && (
          <span className="faint mem-recall">召回 {memory.activations}</span>
        )}
      </div>

      {memory.tags?.length > 0 && (
        <div className="mem-card__tags">
          {memory.tags.map((t) => (
            <span key={t} className="mem-hashtag">
              #{t}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}
