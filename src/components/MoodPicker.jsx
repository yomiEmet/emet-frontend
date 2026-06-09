import MoodFace from './MoodFace.jsx'
import { useLocalStorage } from '../utils/useLocalStorage.js'
import { dayKey } from '../utils/time.js'

// today's mood —— 一排手绘表情，点击直接选中，按天存本地。
const MOODS = [
  { id: 'happy', label: '开心' },
  { id: 'calm', label: '平静' },
  { id: 'heart', label: '心动' },
  { id: 'excited', label: '兴奋' },
  { id: 'sad', label: '难过' },
  { id: 'anxious', label: '焦虑' },
  { id: 'tired', label: '疲惫' },
]

export default function MoodPicker() {
  const today = dayKey()
  const [moods, setMoods] = useLocalStorage('emet.moods', {})
  const selected = moods[today]

  const pick = (id) =>
    setMoods((prev) => ({ ...prev, [today]: prev[today] === id ? undefined : id }))

  return (
    <div className="card mood-card">
      <div className="mood-label">today&apos;s mood</div>
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
    </div>
  )
}
