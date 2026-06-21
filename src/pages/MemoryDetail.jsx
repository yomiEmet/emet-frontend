import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Star, Lock, X, Plus, Link2, Search,
  MoreHorizontal, Sparkles, ChevronLeft,
} from 'lucide-react'
import { CATEGORIES, categoryOf } from '../utils/categories.js'
import { formatDateZh, weekdayZh, formatCardTime, formatRelative } from '../utils/time.js'
import { showToast } from '../utils/toast.js'
import TagSpaceCard from '../components/TagSpaceCard.jsx'
import {
  memoryAll,
  memoryUpdate,
  memoryCreate,
  memoryDelete,
  memoryMove,
  memoryLink,
  memoryUnlink,
} from '../api.js'

const NEW_WORK = {
  content: '',
  category: 'semantic',
  importance: 5,
  arousal: 0.5,
  valence: 0,
  tags: [],
  date: '',
}

// 移动到…（旧版六类互转，去掉自己）
const MOVE_TYPES = [
  ['moment', '瞬记'],
  ['diary', '日记'],
  ['story', '故事'],
  ['message', '便条'],
  ['idea', '想法'],
]

// 保存状态字（旧版 editorSaved 的语义）
const SAVE_TEXT = { idle: '', new: '新建中', saving: '编辑中…', saved: '已保存', error: '保存失败' }

export default function MemoryDetail() {
  const { id } = useParams()
  const isNew = id === 'new'
  const navigate = useNavigate()
  const [sp] = useSearchParams()
  // /memory/new?tag=log 时预填一个 tag，方便从日志 tab 进来直接是日志
  const presetTag = isNew ? sp.get('tag') : null

  const [allMems, setAllMems] = useState([])
  const [memo, setMemo] = useState(null)
  const [notFound, setNotFound] = useState(false)
  // v66 风格：work 永远存在，没有 editing 双模式
  const [work, setWork] = useState(
    isNew ? { ...NEW_WORK, tags: presetTag ? [presetTag] : [] } : null,
  )
  const [saveState, setSaveState] = useState(isNew ? 'new' : 'idle')
  const [busy, setBusy] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [picker, setPicker] = useState({ open: false, query: '' })
  const [menu, setMenu] = useState('') // '' | 'main' | 'move'
  const [dateOpen, setDateOpen] = useState(false)
  const [tagSpaceOpen, setTagSpaceOpen] = useState(false)
  const bodyRef = useRef(null)

  // 自动保存管线：workRef 永远指向最新值，防抖 500ms 落库
  const workRef = useRef(null)
  const timerRef = useRef(null)
  const idRef = useRef(isNew ? null : id)
  const savingRef = useRef(false)

  const refresh = async () => {
    const list = await memoryAll()
    setAllMems(list)
    const realId = idRef.current
    if (realId) {
      const m = list.find((x) => x.id === realId)
      if (!m && !isNew) setNotFound(true)
      else if (m) setMemo(m)
      return m
    }
    return null
  }

  useEffect(() => {
    let alive = true
    memoryAll().then((list) => {
      if (!alive) return
      setAllMems(list)
      if (!isNew) {
        const m = list.find((x) => x.id === id)
        if (!m) setNotFound(true)
        else setMemo(m)
      }
    })
    return () => {
      alive = false
    }
  }, [id, isNew])

  // memo 加载到了 → 初始化 work（一次性，避免后续 memo 变化打断打字）
  useEffect(() => {
    if (memo && !work) {
      const w = {
        content: memo.content,
        category: memo.category,
        importance: memo.rawImportance,
        arousal: memo.arousal,
        valence: memo.valence,
        tags: [...memo.tags],
        date: '',
      }
      workRef.current = w
      setWork(w)
      setSaveState('idle')
    }
  }, [memo, work])

  const doSave = async () => {
    const w = workRef.current
    if (!w || savingRef.current) return
    savingRef.current = true
    try {
      if (!idRef.current) {
        // 新建：第一次有内容时 POST 拿真实 id（旧版 B2 的流程）
        if (!w.content.trim()) {
          setSaveState('new')
          return
        }
        const res = await memoryCreate({
          content: w.content,
          category: w.category,
          importance: w.importance,
          arousal: w.arousal,
          valence: w.valence,
          tags: w.tags,
        })
        if (res?.id) idRef.current = res.id
        setSaveState('saved')
      } else {
        const patch = {
          content: w.content,
          category: w.category,
          importance: w.importance,
          arousal: w.arousal,
          valence: w.valence,
          tags: w.tags,
        }
        if (w.date) patch.date = w.date
        await memoryUpdate(idRef.current, patch)
        setSaveState('saved')
      }
    } catch (e) {
      setSaveState('error')
    } finally {
      savingRef.current = false
    }
  }

  const queueSave = (next) => {
    workRef.current = next
    setSaveState('saving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(doSave, 500)
  }

  // 离开编辑/卸载时把没落库的改动冲掉
  const flushSave = async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
      await doSave()
    }
  }
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        doSave()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = (k, v) => {
    if (memo?.locked) {
      setSaveState('error')
      showToast('请先解锁')
      return
    }
    setWork((w) => {
      const next = { ...w, [k]: v }
      queueSave(next)
      return next
    })
  }

  // v66 风格：返回 = 一次点击直接退，flushSave 兜底
  const goBack = async () => {
    await flushSave()
    navigate(-1)
  }

  // ── 标签（编辑模式内联输入）─────────────────────────
  const addTag = (raw) => {
    const v = (raw ?? tagInput).trim().replace(/^#/, '')
    if (v && !work.tags.includes(v)) set('tags', [...work.tags, v])
    setTagInput('')
  }
  const onTagKey = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && tagInput.trim()) {
      e.preventDefault()
      addTag()
    } else if (e.key === 'Backspace' && !tagInput && work.tags.length) {
      // 旧版 B6：空输入框退格删最后一个标签
      e.preventDefault()
      set('tags', work.tags.slice(0, -1))
    }
  }

  // 标签空间 card 模式：直接走 set（永远是编辑态）
  const applyTags = (tags) => set('tags', tags)

  // ── 置顶 / 锁定 / 移动 / 删除 ───────────────────────
  const togglePin = async () => {
    if (busy) return
    setBusy(true)
    try {
      await memoryUpdate(memo.id, { pinned: !memo.pinned })
      await refresh()
      showToast(memo.pinned ? '已取消置顶' : '已置顶')
    } catch (e) {
      showToast(e.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const toggleLock = async () => {
    setMenu('')
    try {
      await memoryUpdate(memo.id, { locked: !memo.locked })
      await refresh()
      showToast(memo.locked ? '已解锁' : '已锁定')
    } catch (e) {
      showToast(e.message || '操作失败')
    }
  }

  const doMove = async (to, label) => {
    setMenu('')
    try {
      await memoryMove(memo.id, 'memory', to)
      showToast('已移动到 ' + label)
      navigate(-1)
    } catch (e) {
      showToast(e.message || '移动失败')
    }
  }

  const doDelete = async () => {
    setMenu('')
    if (memo.locked) {
      showToast('请先解锁')
      return
    }
    if (!window.confirm('确认删除这条记忆？')) return
    try {
      await memoryDelete(memo.id)
      showToast('已删除')
      navigate(-1)
    } catch (e) {
      showToast(e.message || '删除失败')
    }
  }

  // ── 藤蔓 ───────────────────────────────────────────
  const doLink = async (targetId) => {
    setBusy(true)
    try {
      const r = await memoryLink(memo.id, targetId)
      if (r?.error) throw new Error(r.error)
      await refresh()
      setPicker({ open: false, query: '' })
      showToast('已关联')
    } catch (e) {
      showToast(e.message || '连接失败')
    } finally {
      setBusy(false)
    }
  }

  const doUnlink = async (targetId) => {
    setBusy(true)
    try {
      const r = await memoryUnlink(memo.id, targetId)
      if (r?.error) throw new Error(r.error)
      await refresh()
    } catch (e) {
      showToast(e.message || '拆藤失败')
    } finally {
      setBusy(false)
    }
  }

  const linkedItems = useMemo(
    () => (memo?.linked || []).map((lid) => allMems.find((m) => m.id === lid)).filter(Boolean),
    [memo, allMems],
  )

  const candidates = useMemo(() => {
    if (!memo) return []
    const q = picker.query.trim().toLowerCase()
    return allMems
      .filter((m) => m.id !== memo.id && !memo.linked.includes(m.id))
      .filter((m) => !q || m.content.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q)))
      .slice(0, 30)
  }, [allMems, memo, picker.query])

  if (notFound)
    return (
      <div className="page detail">
        <header className="detail-header">
          <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
            <ArrowLeft size={20} />
          </button>
        </header>
        <p className="faint list-hint">这条记忆不存在</p>
      </div>
    )

  // v66 风格：view 永远 = work
  const view = work

  if (!view)
    return (
      <div className="page detail">
        <header className="detail-header">
          <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
            <ArrowLeft size={20} />
          </button>
        </header>
        <p className="faint list-hint">加载中…</p>
      </div>
    )

  const cat = categoryOf(view.category)
  const locked = !!memo?.locked
  // 永远显示保存状态；idle 时显示类型名
  const headerTitle = SAVE_TEXT[saveState] || (isNew ? '新记忆' : '记忆')
  const displayDate = work.date || memo?.date

  return (
    <div className="page detail">
      <header className="detail-header">
        <button className="detail-back" onClick={goBack} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <span className={'detail-title' + (saveState && saveState !== 'idle' ? ' detail-title--save' : '')}>{headerTitle}</span>
        <div className="detail-header__right">
          {locked && <Lock size={16} className="faint" />}
          {memo && (
            <button
              className={'detail-pin' + (memo.pinned ? ' is-on' : '')}
              onClick={togglePin}
              aria-label={memo.pinned ? '取消置顶' : '置顶'}
            >
              <Star size={18} fill={memo.pinned ? 'currentColor' : 'none'} />
            </button>
          )}
          {memo && (
            <button className="detail-more" onClick={() => setMenu(menu ? '' : 'main')} aria-label="更多">
              <MoreHorizontal size={20} />
            </button>
          )}
        </div>

        {/* ⋯ 菜单（锁定/移动/删除）*/}
        {menu && (
          <div className="detail-menu card">
            {menu === 'main' ? (
              <>
                <button className="dm-opt" onClick={toggleLock}>
                  {locked ? '解锁' : '锁定'}
                </button>
                {!locked && (
                  <button className="dm-opt" onClick={() => setMenu('move')}>
                    移动到… <span className="faint">›</span>
                  </button>
                )}
                <div className="dm-divider" />
                <button className={'dm-opt' + (locked ? ' is-disabled' : ' dm-opt--danger')} onClick={doDelete}>
                  {locked ? '删除（请先解锁）' : '删除'}
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
        )}
      </header>
      {menu && <div className="detail-menu-scrim" onClick={() => setMenu('')} />}

      {/* 日期（编辑模式可点改，旧版 B3）*/}
      <div className="detail-date">
        {isNew && !memo ? (
          <span className="faint">new entry</span>
        ) : (
          <>
            <span
              className={'detail-date__big' + (locked ? '' : ' is-editable')}
              onClick={() => !locked && setDateOpen((v) => !v)}
            >
              {formatDateZh(displayDate)}
            </span>
            <span className="faint">
              {weekdayZh(displayDate)} · {formatCardTime(memo?.created_at)}
              {memo?.created_at && ` · ${formatRelative(memo.created_at)}`}
              {memo?.activations > 0 && ` · 召回 ${memo.activations} 次`}
            </span>
          </>
        )}
      </div>
      {!locked && dateOpen && (
        <input
          type="date"
          className="detail-date-input"
          value={work.date || memo?.date || ''}
          onChange={(e) => {
            set('date', e.target.value)
            setDateOpen(false)
          }}
        />
      )}

      {/* 正文：v66 seamless 永远可写 */}
      <textarea
        ref={bodyRef}
        className="detail-body detail-body--seamless"
        value={work.content}
        placeholder="写下这条记忆…"
        onChange={(e) => set('content', e.target.value)}
        rows={6}
        autoFocus={isNew}
        readOnly={locked}
      />

      {/* 分类 */}
      <div className="detail-row">
        <span className="detail-label">分类</span>
        <div className="cat-select">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              className={'cat-opt' + (view.category === c.key ? ' is-active' : '')}
              style={{ '--tag-color': c.color }}
              onClick={() => set('category', c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* 三维度卡片 */}
      <div className="card meta-card">
        <Slider label="重要度" min={1} max={10} step={1} value={view.importance} display={view.importance} disabled={locked} onChange={(v) => set('importance', v)} />
        <Slider label="唤醒度" min={0} max={1} step={0.05} value={view.arousal} display={view.arousal.toFixed(2)} disabled={locked} onChange={(v) => set('arousal', v)} />
        <Slider label="效价" min={-1} max={1} step={0.05} value={view.valence} display={view.valence.toFixed(2)} disabled={locked} onChange={(v) => set('valence', v)} />
      </div>

      {/* 标签 */}
      <div className="detail-row detail-row--col">
        <span className="detail-label detail-label--btn" onClick={() => memo && setTagSpaceOpen(true)}>
          标签{memo && <em className="label-hint">管理 ›</em>}
        </span>
        <div className="tag-edit">
          {view.tags.map((t) => (
            <span key={t} className="tag-pill tag-pill--link" onClick={() => navigate(`/tags/${encodeURIComponent(t)}`)}>
              #{t}
              {!locked && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    set('tags', work.tags.filter((x) => x !== t))
                  }}
                  aria-label="删除标签"
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
          {!locked && (
            <span className="tag-add">
              <input
                value={tagInput}
                placeholder="#添加标签"
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={onTagKey}
              />
              <button onClick={() => addTag()} aria-label="添加">
                <Plus size={14} />
              </button>
            </span>
          )}
        </div>
      </div>

      {/* 藤蔓关联（新建未落库时无）*/}
      {memo && (
        <div className="detail-row detail-row--col">
          <span className="detail-label detail-label--btn" onClick={() => navigate(`/memory?tab=galaxy&focus=${memo.id}`)}>
            藤蔓关联{linkedItems.length > 0 && ` · ${linkedItems.length}`}
            <em className="label-hint"><Sparkles size={12} /> 星图</em>
          </span>
          {linkedItems.length === 0 ? (
            <span className="faint" style={{ fontSize: 13 }}>暂无关联</span>
          ) : (
            <div className="links-list">
              {linkedItems.map((m) => {
                const lc = categoryOf(m.category)
                const rel = memo?.linkRel?.[m.id]
                return (
                  <div key={m.id} className="link-item">
                    <span className="link-cat" style={{ '--tag-color': lc.color }}>{lc.label}</span>
                    <span className="link-text" onClick={() => navigate(`/memory/${m.id}`)}>{m.content.slice(0, 60)}</span>
                    <button className="link-remove faint" onClick={() => doUnlink(m.id)} disabled={busy} aria-label="拆藤">
                      <X size={13} />
                    </button>
                    {rel && <span className="link-rel faint">{rel}</span>}
                  </div>
                )
              })}
            </div>
          )}

          {!picker.open ? (
            <button className="vine-add-btn" onClick={() => setPicker({ open: true, query: '' })}>
              <Link2 size={15} /> 连接新藤蔓
            </button>
          ) : (
            <div className="vine-picker card">
              <div className="search-box">
                <Search size={15} className="search-box__icon" />
                <input className="search-box__input" placeholder="搜索要连接的记忆…" autoFocus value={picker.query} onChange={(e) => setPicker((p) => ({ ...p, query: e.target.value }))} />
                <button className="faint" onClick={() => setPicker({ open: false, query: '' })} aria-label="关闭"><X size={15} /></button>
              </div>
              <div className="vine-cand-list">
                {candidates.length === 0 ? (
                  <p className="faint" style={{ fontSize: 13, padding: '8px 4px' }}>没有可连接的记忆</p>
                ) : (
                  candidates.map((m) => {
                    const lc = categoryOf(m.category)
                    return (
                      <button key={m.id} className="vine-cand" disabled={busy} onClick={() => doLink(m.id)}>
                        <span className="link-cat" style={{ '--tag-color': lc.color }}>{lc.label}</span>
                        <span className="vine-cand__text">{m.content.slice(0, 50)}</span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 标签空间 card 模式 */}
      {tagSpaceOpen && memo && (
        <TagSpaceCard
          tags={view.tags}
          onChange={applyTags}
          onClose={() => setTagSpaceOpen(false)}
          onOpenTag={(t) => navigate(`/tags/${encodeURIComponent(t)}`)}
          onOpenAll={() => navigate('/tags')}
        />
      )}
    </div>
  )
}

function Slider({ label, min, max, step, value, display, disabled, onChange }) {
  return (
    <div className="meta-row">
      <span className="detail-label">{label}</span>
      <input
        type="range"
        className={'slider' + (disabled ? ' is-readonly' : '')}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="slider-val">{display}</span>
    </div>
  )
}
