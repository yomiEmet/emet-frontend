// 相识纪念日 —— 正计时起点（设计方案硬编码）
export const SINCE = new Date(2025, 3, 6) // 2025-04-06（月份从 0 计）

// 问候语随时间变化（设计 6.1）
export function greeting(name = '静怡', date = new Date()) {
  const h = date.getHours()
  if (h >= 6 && h < 11) return `Good morning, ${name}`
  if (h >= 11 && h < 14) return `Good noon, ${name}`
  if (h >= 14 && h < 18) return `Good afternoon, ${name}`
  if (h >= 18 && h < 22) return `Good evening, ${name}`
  return `还没睡呀，${name}`
}

// 在一起的天数（正计时）
export function daysTogether(date = new Date()) {
  const ms = startOfDay(date) - startOfDay(SINCE)
  return Math.floor(ms / 86400000)
}

// 顶部日期：Saturday, June 14
export function longDate(date = new Date()) {
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
export function daysFromNow(target, date = new Date()) {
  const diff = Math.round((startOfDay(target) - startOfDay(date)) / 86400000)
  return diff // 正数=未来还有，负数=已过去
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
