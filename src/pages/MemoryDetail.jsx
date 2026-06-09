import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Star, Lock, X, Plus, Pencil, Link2, Search } from 'lucide-react'
import { CATEGORIES, categoryOf } from '../utils/categories.js'
import { formatDateZh, weekdayZh, formatCardTime } from '../utils/time.js'
import {
  memoryAll,
  memoryUpdate,
  memoryCreate,
  memoryLink,
  memoryUnlink,
} from '../api.js'

const NEW_DRAFT = {
  content: '',
  category: 'semantic',
  importance: 5,
  arousal: 0.5,
  valence: 0,
  tags: [],
}

export default function MemoryDetail() {
  const { id } = useParams()
  const isNew = id === 'new'
  const navigate = useNavigate()

  const [allMems, setAllMems] = useState([])
  const [memo, setMemo] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [editing, setEditing] = useState(isNew)
  const [draft, setDraft] = useState(isNew ? { ...NEW_DRAFT } : null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [picker, setPicker] = useState({ open: false, query: '' })

  const refresh = async () => {
    const list = await memoryAll()
    setAllMems(list)
    if (!isNew) {
      const m = list.find((x) => x.id === id)
      if (!m) setNotFound(true)
      else setMemo(m)
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

  const startEdit = () => {
    setDraft({
      content: memo.content,
      category: memo.category,
      importance: memo.rawImportance,
      arousal: memo.arousal,
      valence: memo.valence,
      tags: [...memo.tags],
    })
    setEditing(true)
  }

  const cancelEdit = () => {
    if (isNew) navigate('/memory')
    else {
      setEditing(false)
      setDraft(null)
      setPicker({ open: false, query: '' })
    }
  }

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }))

  const addTag = () => {
    const v = tagInput.trim().replace(/^#/, '')
    if (v && !draft.tags.includes(v)) set('tags', [...draft.tags, v])
    setTagInput('')
  }

  const save = async () => {
    if (!draft.content.trim()) return alert('内容不能为空')
    setSaving(true)
    try {
      if (isNew) {
        await memoryCreate(draft)
        navigate('/memory')
      } else {
        await memoryUpdate(id, {
          content: draft.content,
          category: draft.category,
          importance: draft.importance,
          arousal: draft.arousal,
          valence: draft.valence,
          tags: draft.tags,
        })
        await refresh()
        setEditing(false)
        setDraft(null)
      }
    } catch (e) {
      alert(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const togglePin = async () => {
    if (busy) return
    setBusy(true)
    try {
      await memoryUpdate(id, { pinned: !memo.pinned })
      await refresh()
    } catch (e) {
      alert(e.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const doLink = async (targetId) => {
    setBusy(true)
    try {
      const r = await memoryLink(memo.id, targetId)
      if (r?.error) throw new Error(r.error)
      await refresh()
      setPicker({ open: false, query: '' })
    } catch (e) {
      alert(e.message || '连接失败')
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
      alert(e.message || '拆藤失败')
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
      <div className="page">
        <Header onBack={() => navigate('/memory')} />
        <p className="faint list-hint">这条记忆不存在</p>
      </div>
    )

  // 当前展示用的值（编辑时取 draft，阅读时取 memo）
  const view = editing
    ? draft
    : memo && {
        content: memo.content,
        category: memo.category,
        importance: memo.rawImportance,
        arousal: memo.arousal,
        valence: memo.valence,
        tags: memo.tags,
      }

  if (!view)
    return (
      <div className="page">
        <Header onBack={() => navigate('/memory')} />
        <p className="faint list-hint">加载中…</p>
      </div>
    )

  const cat = categoryOf(view.category)

  return (
    <div className="page detail">
      <Header
        onBack={() => (editing && !isNew ? cancelEdit() : navigate('/memory'))}
        title={isNew ? '新记忆' : '记忆'}
        pinned={memo?.pinned}
        onPin={!isNew ? togglePin : null}
        locked={memo?.locked}
        editing={editing}
        isNew={isNew}
        onEdit={!isNew && !editing ? startEdit : null}
        onCancel={editing && !isNew ? cancelEdit : null}
      />

      {/* 日期 */}
      <div className="detail-date">
        {isNew ? (
          <span className="faint">new entry</span>
        ) : (
          <>
            <span className="detail-date__big">{formatDateZh(memo?.date)}</span>
            <span className="faint">
              {weekdayZh(memo?.date)} · {formatCardTime(memo?.created_at)}
              {memo?.activations > 0 && ` · 召回 ${memo.activations} 次`}
            </span>
          </>
        )}
      </div>

      {/* 正文 */}
      {editing ? (
        <textarea
          className="detail-body"
          value={draft.content}
          placeholder="写下这条记忆…"
          onChange={(e) => set('content', e.target.value)}
          rows={6}
        />
      ) : (
        <div className="detail-read-body">{view.content}</div>
      )}

      {/* 分类 */}
      <div className="detail-row">
        <span className="detail-label">分类</span>
        {editing ? (
          <div className="cat-select">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                className={'cat-opt' + (draft.category === c.key ? ' is-active' : '')}
                style={{ '--tag-color': c.color }}
                onClick={() => set('category', c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="cat-text" style={{ '--tag-color': cat.color }}>
            {cat.label}
          </span>
        )}
      </div>

      {/* 三维度卡片 */}
      <div className="card meta-card">
        <Slider label="重要度" min={1} max={10} step={1} value={view.importance} display={view.importance} disabled={!editing} onChange={(v) => set('importance', v)} />
        <Slider label="唤醒度" min={0} max={1} step={0.05} value={view.arousal} display={view.arousal.toFixed(2)} disabled={!editing} onChange={(v) => set('arousal', v)} />
        <Slider label="效价" min={-1} max={1} step={0.05} value={view.valence} display={view.valence.toFixed(2)} disabled={!editing} onChange={(v) => set('valence', v)} />
      </div>

      {/* 标签 */}
      <div className="detail-row detail-row--col">
        <span className="detail-label">标签</span>
        <div className="tag-edit">
          {view.tags.length === 0 && !editing && <span className="faint" style={{ fontSize: 13 }}>无标签</span>}
          {view.tags.map((t) => (
            <span key={t} className="tag-pill">
              #{t}
              {editing && (
                <button onClick={() => set('tags', draft.tags.filter((x) => x !== t))} aria-label="删除标签">
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
          {editing && (
            <span className="tag-add">
              <input value={tagInput} placeholder="#添加标签" onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())} />
              <button onClick={addTag} aria-label="添加">
                <Plus size={14} />
              </button>
            </span>
          )}
        </div>
      </div>

      {/* 藤蔓关联（新建时无） */}
      {!isNew && (
        <div className="detail-row detail-row--col">
          <span className="detail-label">
            藤蔓关联{linkedItems.length > 0 && ` · ${linkedItems.length}`}
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

          {/* 连接新藤蔓 —— 始终可见（连/拆是即时写入，不进编辑模式）*/}
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

      {/* 编辑模式底部保存 */}
      {editing && (
        <button className="detail-save" disabled={(isNew ? !draft.content.trim() : false) || saving} onClick={save}>
          {saving ? '保存中…' : isNew ? '创建记忆' : '保存'}
        </button>
      )}
    </div>
  )
}

function Header({ onBack, title = '记忆', pinned, onPin, locked, editing, isNew, onEdit, onCancel }) {
  return (
    <header className="detail-header">
      <button className="detail-back" onClick={onBack} aria-label="返回">
        <ArrowLeft size={20} />
      </button>
      <span className="detail-title">{title}</span>
      <div className="detail-header__right">
        {locked && <Lock size={16} className="faint" />}
        {onPin && (
          <button className={'detail-pin' + (pinned ? ' is-on' : '')} onClick={onPin} aria-label={pinned ? '取消置顶' : '置顶'}>
            <Star size={18} fill={pinned ? 'currentColor' : 'none'} />
          </button>
        )}
        {onEdit && (
          <button className="detail-edit-btn" onClick={onEdit}>
            <Pencil size={15} /> 编辑
          </button>
        )}
        {onCancel && !isNew && (
          <button className="detail-cancel-btn" onClick={onCancel}>取消</button>
        )}
      </div>
    </header>
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
