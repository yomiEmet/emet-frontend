import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus, X } from 'lucide-react'
import { ideaAll, ideaCreate, ideaUpdate, ideaDelete } from '../api.js'
import LoadError from '../components/LoadError.jsx'
import { showToast } from '../utils/toast.js'

const NOTE_COLORS = [
  'rgba(198,97,63,.08)',
  'rgba(97,163,198,.08)',
  'rgba(163,198,97,.08)',
  'rgba(198,163,97,.08)',
  'rgba(140,97,198,.08)',
  'rgba(198,97,140,.08)',
]

function AutoTextarea({ value, className, ...rest }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [value])
  return <textarea ref={ref} className={'auto-ta ' + (className || '')} value={value} rows={1} {...rest} />
}

export default function IdeasPage() {
  const navigate = useNavigate()
  const [list, setList] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [content, setContent] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () =>
    ideaAll()
      .then((l) => {
        setList(l)
        setLoadErr(null)
      })
      .catch((e) => {
        setLoadErr(e)
        setList((prev) => prev || [])
      })

  useEffect(() => {
    let alive = true
    ideaAll()
      .then((l) => {
        if (!alive) return
        setList(l)
        setLoadErr(null)
      })
      .catch((e) => {
        if (!alive) return
        setList([])
        setLoadErr(e)
      })
    return () => { alive = false }
  }, [])

  const save = async () => {
    const c = content.trim()
    if (!c || busy) return
    setBusy(true)
    try {
      const tags = tagsInput.split(/[,，\s#]+/).map((t) => t.trim()).filter(Boolean)
      await ideaCreate({ content: c, tags })
      setContent('')
      setTagsInput('')
      setFormOpen(false)
      await load()
    } catch (e) {
      showToast(e?.message || '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    if (busy || !window.confirm('删除这条灵感？')) return
    setBusy(true)
    try {
      await ideaDelete(id)
      await load()
    } catch (e) {
      showToast(e?.message || '删除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button onClick={() => navigate(-1)} style={{ display: 'flex', color: 'var(--ink)' }}>
          <ChevronLeft size={22} />
        </button>
        <h1 style={{ fontFamily: 'var(--serif-zh)', fontSize: 18, fontWeight: 500, flex: 1 }}>灵感板</h1>
      </div>

      {formOpen && (
        <div className="card" style={{ padding: 16, marginBottom: 'var(--gap-section)' }}>
          <textarea
            autoFocus
            value={content}
            rows={3}
            placeholder="记下这个灵感…"
            onChange={(e) => setContent(e.target.value)}
            style={{
              width: '100%', border: 'none', outline: 'none', resize: 'none',
              background: 'transparent', fontFamily: 'inherit', fontSize: 14,
              lineHeight: 1.7, color: 'var(--ink)'
            }}
          />
          <input
            value={tagsInput}
            placeholder="#标签 用逗号或空格分隔"
            onChange={(e) => setTagsInput(e.target.value)}
            style={{
              width: '100%', border: 'none', outline: 'none',
              background: 'transparent', fontSize: 13, color: 'var(--ink-faint)',
              marginTop: 8
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="mini-btn" onClick={() => setFormOpen(false)}>取消</button>
            <button className="mini-btn mini-btn--accent" disabled={!content.trim() || busy} onClick={save}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}

      {list === null ? (
        <p className="faint list-hint">加载中…</p>
      ) : (
        <>
          {loadErr && <LoadError err={loadErr} onRetry={load} compact={list.length > 0} />}
          {list.length === 0 && !loadErr ? (
            <p className="faint list-hint">还没有灵感</p>
          ) : list.length > 0 ? (
            <div className="ideas-masonry">
              {list.map((idea, idx) => (
                <StickyNote
                  key={idea.id}
                  idea={idea}
                  color={NOTE_COLORS[idx % NOTE_COLORS.length]}
                  busy={busy}
                  onChanged={load}
                  onRemove={() => remove(idea.id)}
                />
              ))}
            </div>
          ) : null}
        </>
      )}

      <button className="fab" onClick={() => setFormOpen(true)} aria-label="记灵感">
        <Plus size={24} />
      </button>
    </div>
  )
}

function StickyNote({ idea, color, busy, onChanged, onRemove }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [tagsDraft, setTagsDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const c = draft.trim()
    if (!c || saving) return
    setSaving(true)
    try {
      const tags = tagsDraft.split(/[,，\s#]+/).map((t) => t.trim()).filter(Boolean)
      await ideaUpdate(idea.id, { content: c, tags })
      showToast('已保存')
      setEditing(false)
      onChanged()
    } catch (e) {
      showToast(e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sticky-note" style={{ background: color }}>
      {!idea.locked && !editing && (
        <button
          className="sticky-note__del"
          onClick={onRemove}
          disabled={busy}
          aria-label="删除"
        >
          <X size={13} />
        </button>
      )}

      {editing ? (
        <div>
          <AutoTextarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
          <input
            className="inline-edit__tags"
            value={tagsDraft}
            placeholder="#标签"
            onChange={(e) => setTagsDraft(e.target.value)}
            style={{ marginTop: 8, fontSize: 12 }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
            <button className="mini-btn" onClick={() => setEditing(false)}>取消</button>
            <button className="mini-btn mini-btn--accent" disabled={!draft.trim() || saving} onClick={save}>
              保存
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={idea.locked ? undefined : () => {
            setDraft(idea.content || '')
            setTagsDraft((idea.tags || []).join(', '))
            setEditing(true)
          }}
          style={{ cursor: idea.locked ? 'default' : 'pointer' }}
        >
          <p className="sticky-note__content">{idea.content}</p>
          {idea.tags?.length > 0 && (
            <div className="sticky-note__tags">
              {idea.tags.map((t) => (
                <span key={t} className="mem-hashtag">#{t}</span>
              ))}
            </div>
          )}
          <div className="sticky-note__date">{(idea.created_at || '').slice(0, 10)}</div>
        </div>
      )}
    </div>
  )
}
