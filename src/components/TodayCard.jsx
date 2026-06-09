// 今日数据网格里的单个小卡片。
// muted=true 时数值显示灰色"暂无数据"（健康类占位）。
export default function TodayCard({ icon, label, value, unit, muted = false, wide = false }) {
  return (
    <div className={'card today-card' + (wide ? ' today-card--wide' : '')}>
      <div className="today-card__label">
        {icon}
        <span>{label}</span>
      </div>
      {muted ? (
        <div className="today-card__value is-muted">暂无数据</div>
      ) : (
        <div className="today-card__value">
          {value}
          {unit && <span className="today-card__unit">{unit}</span>}
        </div>
      )}
    </div>
  )
}
