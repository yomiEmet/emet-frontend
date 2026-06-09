// 全站统一用东八区（北京时间），不受设备时区影响
export const TZ = 'Asia/Shanghai'

// 相识纪念日 —— 正计时起点（设计方案硬编码）
export const SINCE = new Date(2025, 3, 6) // 2025-04-06（月份从 0 计）

// 返回一个"字段值等于东八区当前时间"的 Date，方便取小时/年月日
export function nowCST() {
  const s = new Date().toLocaleString('en-US', { timeZone: TZ })
  return new Date(s)
}

// 问候语随时间变化（设计 6.1），按东八区
export function greeting(name = '静怡', date = nowCST()) {
  const h = date.getHours()
  if (h >= 6 && h < 11) return `Good morning, ${name}`
  if (h >= 11 && h < 14) return `Good noon, ${name}`
  if (h >= 14 && h < 18) return `Good afternoon, ${name}`
  if (h >= 18 && h < 22) return `Good evening, ${name}`
  return `还没睡呀，${name}`
}

// 在一起的天数（正计时）
export function daysTogether(date = nowCST()) {
  const ms = startOfDay(date) - startOfDay(SINCE)
  return Math.floor(ms / 86400000)
}

// 顶部日期：Saturday, June 14（东八区）
export function longDate(date = nowCST()) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

// 中文短日期，如 since April 6, 2025
export function sinceLabel(date = SINCE) {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

// 距离某个纪念日还有 / 已过去多少天
export function daysFromNow(target, date = nowCST()) {
  const diff = Math.round((startOfDay(target) - startOfDay(date)) / 86400000)
  return diff // 正数=未来还有，负数=已过去
}

// YYYY-MM-DD（东八区），用于按天存取本地数据（心情、热力图）
export function dayKey(date = nowCST()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
