import { useState } from 'react'
import { nowLogical, dayKey } from '../utils/time.js'

const WEEKS = 13 // 最近约 3 个月
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 纯展示组件：datasets = [{ key, label, unit, counts: Map(逻辑日 dayKey → 次数), level(c)→0..4 }]
// 天的口径统一是"逻辑日"（凌晨 4 点换天），今天格子/未来格子都按逻辑日算。
export default function Heatmap({ datasets = [] }) {
  const [tab, setTab] = useState(datasets[0]?.key)
  const ds = datasets.find((d) => d.key === tab) || datasets[0]
  if (!ds) return null

  const today = nowLogical()
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
      const k = dayKey(d)
      const future = k > todayKey
      const count = future ? -1 : ds.counts.get(k) || 0
      cells.push({ key: k, lvl: future ? -1 : ds.level(count), count, isToday: k === todayKey })
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
          热力图
        </span>
        <span className="heatmap__tabs">
          {datasets.map((d) => (
            <button
              key={d.key}
              className={'heatmap__tab' + (d.key === ds.key ? ' is-active' : '')}
              onClick={() => setTab(d.key)}
            >
              {d.label}
            </button>
          ))}
        </span>
        <span className="faint heatmap__sub">最近 3 个月</span>
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
              title={`${cell.key} · ${ds.label} ${cell.count} ${ds.unit}`}
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
