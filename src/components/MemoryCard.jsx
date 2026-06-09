import { categoryOf } from '../utils/categories.js'

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

// 记忆卡片（设计 4.3a）
export default function MemoryCard({ memory, onClick }) {
  const cat = categoryOf(memory.category)
  return (
    <button className="card mem-card" onClick={onClick}>
      <div className="mem-card__top">
        <span className="mem-tag" style={{ '--tag-color': cat.color }}>
          {cat.label}
        </span>
        <Dots n={memory.importance} />
      </div>

      <p className="mem-card__content">{memory.content}</p>

      {memory.tags?.length > 0 && (
        <div className="mem-card__tags">
          {memory.tags.map((t) => (
            <span key={t} className="mem-hashtag">
              #{t}
            </span>
          ))}
        </div>
      )}

      <div className="mem-card__meta faint">
        <span>{memory.date}</span>
        {memory.activations != null && <span>召回 {memory.activations} 次</span>}
      </div>
    </button>
  )
}
