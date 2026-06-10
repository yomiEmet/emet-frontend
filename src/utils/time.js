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

// ── 记忆卡片 / 详情用的中文日期格式（沿用旧前端）──────────
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// "2026年4月25日"
export function formatDateZh(iso) {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

// "周五"
export function weekdayZh(iso) {
  if (!iso) return ''
  return WEEKDAYS[new Date(iso).getDay()]
}

// 写入时间：今天→"14:32"，昨天→"昨天 14:32"，更早→"4月25日 14:32"
export function formatCardTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const n = new Date()
  const today0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()
  const t = d.getTime()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (t >= today0) return `${hh}:${mm}`
  if (t >= today0 - 86400000) return `昨天 ${hh}:${mm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
}

// 月份键 "2026-04" → 显示 "2026年4月"
export function monthLabel(ym) {
  if (!ym || ym.length < 7) return ym
  return `${ym.slice(0, 4)}年${parseInt(ym.slice(5, 7), 10)}月`
}

// ── 年轮 / 留言页用（统一东八区，不随设备时区）──────────
// ISO 时间戳 → "字段值等于东八区时间" 的 Date（同 nowCST 的思路）
export function toCST(iso) {
  return new Date(new Date(iso).toLocaleString('en-US', { timeZone: TZ }))
}

// 短日期 "6.9"；跨年时带年份 "2025.4.6"
export function shortDateZh(iso, now = nowCST()) {
  if (!iso) return ''
  const d = toCST(iso)
  const md = `${d.getMonth() + 1}.${d.getDate()}`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}.${md}`
}

// 时段标签："6.9 深夜" 的后半截
export function timeOfDayZh(iso) {
  if (!iso) return ''
  const h = toCST(iso).getHours()
  if (h < 5) return '深夜'
  if (h < 8) return '清晨'
  if (h < 11) return '上午'
  if (h < 13) return '午间'
  if (h < 17) return '下午'
  if (h < 19) return '傍晚'
  if (h < 23) return '夜晚'
  return '深夜'
}

// ISO → 东八区月份键 "2026-06"，瞬记时间线按月分组用
export function monthKeyOf(iso) {
  const d = toCST(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
