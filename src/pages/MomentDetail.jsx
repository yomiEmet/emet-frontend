import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock, Trash2, MoreHorizontal, Pencil, Check, X } from 'lucide-react'
import { momentAll, momentCreate, momentUpdate, momentDelete } from '../api.js'
import { shortDateZh, timeOfDayZh } from '../utils/time.js'
import { showToast } from '../utils/toast.js'

const SAVE_TEXT = { idle: '', saving: '保存中…', saved: '已保存', error: '保存失败', new: '新建中' }

// 瞬记详情：仿 MemoryDetail 双模式。
// 读态：meta + 正文 + tags 纯文字。编辑态（点 ✎ 切换）：透明 input/textarea，自适应高度。
// 新建（id=new）默认就在编辑态。
export default function MomentDetail() {
  const { id } = useParams()
  const isNew = id === 'new'
  const navigate = useNavigate()
  const [moment, setMoment] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [editing, setEditing] = useState(isNew)
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
  const textareaRef = useRef(null)

  const adjustHeight = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }
  useEffect(() => {
    if (editing) requestAnimationFrame(adjustHeight)
  }, [editing, work?.content])

  const refresh = async () => {
    const list = await momentAll()
    const realId = idRef.current
    if (!realId) return null
    const m = list.find((x) => x.id === realId)
    if (!m && !isNew) setNotFound(true)
    else if (m) setMoment(m)
    return m
  }

  useEffect(() => {
    if (isNew) return
    let alive = true
    momentAll().then((list) => {
      if (!alive) return
      const m = list.find((x) => x.id === id)
      if (!m) setNotFound(true)
      else setMoment(m)
    })
    return () => {
      alive = false
    }
  }, [id, isNew])

  const startEdit = () => {
    if (!moment || moment.locked) {
      if (moment?.locked) showToast('请先解锁')
      return
    }
    const w = {
      content: moment.content || '',
      tags: Array.isArray(moment.tags) ? [...moment.tags] : [],
      mood: typeof moment.mood === 'number' ? moment.mood : 0,
    }
    setWork(w)
    workRef.current = w
    setEditing(true)
    setSaveState('idle')
  }

  const finishEdit = async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
      await doSave()
    }
    setEditing(false)
    setWork(null)
    workRef.current = null
    setSaveState('idle')
    if (isNew && !idRef.current) {
      navigate(-1)
      return
    }
    await refresh()
    if (isNew && idRef.current) navigate(`/moment/${idRef.current}`, { replace: true })
  }

  const set = (key, value) => {
    if (!workRef.current) return
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
          const list = await momentAll()
          const m = list.find((x) => x.id === r.id)
          if (m) setMoment(m)
          setSaveState('saved')
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
      await refresh()
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
  if (!isNew && !moment) {
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

  const headerTitle = editing ? SAVE_TEXT[saveState] || '瞬记' : '瞬记'

  const transparentInput = {
    width: '100%',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    padding: 0,
    margin: 0,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'inherit',
    color: 'inherit',
    lineHeight: 'inherit',
  }

  return (
    <div className="page detail">
      <header className="detail-header">
        <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <span className="detail-title">{headerTitle}</span>
        <div className="detail-header__right">
          {moment?.locked && <Lock size={16} className="faint" />}
          {!editing && moment && !moment.locked && (
            <button className="detail-edit-btn" onClick={startEdit} aria-label="编辑">
              <Pencil size={15} /> 编辑
            </button>
          )}
          {editing && (
            <button className="detail-edit-btn" onClick={finishEdit} aria-label="完成">
              <Check size={15} /> 完成
            </button>
          )}
          {moment && (
            <button
              className="detail-more"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="更多"
            >
              <MoreHorizontal size={20} />
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

      {moment && (
        <div className="faint diary-read__meta">
          {shortDateZh(moment.created_at)} · {timeOfDayZh(moment.created_at)}
        </div>
      )}

      {/* 正文 */}
      {editing ? (
        <textarea
          ref={textareaRef}
          className="detail-read-body"
          placeholder="写下当下…"
          value={work.content}
          onChange={(e) => {
            set('content', e.target.value)
            requestAnimationFrame(adjustHeight)
          }}
          autoFocus={isNew}
          style={{
            ...transparentInput,
            resize: 'none',
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            display: 'block',
            marginTop: 8,
          }}
        />
      ) : (
        <div className="detail-read-body">{moment.content}</div>
      )}

      {/* tags */}
      {editing ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 16,
            alignItems: 'center',
          }}
        >
          {work.tags.map((t) => (
            <span key={t} className="tag-pill">
              #{t}
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
            </span>
          ))}
          <input
            placeholder="加标签…"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={onTagKey}
            style={{
              flex: 1,
              minWidth: 100,
              ...transparentInput,
              fontSize: 13,
            }}
          />
        </div>
      ) : (
        moment?.tags?.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              marginTop: 16,
            }}
          >
            {moment.tags.map((t) => (
              <span key={t} className="tag-pill">#{t}</span>
            ))}
          </div>
        )
      )}
    </div>
  )
}
