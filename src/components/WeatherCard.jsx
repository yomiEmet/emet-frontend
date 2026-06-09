import { Cloud } from 'lucide-react'

// 天气卡片 —— 第一期占位（城市 + 温度 + 图标）。以后接天气 API。
export default function WeatherCard({ city = '福州', temp = '24°', Icon = Cloud }) {
  return (
    <div className="card weather-card">
      <Icon className="weather-card__icon" size={26} strokeWidth={1.6} />
      <div className="weather-card__temp">{temp}</div>
      <div className="weather-card__city">{city}</div>
      <div className="weather-card__tag faint">占位</div>
    </div>
  )
}
