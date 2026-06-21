import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock, Trash2, MoreHorizontal, X, ChevronLeft } from 'lucide-react'
import { momentAll, momentCreate, momentUpdate, momentDelete, memoryMove } from '../api.js'
import { shortDateZh, timeOfDayZh } from '../utils/time.js'
import { showToast } from '../utils/toast.js'

const SAVE_TEXT = { idle: '', saving: '保存中…', saved: '已保存', error: '保存失败', new: '新建中' }

// 移动到…（六类互转，去掉自己 moment）
const MOVE_TYPES = [
  ['memory', '记忆'],
  ['diary', '日记'],
  ['story', '故事'],
  ['message', '便条'],
  ['idea', '想法'],
]

// 瞬记详情：v66 风格——打开即编辑，textarea 永远在线，500ms 自动保存
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
  const [menu, setMenu] = useState('') // '' | 'main' | 'move'
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
    if (work) requestAnimationFrame(adjustHeight)
  }, [work?.content])

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

  // moment 加载完后初始化 work（v66 风格：永远在编辑态）
  useEffect(() => {
    if (moment && !work) {
      const w = {
        content: moment.content || '',
        tags: Array.isArray(moment.tags) ? [...moment.tags] : [],
        mood: typeof moment.mood === 'number' ? moment.mood : 0,
      }
      workRef.current = w
      setWork(w)
      setSaveState('idle')
    }
  }, [moment, work])

  const set = (key, value) => {
    if (!workRef.current) return
    if (moment?.locked) {
      setSaveState('error')
      showToast('请先解锁')
      return
    }
    const next = { ...workRef.current, [key]: value }
    workRef.current = next
    setWork(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    setSaveState('saving')
    timerRef.current = setTimeout(doSave, 500)
  }

  const flushSave = async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
      await doSave()
    }
  }

  const goBack = async () => {
    await flushSave()
    navigate(-1)
  }

  // 卸载时 flush
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        doSave()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    setMenu('')
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

  const doMove = async (to, label) => {
    setMenu('')
    if (!moment) return
    if (moment.locked) {
      showToast('请先解锁')
      return
    }
    try {
      await memoryMove(moment.id, 'moment', to)
      showToast('已移动到 ' + label)
      navigate(-1)
    } catch (e) {
      showToast(e?.message || '移动失败')
    }
  }

  const doDelete = async () => {
    setMenu('')
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

  const headerTitle = SAVE_TEXT[saveState] || '瞬记'
  const locked = !!moment?.locked

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
        <button className="detail-back" onClick={goBack} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <span className="detail-title">{headerTitle}</span>
        <div className="detail-header__right">
          {locked && <Lock size={16} className="faint" />}
          {moment && (
            <button
              className="detail-more"
              onClick={() => setMenu(menu ? '' : 'main')}
              aria-label="更多"
            >
              <MoreHorizontal size={20} />
            </button>
          )}
        </div>
      </header>

      {menu && (
        <>
          <div className="tl-scrim tl-scrim--clear" onClick={() => setMenu('')} />
          <div className="sort-menu card">
            {menu === 'main' ? (
              <>
                <button className="dm-opt" onClick={toggleLock} disabled={busy}>
                  <Lock size={14} /> {moment.locked ? '解锁' : '锁定'}
                </button>
                {!moment.locked && (
                  <button className="dm-opt" onClick={() => setMenu('move')}>
                    移动到… <span className="faint">›</span>
                  </button>
                )}
                <button className="dm-opt" onClick={doDelete}>
                  <Trash2 size={14} /> 删除
                </button>
              </>
            ) : (
              <>
                <button className="dm-opt dm-back" onClick={() => setMenu('main')}>
                  <ChevronLeft size={14} /> 移动到
                </button>
                {MOVE_TYPES.map(([k, label]) => (
                  <button key={k} className="dm-opt" onClick={() => doMove(k, label)}>
                    {label}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}

      {moment && (
        <div className="faint diary-read__meta">
          {shortDateZh(moment.created_at)} · {timeOfDayZh(moment.created_at)}
        </div>
      )}

      {/* 正文：v66 风格永远在线 */}
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
        readOnly={locked}
        style={{
          ...transparentInput,
          resize: 'none',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          display: 'block',
          marginTop: 8,
        }}
      />

      {/* tags：永远显示 + 可加可删 */}
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
            {!locked && (
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
        {!locked && (
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
        )}
      </div>
    </div>
  )
}
