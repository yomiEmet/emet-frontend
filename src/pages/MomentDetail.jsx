import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock, Trash2, Pencil, Check, X } from 'lucide-react'
import { momentAll, momentCreate, momentUpdate, momentDelete } from '../api.js'
import { shortDateZh, timeOfDayZh } from '../utils/time.js'
import { showToast } from '../utils/toast.js'

const SAVE_TEXT = { idle: '', saving: '编辑中…', saved: '已保存', error: '保存失败', new: '新建中' }

// 瞬记详情：编辑 content / tags / mood + 删除 + 新建（id="new"）。
// 自动保存 500ms 防抖；新建首次保存后 navigate.replace 到真实 id。
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
  const workRef = useRef(isNew ? { content: '', tags: [], mood: 0 } : null)
  const timerRef = useRef(null)
  const idRef = useRef(isNew ? null : id)
  const savingRef = useRef(false)

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

  const enterEdit = () => {
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

  const exitEdit = async () => {
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
    if (!work) return
    const next = { ...workRef.current, [key]: value }
    workRef.current = next
    setWork(next)
    scheduleSave()
  }

  const scheduleSave = () => {
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
        // 首次保存：新建
        if (!w.content.trim()) {
          // 空内容不创建
          savingRef.current = false
          setSaveState('idle')
          return
        }
        const r = await momentCreate({
          content: w.content,
          tags: w.tags,
          mood: w.mood,
        })
        if (r?.id) {
          idRef.current = r.id
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

  if (!moment && !isNew) {
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

  const w = work || {
    content: moment?.content || '',
    tags: moment?.tags || [],
    mood: moment?.mood || 0,
  }

  return (
    <div className="page detail">
      <header className="detail-header">
        <button
          className="detail-back"
          onClick={editing ? exitEdit : () => navigate(-1)}
          aria-label="返回"
        >
          <ArrowLeft size={20} />
        </button>
        <span className="detail-title">瞬记</span>
        <div className="detail-header__right">
          {editing && (
            <span className="faint" style={{ fontSize: 12, marginRight: 8 }}>
              {SAVE_TEXT[saveState]}
            </span>
          )}
          {moment?.locked && <Lock size={16} className="faint" />}
          {!editing && moment ? (
            <button
              className="set-btn"
              onClick={enterEdit}
              disabled={moment.locked}
              style={{ marginLeft: 8 }}
            >
              <Pencil size={12} /> 编辑
            </button>
          ) : editing ? (
            <button className="set-btn" onClick={exitEdit} style={{ marginLeft: 8 }}>
              <Check size={12} /> 完成
            </button>
          ) : null}
        </div>
      </header>

      {editing ? (
        <>
          <textarea
            className="diary-edit__content"
            placeholder="写下当下…"
            rows={6}
            value={w.content}
            onChange={(e) => set('content', e.target.value)}
            autoFocus
          />
          <div className="diary-edit__meta">
            {moment && (
              <button className="set-btn" onClick={toggleLock} disabled={busy}>
                <Lock size={12} /> {moment.locked ? '解锁' : '锁定'}
              </button>
            )}
            {moment && (
              <button className="set-btn set-btn--danger" onClick={doDelete}>
                <Trash2 size={12} /> 删除
              </button>
            )}
          </div>
          <div className="diary-edit__tags">
            {w.tags.map((t) => (
              <span key={t} className="tag-pill">
                #{t}
                <button onClick={() => removeTag(t)} aria-label="移除标签" style={{ marginLeft: 4 }}>
                  <X size={10} />
                </button>
              </span>
            ))}
            <input
              className="set-input"
              placeholder="加标签（回车确认）"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={onTagKey}
              style={{ flex: 1, minWidth: 120 }}
            />
          </div>
        </>
      ) : (
        <>
          <div className="faint diary-read__meta">
            {moment ? `${shortDateZh(moment.created_at)} · ${timeOfDayZh(moment.created_at)}` : ''}
          </div>
          <div className="detail-read-body">{moment.content}</div>
          {moment.tags && moment.tags.length > 0 && (
            <div className="diary-edit__tags" style={{ marginTop: 12 }}>
              {moment.tags.map((t) => (
                <span key={t} className="tag-pill">#{t}</span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
