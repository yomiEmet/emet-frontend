import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock, Trash2, MoreHorizontal, X } from 'lucide-react'
import { momentAll, momentCreate, momentUpdate, momentDelete } from '../api.js'
import { shortDateZh, timeOfDayZh } from '../utils/time.js'
import { showToast } from '../utils/toast.js'

const SAVE_TEXT = { idle: '', saving: '保存中…', saved: '已保存', error: '保存失败', new: '新建中' }

// 瞬记详情：永远 inline 可编辑（content + tags）。锁定时变只读。
// 500ms 防抖 auto-save。新建（id=new）首次保存后 navigate.replace 到真实 id。
export default function MomentDetail() {
  const { id } = useParams()
  const isNew = id === 'new'
  const navigate = useNavigate()
  const [moment, setMoment] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [work, setWork] = useState(
    isNew ? { content: '', tags: [], mood: 0 } : null,
  )
  const [tagInput, setTagInput] = useState('')
  const [saveState, setSaveState] = useState(isNew ? 'new' : 'idle')
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const workRef = useRef(isNew ? { content: '', tags: [], mood: 0 } : null)
  const timerRef = useRef(null)
  const idRef = useRef(isNew ? null : id)
  const savingRef = useRef(false)

  useEffect(() => {
    if (isNew) return
    let alive = true
    momentAll().then((list) => {
      if (!alive) return
      const m = list.find((x) => x.id === id)
      if (!m) {
        setNotFound(true)
      } else {
        setMoment(m)
        const w = {
          content: m.content || '',
          tags: Array.isArray(m.tags) ? [...m.tags] : [],
          mood: typeof m.mood === 'number' ? m.mood : 0,
        }
        setWork(w)
        workRef.current = w
      }
    })
    return () => {
      alive = false
    }
  }, [id, isNew])

  const set = (key, value) => {
    if (!workRef.current || moment?.locked) return
    const next = { ...workRef.current, [key]: value }
    workRef.current = next
    setWork(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    setSaveState('saving')
    timerRef.current = setTimeout(doSave, 500)
  }

  const doSave = async () => {
    timerRef.current = null
    if (savingRef.current) return
    savingRef.current = true
    const w = workRef.current
    if (!w) {
      savingRef.current = false
      return
    }
    try {
      if (!idRef.current) {
        if (!w.content.trim()) {
          savingRef.current = false
          setSaveState('new')
          return
        }
        const r = await momentCreate({
          content: w.content,
          tags: w.tags,
          mood: w.mood,
        })
        if (r?.id) {
          idRef.current = r.id
          // 重新拉一次拿全字段
          const list = await momentAll()
          const m = list.find((x) => x.id === r.id)
          if (m) setMoment(m)
          setSaveState('saved')
          navigate(`/moment/${r.id}`, { replace: true })
        } else {
          throw new Error(r?.error || '创建失败')
        }
      } else {
        await momentUpdate(idRef.current, {
          content: w.content,
          tags: w.tags,
          mood: w.mood,
        })
        setSaveState('saved')
      }
    } catch (e) {
      setSaveState('error')
      showToast(e?.message || '保存失败')
    } finally {
      savingRef.current = false
    }
  }

  const addTag = (raw) => {
    const v = (raw ?? tagInput).trim().replace(/^#/, '')
    if (v && !work.tags.includes(v)) set('tags', [...work.tags, v])
    setTagInput('')
  }
  const onTagKey = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && tagInput.trim()) {
      e.preventDefault()
      addTag()
    } else if (e.key === 'Backspace' && !tagInput && work?.tags?.length) {
      e.preventDefault()
      set('tags', work.tags.slice(0, -1))
    }
  }
  const removeTag = (t) => {
    set('tags', work.tags.filter((x) => x !== t))
  }

  const toggleLock = async () => {
    setMenuOpen(false)
    if (!moment || busy) return
    setBusy(true)
    try {
      await momentUpdate(moment.id, { locked: !moment.locked })
      const list = await momentAll()
      const m = list.find((x) => x.id === moment.id)
      if (m) setMoment(m)
      showToast(moment.locked ? '已解锁' : '已锁定')
    } catch (e) {
      showToast(e?.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    setMenuOpen(false)
    if (!moment) return
    if (moment.locked) {
      showToast('请先解锁')
      return
    }
    if (!window.confirm('确认删除这条瞬记？')) return
    try {
      await momentDelete(moment.id)
      showToast('已删除')
      navigate(-1)
    } catch (e) {
      showToast(e?.message || '删除失败')
    }
  }

  if (notFound) {
    return (
      <div className="page detail">
        <header className="detail-header">
          <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
            <ArrowLeft size={20} />
          </button>
          <span className="detail-title">瞬记</span>
        </header>
        <p className="faint list-hint">这条瞬记不存在</p>
      </div>
    )
  }
  if (!isNew && (!moment || !work)) {
    return (
      <div className="page detail">
        <header className="detail-header">
          <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
            <ArrowLeft size={20} />
          </button>
          <span className="detail-title">瞬记</span>
        </header>
        <p className="faint list-hint">加载中…</p>
      </div>
    )
  }

  const readonly = !!moment?.locked
  const w = work || { content: '', tags: [], mood: 0 }

  return (
    <div className="page detail">
      <header className="detail-header">
        <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <span className="detail-title">瞬记</span>
        <div className="detail-header__right">
          {saveState !== 'idle' && (
            <span className="faint" style={{ fontSize: 12, marginRight: 8 }}>
              {SAVE_TEXT[saveState]}
            </span>
          )}
          {moment?.locked && <Lock size={16} className="faint" />}
          {moment && (
            <button
              className="set-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="更多"
              style={{ marginLeft: 8 }}
            >
              <MoreHorizontal size={16} />
            </button>
          )}
        </div>
      </header>

      {menuOpen && (
        <>
          <div className="tl-scrim tl-scrim--clear" onClick={() => setMenuOpen(false)} />
          <div className="sort-menu card">
            <button className="dm-opt" onClick={toggleLock} disabled={busy}>
              <Lock size={14} /> {moment.locked ? '解锁' : '锁定'}
            </button>
            <button className="dm-opt" onClick={doDelete}>
              <Trash2 size={14} /> 删除
            </button>
          </div>
        </>
      )}

      {/* meta */}
      {moment && (
        <div className="faint diary-read__meta">
          {shortDateZh(moment.created_at)} · {timeOfDayZh(moment.created_at)}
        </div>
      )}

      {/* 正文 */}
      <textarea
        className="detail-read-body"
        placeholder="写下当下…"
        value={w.content}
        readOnly={readonly}
        onChange={(e) => set('content', e.target.value)}
        autoFocus={isNew}
        rows={Math.max(6, (w.content || '').split('\n').length + 1)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          padding: 0,
          fontFamily: 'inherit',
          fontSize: 'inherit',
          lineHeight: 'inherit',
          color: 'inherit',
          resize: 'vertical',
          whiteSpace: 'pre-wrap',
          marginTop: 8,
        }}
      />

      {/* 标签 */}
      <div
        className="diary-edit__tags"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginTop: 16,
          alignItems: 'center',
        }}
      >
        {w.tags.map((t) => (
          <span key={t} className="tag-pill">
            #{t}
            {!readonly && (
              <button
                onClick={() => removeTag(t)}
                aria-label="移除"
                style={{
                  marginLeft: 4,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <X size={10} />
              </button>
            )}
          </span>
        ))}
        {!readonly && (
          <input
            placeholder="加标签…"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={onTagKey}
            style={{
              flex: 1,
              minWidth: 100,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              padding: 0,
              fontSize: 13,
              color: 'inherit',
            }}
          />
        )}
      </div>
    </div>
  )
}
