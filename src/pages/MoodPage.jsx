import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, CalendarDays, X } from 'lucide-react'
import PleasantFace from '../components/PleasantFace.jsx'
import MoodCalendar from '../components/MoodCalendar.jsx'
import { moodList, moodSet, emotionList, emotionAdd, emotionDelete } from '../api.js'
import { PLEASANT, pleasantMeta, levelOfValence } from '../utils/moods.js'
import { dayKey, nowLogical, nowCST, toCST } from '../utils/time.js'
import { showToast } from '../utils/toast.js'

const MID = 4 // 平静档

function formatDate(d) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
const p2 = (n) => String(n).padStart(2, '0')
// d 为"字段值等于东八区"的 Date（nowCST / toCST 的产物）
function hhmm(d) {
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}
const trackFor = (level) => {
  const pct = ((level - 1) / (PLEASANT.length - 1)) * 100
  return { background: `linear-gradient(90deg, var(--accent-soft) 0%, var(--accent) ${pct}%, var(--line) ${pct}%)` }
}

// 愉悦度选择块：大脸 + 标签 + 7 档滑块（情绪/心情共用）
function PleasantPicker({ level, setLevel }) {
  const meta = pleasantMeta(level)
  return (
    <div className="card" style={{ padding: '24px 20px', textAlign: 'center', marginBottom: 'var(--gap-card)' }}>
      <div style={{ color: meta.color, marginBottom: 8, display: 'flex', justifyContent: 'center' }}>
        <PleasantFace level={level} size={56} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', marginBottom: 16 }}>{meta.label}</div>
      <div style={{ padding: '0 8px' }}>
        <input
          type="range" min="1" max={PLEASANT.length} value={level}
          onChange={e => setLevel(+e.target.value)}
          className="slider" style={{ width: '100%', ...trackFor(level) }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
          <span>不愉快</span><span>平静</span><span>愉快</span>
        </div>
      </div>
    </div>
  )
}

function NoteCard({ note, setNote, placeholder }) {
  return (
    <div className="card" style={{ padding: '16px 20px', marginBottom: 'var(--gap-card)' }}>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder={placeholder}
        rows={2}
        style={{
          width: '100%', border: 'none', outline: 'none', resize: 'none',
          background: 'transparent', fontFamily: 'inherit', fontSize: 14,
          lineHeight: 1.7, color: 'var(--ink)'
        }}
      />
    </div>
  )
}

export default function MoodPage() {
  const navigate = useNavigate()
  const today = dayKey(nowLogical())
  const now = nowCST()

  const [tab, setTab] = useState('emotion') // emotion=情绪·当下 | mood=心情·整体
  const [calOpen, setCalOpen] = useState(false)

  // 情绪（当下，可多条）
  const [emoLevel, setEmoLevel] = useState(MID)
  const [emoNote, setEmoNote] = useState('')
  const [emoBusy, setEmoBusy] = useState(false)
  const [todayEmotions, setTodayEmotions] = useState([])

  // 心情（今天整体，一条）
  const [moodLevel, setMoodLevel] = useState(MID)
  const [moodNote, setMoodNote] = useState('')
  const [moodSaved, setMoodSaved] = useState(false)

  const loadEmotions = () => {
    emotionList({ start: today, end: today })
      .then(r => setTodayEmotions((r?.emotions || []).filter(e => e.who === 'yomi')))
      .catch(() => {})
  }

  useEffect(() => {
    loadEmotions()
    moodList({ start: today, end: today })
      .then(r => {
        const mine = (r?.moods || []).find(m => m.who === 'yomi' && m.date === today)
        if (mine) {
          const lv = mine.level != null ? mine.level : levelOfValence(mine.valence)?.level || MID
          setMoodLevel(lv)
          setMoodNote(mine.note || '')
          setMoodSaved(true)
        }
      })
      .catch(() => {})
  }, [])

  const saveEmotion = async () => {
    if (emoBusy) return
    setEmoBusy(true)
    try {
      await emotionAdd({ level: emoLevel, note: emoNote.trim(), date: today })
      setEmoNote('')
      showToast('记下这一刻')
      loadEmotions()
    } catch {
      showToast('保存失败')
    } finally {
      setEmoBusy(false)
    }
  }

  const removeEmotion = async (e) => {
    try {
      await emotionDelete({ id: e.id, date: e.date })
      setTodayEmotions(prev => prev.filter(x => x.id !== e.id))
    } catch {
      showToast('删除失败')
    }
  }

  const saveMood = async () => {
    try {
      await moodSet({ level: moodLevel, note: moodNote.trim(), who: 'yomi', date: today })
      setMoodSaved(true)
      showToast('心情已记录')
    } catch {
      showToast('保存失败')
    }
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <button onClick={() => navigate(-1)} style={{ display: 'flex', color: 'var(--ink)' }}>
          <ChevronLeft size={22} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--serif-zh)', fontSize: 18, fontWeight: 500 }}>心情</div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{formatDate(now)}</div>
        </div>
        <button onClick={() => setCalOpen(true)} style={{ display: 'flex', color: 'var(--ink-soft)' }} aria-label="心情日历">
          <CalendarDays size={20} />
        </button>
      </div>

      {/* 情绪 / 心情 切换 */}
      <div className="mood-tabs">
        <button className={tab === 'emotion' ? 'is-active' : ''} onClick={() => setTab('emotion')}>
          情绪<span>当下感受</span>
        </button>
        <button className={tab === 'mood' ? 'is-active' : ''} onClick={() => setTab('mood')}>
          心情<span>今天整体</span>
        </button>
      </div>

      {tab === 'emotion' ? (
        <>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center', marginBottom: 8 }}>
            现在 {hhmm(now)}
          </div>
          <PleasantPicker level={emoLevel} setLevel={setEmoLevel} />
          <NoteCard note={emoNote} setNote={setEmoNote} placeholder="此刻在想什么？（可不写）" />
          <button className="detail-save" onClick={saveEmotion} disabled={emoBusy} style={{ marginBottom: 24 }}>
            {emoBusy ? '记下…' : '记下这一刻'}
          </button>

          {todayEmotions.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-soft)', marginBottom: 12 }}>今天的情绪</div>
              <div className="emo-timeline">
                {todayEmotions.map(e => {
                  const meta = pleasantMeta(e.level) || levelOfValence(e.valence)
                  return (
                    <div key={e.id} className="emo-item">
                      <span className="emo-item__time">{hhmm(toCST(e.ts))}</span>
                      <span style={{ color: meta?.color, display: 'flex' }}><PleasantFace level={meta?.level || 4} size={22} /></span>
                      <div className="emo-item__body">
                        <span className="emo-item__label">{meta?.label}</span>
                        {e.note && <span className="emo-item__note">{e.note}</span>}
                      </div>
                      <button className="emo-item__del" onClick={() => removeEmotion(e)} aria-label="删除">
                        <X size={13} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <PleasantPicker level={moodLevel} setLevel={(v) => { setMoodLevel(v); setMoodSaved(false) }} />
          <NoteCard note={moodNote} setNote={(v) => { setMoodNote(v); setMoodSaved(false) }} placeholder="今天整体感觉怎么样？（可不写）" />
          <button className="detail-save" onClick={saveMood} disabled={moodSaved} style={{ marginBottom: 24 }}>
            {moodSaved ? '已保存' : '保存今天心情'}
          </button>
        </>
      )}

      {calOpen && <MoodCalendar onClose={() => setCalOpen(false)} />}
    </div>
  )
}
