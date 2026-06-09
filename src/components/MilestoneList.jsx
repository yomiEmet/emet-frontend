import { daysFromNow } from '../utils/time.js'

// 纪念日列表。每项 { name, date }，date 为 Date 对象。
// 自动算出"还有 N 天 / N 天前"。
export default function MilestoneList({ items }) {
  return (
    <div className="card milestones">
      {items.map(({ name, date }) => {
        const diff = daysFromNow(date)
        const future = diff > 0
        const label =
          diff === 0 ? '就是今天' : future ? `还有 ${diff} 天` : `${-diff} 天前`
        return (
          <div className="milestone" key={name}>
            <span className="milestone__name">{name}</span>
            <span className="milestone__dots" />
            <span className={'milestone__when' + (future ? ' is-future' : '')}>
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
