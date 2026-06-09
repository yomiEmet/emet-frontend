// 健康数据卡片 —— 第四期接 HealthKit，第一期先占位
export default function HealthCard({ icon, label, value }) {
  return (
    <div className="card health-card">
      <div className="health-card__label">
        {icon}
        <span>{label}</span>
      </div>
      <div className="health-card__value">{value}</div>
    </div>
  )
}
