import { Star, Lock } from 'lucide-react'
import { categoryOf } from '../utils/categories.js'
import { formatDateZh, weekdayZh, formatCardTime, monthKeyOf } from '../utils/time.js'

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

// 搜索高亮（旧版 search-hl）
function Hl({ text, q }) {
  if (!q) return text
  const lower = text.toLowerCase()
  const ql = q.toLowerCase()
  const parts = []
  let i = 0
  let idx
  while ((idx = lower.indexOf(ql, i)) >= 0) {
    if (idx > i) parts.push(text.slice(i, idx))
    parts.push(
      <mark key={idx} className="search-hl">
        {text.slice(idx, idx + q.length)}
      </mark>,
    )
    i = idx + q.length
  }
  parts.push(text.slice(i))
  return parts
}

// 记忆卡片（迁移自旧前端 buildCardHtml）
// query=搜索词高亮；compact=列表视图；onTagClick=点标签进标签空间
export default function MemoryCard({ memory, onClick, query = '', compact = false, onTagClick }) {
  const cat = categoryOf(memory.category)
  const linkCount = memory.linked?.length || 0

  return (
    <div
      className={'card mem-card' + (compact ? ' mem-card--compact' : '') + (memory.locked ? ' is-locked' : '')}
      role="button"
      tabIndex={0}
      data-month={monthKeyOf(memory.created_at)}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
    >
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

      <p className="mem-card__content">
        <Hl text={memory.content} q={query} />
      </p>

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
            <span
              key={t}
              className={'mem-hashtag' + (onTagClick ? ' is-link' : '')}
              onClick={
                onTagClick
                  ? (e) => {
                      e.stopPropagation()
                      onTagClick(t)
                    }
                  : undefined
              }
            >
              #<Hl text={t} q={query} />
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
