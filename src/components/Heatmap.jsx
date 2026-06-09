import { nowCST, dayKey } from '../utils/time.js'

const WEEKS = 13 // 最近约 3 个月
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 占位：按日期生成确定性的"写入次数"，接 v66 API 后换成真实数据。
// 确定性 = 同一天每次渲染颜色一致，不闪烁。
function mockCount(date) {
  const n = Math.floor(date.getTime() / 86400000)
  const v = ((n * 1103515245 + 12345) >>> 8) % 100
  if (v < 52) return 0
  if (v < 73) return 1
  if (v < 87) return 2
  if (v < 96) return 4
  return 7
}

function level(c) {
  if (c <= 0) return 0
  if (c <= 1) return 1
  if (c <= 3) return 2
  if (c <= 6) return 3
  return 4
}

export default function Heatmap() {
  const today = nowCST()
  const todayKey = dayKey(today)
  const wd = today.getDay() // 0=周日

  // 网格起点：第一列的周日
  const start = new Date(today)
  start.setDate(start.getDate() - ((WEEKS - 1) * 7 + wd))

  const cells = []
  const monthLabels = []
  for (let c = 0; c < WEEKS; c++) {
    let labeled = false
    for (let r = 0; r < 7; r++) {
      const d = new Date(start)
      d.setDate(start.getDate() + c * 7 + r)
      const future = d > today
      const k = dayKey(d)
      const count = future ? -1 : mockCount(d)
      cells.push({ key: k, lvl: future ? -1 : level(count), count, isToday: k === todayKey })
      // 该列第一天若是某月 1~7 号，标月份
      if (!labeled && d.getDate() <= 7 && !future) {
        monthLabels.push({ col: c, text: MONTH_ABBR[d.getMonth()] })
        labeled = true
      }
    }
  }

  return (
    <div className="card heatmap">
      <div className="heatmap__head">
        <span className="section-label" style={{ margin: 0 }}>
          记忆热力图
        </span>
        <span className="faint heatmap__sub">最近 3 个月 · 占位</span>
      </div>

      <div className="heatmap__months" style={{ gridTemplateColumns: `repeat(${WEEKS}, 1fr)` }}>
        {Array.from({ length: WEEKS }).map((_, c) => {
          const m = monthLabels.find((x) => x.col === c)
          return (
            <span key={c} className="heatmap__month">
              {m ? m.text : ''}
            </span>
          )
        })}
      </div>

      <div className="heatmap__grid">
        {cells.map((cell, i) =>
          cell.lvl < 0 ? (
            <span key={i} className="heat-cell is-empty" />
          ) : (
            <span
              key={i}
              className={'heat-cell lvl-' + cell.lvl + (cell.isToday ? ' is-today' : '')}
              title={`${cell.key} · 写入 ${cell.count}`}
            />
          )
        )}
      </div>

      <div className="heatmap__legend">
        <span className="faint">少</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={'heat-cell lvl-' + l} />
        ))}
        <span className="faint">多</span>
      </div>
    </div>
  )
}
