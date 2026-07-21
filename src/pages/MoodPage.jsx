import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, CalendarDays } from 'lucide-react'
import MoodFace from '../components/MoodFace.jsx'
import MoodCalendar from '../components/MoodCalendar.jsx'
import { moodList, moodSet } from '../api.js'
import { MOODS_BY_VALENCE, moodOf } from '../utils/moods.js'
import { dayKey, nowLogical, nowCST } from '../utils/time.js'
import { showToast } from '../utils/toast.js'

// 滑块档位 = 按 valence 从低到高排的 7 个心情（难过…兴奋）。
// 写入发英文 id（后端 mood_set 契约），读回按 id 反查档位——与 MoodPicker 同一套数据模型。
const STOPS = MOODS_BY_VALENCE
const MID = Math.floor(STOPS.length / 2)

function formatDate(d) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

const sliderTrack = (idx) => {
  const pct = (idx / (STOPS.length - 1)) * 100
  return { background: `linear-gradient(90deg, var(--accent-soft) 0%, var(--accent) ${pct}%, var(--line) ${pct}%)` }
}

export default function MoodPage() {
  const navigate = useNavigate()
  const today = dayKey(nowLogical())
  const now = nowCST()

  const [idx, setIdx] = useState(MID) // 默认平静档
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)
  const [recentDays, setRecentDays] = useState([])
  const [calOpen, setCalOpen] = useState(false) // 历史/趋势日历（共写+备注+分布+趋势）

  useEffect(() => {
    const d = new Date(now)
    d.setDate(d.getDate() - 3)
    const start = dayKey(d)
    moodList({ start, end: today })
      .then(r => {
        const moods = (r?.moods || []).filter(m => m.who === 'yomi')
        const todayMood = moods.find(m => m.date === today)
        if (todayMood) {
          const i = STOPS.findIndex(s => s.id === todayMood.mood)
          if (i >= 0) setIdx(i)
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

  const cur = STOPS[idx]

  const doSave = async () => {
    try {
      await moodSet({ mood: cur.id, note, who: 'yomi', date: today })
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
        <button onClick={() => setCalOpen(true)} style={{ display: 'flex', color: 'var(--ink-soft)' }} aria-label="心情日历">
          <CalendarDays size={20} />
        </button>
      </div>

      {/* 当下感受 */}
      <div className="card" style={{ padding: '24px 20px', textAlign: 'center', marginBottom: 'var(--gap-section)' }}>
        <div style={{ color: cur.color, marginBottom: 8, display: 'flex', justifyContent: 'center' }}>
          <MoodFace mood={cur.id} size={56} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', marginBottom: 16 }}>
          {cur.label}
        </div>
        <div style={{ padding: '0 8px' }}>
          <input
            type="range" min="0" max={STOPS.length - 1} value={idx}
            onChange={e => { setIdx(+e.target.value); setSaved(false) }}
            className="slider" style={{ width: '100%', ...sliderTrack(idx) }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
            <span>低落</span><span>平静</span><span>开心</span>
          </div>
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
            {recentDays.map(m => {
              const meta = moodOf(m)
              const pct = meta ? ((meta.valence + 1) / 2) * 100 : 50
              return (
                <div key={m.date} className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ color: meta?.color || 'var(--ink-faint)', display: 'flex' }}>
                    <MoodFace mood={meta?.id || 'calm'} size={24} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{m.date.slice(5).replace('-', '/')}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{meta?.label || m.mood}</div>
                  </div>
                  <div style={{
                    width: 40, height: 4, borderRadius: 2, background: 'var(--line)',
                    position: 'relative', overflow: 'hidden'
                  }}>
                    <div style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0,
                      width: `${pct}%`, borderRadius: 2,
                      background: 'var(--accent)'
                    }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {calOpen && <MoodCalendar onClose={() => setCalOpen(false)} />}
    </div>
  )
}
