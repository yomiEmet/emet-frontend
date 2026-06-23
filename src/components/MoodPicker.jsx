import { useState, useEffect } from 'react'
import { Maximize2 } from 'lucide-react'
import MoodFace from './MoodFace.jsx'
import MoodCalendar from './MoodCalendar.jsx'
import { MOODS, moodMeta } from '../utils/moods.js'
import { moodList, moodSet } from '../api.js'
import { showToast } from '../utils/toast.js'

// today's mood —— 选脸 → 写备注 → 记下（who=yomi，落心情日历）。
// 右上角扩展按钮进入心情日历（月历 + 分布 + 趋势，你和 Emet 都能记）。
function todayKey() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function MoodPicker() {
  const today = todayKey()
  const [saved, setSaved] = useState(null) // 今天已落库的 { mood, note }
  const [draft, setDraft] = useState(null) // 当前选中待记的 mood id
  const [note, setNote] = useState('')
  const [calOpen, setCalOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    moodList({ start: today, end: today })
      .then((r) => {
        if (!alive) return
        const mine = (r?.moods || []).find((e) => e.who === 'yomi')
        if (mine) setSaved({ mood: mine.mood, note: mine.note || '' })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [today])

  const pick = (id) => {
    setDraft(id)
    // 已记过同一个心情 → 把旧备注带出来可改
    setNote(saved?.mood === id ? saved.note : '')
  }

  const save = async () => {
    if (!draft || busy) return
    setBusy(true)
    try {
      await moodSet({ mood: draft, note: note.trim(), who: 'yomi', date: today })
      setSaved({ mood: draft, note: note.trim() })
      setDraft(null)
      setNote('')
      showToast('已记下')
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
              className={'mood-face' + ((draft || saved?.mood) === m.id ? ' is-selected' : '')}
              onClick={() => pick(m.id)}
              title={m.label}
              aria-label={m.label}
              aria-pressed={(draft || saved?.mood) === m.id}
            >
              <MoodFace mood={m.id} />
            </button>
          ))}
        </div>

        {draft ? (
          <div className="mood-write">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`为什么${moodMeta(draft)?.label}？写一句…（可不写）`}
              rows={2}
              autoFocus
            />
            <div className="mood-write__foot">
              <button className="mini-btn" onClick={() => { setDraft(null); setNote('') }} disabled={busy}>
                取消
              </button>
              <button className="mini-btn mini-btn--accent" onClick={save} disabled={busy}>
                {busy ? '记下…' : '记下'}
              </button>
            </div>
          </div>
        ) : saved ? (
          <div className="mood-today-note faint">
            今天：{moodMeta(saved.mood)?.label}
            {saved.note ? ` · ${saved.note}` : ''}
          </div>
        ) : null}
      </div>
      {calOpen && <MoodCalendar onClose={() => setCalOpen(false)} />}
    </>
  )
}
