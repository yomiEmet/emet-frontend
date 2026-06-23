import { useState } from 'react'
import MoodFace from './MoodFace.jsx'
import { momentCreate } from '../api.js'
import { showToast } from '../utils/toast.js'

// today's mood —— 选表情 + 写一句（可不写） → 落成带"心情"tag 的瞬记
// 之前只存 localStorage，不能回顾。现在走瞬记池，年轮 tab 自动能看到历史。
const MOODS = [
  { id: 'happy', label: '开心', mood: 0.8 },
  { id: 'calm', label: '平静', mood: 0.3 },
  { id: 'heart', label: '心动', mood: 0.7 },
  { id: 'excited', label: '兴奋', mood: 0.9 },
  { id: 'sad', label: '难过', mood: -0.6 },
  { id: 'anxious', label: '焦虑', mood: -0.4 },
  { id: 'tired', label: '疲惫', mood: -0.2 },
]

export default function MoodPicker() {
  const [picked, setPicked] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!picked || busy) return
    const m = MOODS.find((x) => x.id === picked)
    setBusy(true)
    try {
      await momentCreate({
        content: text.trim() || m.label,
        tags: ['心情', picked],
        mood: m.mood,
      })
      showToast('已记下 · 去年轮看')
      setPicked(null)
      setText('')
    } catch (e) {
      showToast(e?.message || '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card mood-card">
      <div className="mood-label">today&apos;s mood</div>
      <div className="mood-picker">
        {MOODS.map((m) => (
          <button
            key={m.id}
            className={'mood-face' + (picked === m.id ? ' is-selected' : '')}
            onClick={() => setPicked(picked === m.id ? null : m.id)}
            title={m.label}
            aria-label={m.label}
            aria-pressed={picked === m.id}
          >
            <MoodFace mood={m.id} />
          </button>
        ))}
      </div>
      {picked && (
        <div className="mood-write">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`想说点什么？为什么${MOODS.find((m) => m.id === picked).label}…（可不写）`}
            rows={2}
            autoFocus
          />
          <div className="mood-write__foot">
            <button
              className="mini-btn"
              onClick={() => {
                setPicked(null)
                setText('')
              }}
              disabled={busy}
            >
              取消
            </button>
            <button
              className="mini-btn mini-btn--accent"
              onClick={save}
              disabled={busy}
            >
              {busy ? '记下…' : '记下'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
