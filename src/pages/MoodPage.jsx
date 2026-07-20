import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { moodList, moodSet } from '../api.js'
import { dayKey, nowLogical, nowCST } from '../utils/time.js'
import { showToast } from '../utils/toast.js'

const MOOD_EMOJI = ['', '😞', '😔', '🫤', '😐', '😌', '🙂', '😊', '😄', '🥰', '🤩']
const MOOD_LABELS = ['', '很差', '差', '低落', '一般', '平静', '还好', '不错', '开心', '很开心', '超开心']
const OVERALL_LABELS = ['', '很差', '差', '不太好', '一般', '还行', '还好', '不错', '好', '很好', '超棒']

const sliderTrack = (val) => ({
  background: `linear-gradient(90deg, var(--accent-soft) 0%, var(--accent) ${val * 10}%, var(--line) ${val * 10}%)`,
})

function formatDate(d) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export default function MoodPage() {
  const navigate = useNavigate()
  const today = dayKey(nowLogical())
  const now = nowCST()

  const [currentMood, setCurrentMood] = useState(5)
  const [overallMood, setOverallMood] = useState(5)
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)
  const [recentDays, setRecentDays] = useState([])

  useEffect(() => {
    const end = today
    const d = new Date(now)
    d.setDate(d.getDate() - 3)
    const start = dayKey(d)
    moodList({ start, end })
      .then(r => {
        const moods = (r?.moods || []).filter(m => m.who === 'yomi')
        const todayMood = moods.find(m => m.date === today)
        if (todayMood) {
          setCurrentMood(todayMood.valence || 5)
          setNote(todayMood.note || '')
          setSaved(true)
        }
        const recent = moods
          .filter(m => m.date !== today)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 3)
        setRecentDays(recent)
      })
      .catch(() => {})
  }, [])

  const doSave = async () => {
    const label = MOOD_LABELS[currentMood]
    try {
      await moodSet({ mood: label, note, who: 'yomi', date: today })
      setSaved(true)
      showToast('心情已记录')
    } catch {
      showToast('保存失败')
    }
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button onClick={() => navigate(-1)} style={{ display: 'flex', color: 'var(--ink)' }}>
          <ChevronLeft size={22} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--serif-zh)', fontSize: 18, fontWeight: 500 }}>今日心情</div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{formatDate(now)}</div>
        </div>
      </div>

      {/* 当下感受 */}
      <div className="card" style={{ padding: '24px 20px', textAlign: 'center', marginBottom: 'var(--gap-section)' }}>
        <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 8 }}>
          {MOOD_EMOJI[currentMood]}
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', marginBottom: 16 }}>
          {MOOD_LABELS[currentMood]}
        </div>
        <div style={{ padding: '0 8px' }}>
          <input
            type="range" min="1" max="10" value={currentMood}
            onChange={e => { setCurrentMood(+e.target.value); setSaved(false) }}
            className="slider" style={{ width: '100%', ...sliderTrack(currentMood) }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
            <span>低落</span><span>平静</span><span>开心</span>
          </div>
        </div>
      </div>

      {/* 今天整体感受 */}
      <div className="card" style={{ padding: '18px 20px', marginBottom: 'var(--gap-section)' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-soft)', marginBottom: 12 }}>今天整体感受</div>
        <div style={{ padding: '0 8px' }}>
          <input
            type="range" min="1" max="10" value={overallMood}
            onChange={e => setOverallMood(+e.target.value)}
            className="slider" style={{ width: '100%', ...sliderTrack(overallMood) }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
            <span>很差</span><span>一般</span><span>很好</span>
          </div>
        </div>
        <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--accent)', marginTop: 8 }}>
          {OVERALL_LABELS[overallMood]}
        </div>
      </div>

      {/* 心情笔记 */}
      <div className="card" style={{ padding: '18px 20px', marginBottom: 'var(--gap-section)' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-soft)', marginBottom: 8 }}>心情笔记</div>
        <textarea
          value={note}
          onChange={e => { setNote(e.target.value); setSaved(false) }}
          placeholder="今天感觉怎么样？"
          rows={3}
          style={{
            width: '100%', border: 'none', outline: 'none', resize: 'none',
            background: 'transparent', fontFamily: 'inherit', fontSize: 14,
            lineHeight: 1.7, color: 'var(--ink)'
          }}
        />
      </div>

      <button
        className="detail-save"
        onClick={doSave}
        disabled={saved}
        style={{ marginBottom: 24 }}
      >
        {saved ? '已保存' : '保存心情'}
      </button>

      {/* 最近记录 */}
      {recentDays.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-soft)', marginBottom: 12 }}>最近记录</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {recentDays.map(m => (
              <div key={m.date} className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 24 }}>{MOOD_EMOJI[m.valence] || '😐'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{m.date.slice(5).replace('-', '/')}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{m.mood}</div>
                </div>
                <div style={{
                  width: 40, height: 4, borderRadius: 2, background: 'var(--line)',
                  position: 'relative', overflow: 'hidden'
                }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: `${(m.valence || 5) * 10}%`, borderRadius: 2,
                    background: 'var(--accent)'
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
