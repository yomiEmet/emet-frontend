import { useState, useEffect } from 'react'
import { Maximize2 } from 'lucide-react'
import MoodFace from './MoodFace.jsx'
import MoodCalendar from './MoodCalendar.jsx'
import { MOODS, moodMeta } from '../utils/moods.js'
import { moodList, moodSet } from '../api.js'
import { showToast } from '../utils/toast.js'

// today's mood —— 选表情即记今天（who=yomi，落心情日历）。
// 右上角扩展按钮进入心情日历（月历 + 分布 + 趋势，你和 Emet 都能记）。
function todayKey() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function MoodPicker() {
  const today = todayKey()
  const [selected, setSelected] = useState(null) // 今天已记的 mood id
  const [calOpen, setCalOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // 进来拉今天 静怡 的记录回显
  useEffect(() => {
    let alive = true
    moodList({ start: today, end: today })
      .then((r) => {
        if (!alive) return
        const mine = (r?.moods || []).find((e) => e.who === 'yomi')
        if (mine) setSelected(mine.mood)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [today])

  const pick = async (id) => {
    if (busy) return
    setBusy(true)
    setSelected(id) // 乐观
    try {
      await moodSet({ mood: id, who: 'yomi', date: today })
    } catch (e) {
      showToast(e?.message || '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="card mood-card">
        <div className="mood-card__head">
          <div className="mood-label">today&apos;s mood</div>
          <button className="mood-expand" onClick={() => setCalOpen(true)} aria-label="心情日历">
            <Maximize2 size={14} />
          </button>
        </div>
        <div className="mood-picker">
          {MOODS.map((m) => (
            <button
              key={m.id}
              className={'mood-face' + (selected === m.id ? ' is-selected' : '')}
              onClick={() => pick(m.id)}
              title={m.label}
              aria-label={m.label}
              aria-pressed={selected === m.id}
            >
              <MoodFace mood={m.id} />
            </button>
          ))}
        </div>
        {selected && (
          <div className="mood-today-note faint">
            今天：{moodMeta(selected)?.label} · 点扩展看日历
          </div>
        )}
      </div>
      {calOpen && <MoodCalendar onClose={() => setCalOpen(false)} />}
    </>
  )
}
