import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Send, Plus, X, Lock, MoreHorizontal, Pencil } from 'lucide-react'
import {
  messageAll,
  messageLeave,
  messageUpdate,
  messageDelete,
  ideaAll,
  ideaCreate,
  ideaUpdate,
  ideaDelete,
  letterAll,
  letterCreate,
  letterUpdate,
  memoryMove,
  memoryUpdate,
} from '../api.js'
import { shortDateZh, timeOfDayZh, formatDateZh } from '../utils/time.js'
import { showToast } from '../utils/toast.js'
import { MOVE_GROUPS, visibleChildren, groupHasOptions } from '../utils/moveGroups.js'

function MoveButton({ id, fromType, onMoved }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState('groups') // 'groups' | 'rings' | 'letters'
  const close = () => {
    setOpen(false)
    setView('groups')
  }
  const doMove = async (to, label) => {
    close()
    try {
      if (to === 'log') {
        const r = await memoryMove(id, fromType, 'memory')
        const newId = r?.new_id || r?.id
        if (newId) {
          await memoryUpdate(newId, { tags: ['log'] })
        }
        showToast('已加进日志')
        onMoved?.()
        return
      }
      await memoryMove(id, fromType, to)
      showToast('已移动到 ' + label)
      onMoved?.()
    } catch (e) {
      showToast(e?.message || '移动失败')
    }
  }
  return (
    <>
      <button
        className="idea-card__del"
        style={{ right: 32 }}
        onClick={() => setOpen((v) => !v)}
        aria-label="移动"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <>
          <div className="tl-scrim tl-scrim--clear" onClick={close} />
          <div className="sort-menu card" style={{ right: 8, top: 36 }}>
            {view === 'groups' ? (
              <>
                <div className="dm-opt faint" style={{ pointerEvents: 'none' }}>移动到</div>
                {MOVE_GROUPS.filter((g) => groupHasOptions(g, fromType)).map((g) =>
                  g.leaf ? (
                    <button key={g.key} className="dm-opt" onClick={() => doMove(g.leaf, g.label)}>
                      {g.label}
                    </button>
                  ) : (
                    <button key={g.key} className="dm-opt" onClick={() => setView(g.key)}>
                      {g.label} <span className="faint">›</span>
                    </button>
                  ),
                )}
              </>
            ) : (
              <>
                <button className="dm-opt dm-back" onClick={() => setView('groups')}>
                  ‹ {view === 'rings' ? '年轮' : '留言'}
                </button>
                {visibleChildren(
                  MOVE_GROUPS.find((g) => g.key === view),
                  fromType,
                ).map((c) => (
                  <button key={c.key} className="dm-opt" onClick={() => doMove(c.key, c.label)}>
                    {c.label}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}

// 留言页（设计 4.4）：信件 + 留言板 + 灵感板
// 信件迁回（旧版 v6.8.2 顶部 tab）：交接信 / 日常信，共用 handoffs 表，kind 区分
export default function Messages() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = ['letter', 'board', 'idea'].includes(searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'letter'
  const setTab = (next) => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.set('tab', next)
        return p
      },
      { replace: true },
    )
  }

  return (
    <div className="page">
      <div className="subtabs">
        <button
          className={'subtab' + (tab === 'letter' ? ' is-active' : '')}
          onClick={() => setTab('letter')}
        >
          信件
        </button>
        <button
          className={'subtab' + (tab === 'board' ? ' is-active' : '')}
          onClick={() => setTab('board')}
        >
          留言板
        </button>
        <button
          className={'subtab' + (tab === 'idea' ? ' is-active' : '')}
          onClick={() => setTab('idea')}
        >
          灵感板
        </button>
      </div>

      {tab === 'letter' && <LetterBoard />}
      {tab === 'board' && <MessageBoard />}
      {tab === 'idea' && <IdeaBoard />}
    </div>
  )
}

const SENDER_LABEL = { emet: 'Emet', yomi: '静怡' }

// ════════════════ 信件 ════════════════
// 旧版 v6.8.2 美学：衬线标题 + 赤陶分隔线 + 信封气质卡片
const LETTER_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'handoff', label: '交接信' },
  { key: 'daily', label: '日常信' },
]

function LetterBoard() {
  const [list, setList] = useState(null)
  const [kind, setKind] = useState('all')
  const [openId, setOpenId] = useState(null)
  const [composeOpen, setComposeOpen] = useState(false)

  const load = () =>
    letterAll()
      .then(setList)
      // 刷新失败保留旧列表（首载失败才落空态），别把已显示的内容清掉
      .catch(() => setList((prev) => prev || []))

  useEffect(() => {
    let alive = true
    letterAll()
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]))
    return () => {
      alive = false
    }
  }, [])

  const counts = useMemo(() => {
    if (!list) return { all: 0, handoff: 0, daily: 0 }
    const c = { all: list.length, handoff: 0, daily: 0 }
    for (const l of list) c[l.kind] = (c[l.kind] || 0) + 1
    return c
  }, [list])

  const filtered = useMemo(() => {
    if (!list) return []
    return kind === 'all' ? list : list.filter((l) => l.kind === kind)
  }, [list, kind])

  if (list === null) return <p className="faint list-hint">加载中…</p>

  return (
    <div className="letter-wrap">
      {/* 信件筛选条（衬线 chip）*/}
      <div className="letter-filter">
        {LETTER_FILTERS.map((f) => (
          <button
            key={f.key}
            className={'letter-chip' + (kind === f.key ? ' is-active' : '')}
            onClick={() => setKind(f.key)}
          >
            <span className="letter-chip__label">{f.label}</span>
            <em className="letter-chip__count">{counts[f.key] || 0}</em>
          </button>
        ))}
      </div>

      {composeOpen && (
        <LetterCompose
          onDone={(saved) => {
            setComposeOpen(false)
            if (saved) load()
          }}
        />
      )}

      {filtered.length === 0 ? (
        <div className="letter-empty">
          <div className="letter-empty__line" />
          <p className="letter-empty__text">还没有信</p>
          <div className="letter-empty__line" />
        </div>
      ) : (
        <div className="letter-list">
          {filtered.map((l) => (
            <LetterCard
              key={l.id}
              letter={l}
              open={openId === l.id}
              onToggle={() => setOpenId(openId === l.id ? null : l.id)}
              onChanged={load}
            />
          ))}
        </div>
      )}

      {/* 新建信件（旧版信件 tab 的 FAB，迁移补齐）*/}
      <button className="fab" onClick={() => setComposeOpen(true)} aria-label="写信">
        <Plus size={24} />
      </button>
    </div>
  )
}

// 新建信件表单：kind 默认日常信（与旧版 FAB 一致），标题可空
function LetterCompose({ onDone }) {
  const [kind, setKind] = useState('daily')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const c = content.trim()
    if (!c || busy) return
    setBusy(true)
    try {
      await letterCreate({ title: title.trim(), content: c, kind })
      showToast('信已存好')
      onDone(true)
    } catch (e) {
      showToast(e?.message || '保存失败')
      setBusy(false)
    }
  }

  return (
    <div className="card idea-form letter-compose">
      <div className="letter-compose__kinds">
        {[
          ['daily', '日常信'],
          ['handoff', '交接信'],
        ].map(([k, label]) => (
          <button
            key={k}
            className={'letter-chip' + (kind === k ? ' is-active' : '')}
            onClick={() => setKind(k)}
          >
            <span className="letter-chip__label">{label}</span>
          </button>
        ))}
      </div>
      <input
        className="letter-compose__title"
        value={title}
        placeholder="标题（可空）"
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        autoFocus
        value={content}
        rows={6}
        placeholder="写一封信…"
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="idea-form__foot">
        <button className="mini-btn" onClick={() => onDone(false)}>
          取消
        </button>
        <button
          className="mini-btn mini-btn--accent"
          disabled={!content.trim() || busy}
          onClick={save}
        >
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}

function LetterCard({ letter, open, onToggle, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [tTitle, setTTitle] = useState('')
  const [tContent, setTContent] = useState('')
  const [busy, setBusy] = useState(false)

  const kindLabel = letter.kind === 'handoff' ? '交接信' : '日常信'
  const dateStr = formatDateZh(letter.created_at)
  const preview = (letter.content || '').slice(0, 200)

  const startEdit = (e) => {
    e.stopPropagation()
    setTTitle(letter.title || '')
    setTContent(letter.content || '')
    setEditing(true)
  }
  const save = async (e) => {
    e.stopPropagation()
    if (!tContent.trim() || busy) return
    setBusy(true)
    try {
      // 全部信件可编辑（含 Emet 写的交接信——功能性文件需要纠错通道，拍板决定）
      await letterUpdate(letter.id, { title: tTitle.trim(), content: tContent })
      showToast('已保存')
      setEditing(false)
      onChanged?.()
    } catch (err) {
      showToast(err?.message || '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article
      className={
        'letter-card letter-card--' + letter.kind + (open ? ' is-open' : '')
      }
      onClick={editing ? undefined : onToggle}
    >
      {/* 角标：锁 / 编辑（锁定的信不给编辑入口，423 也会被后端拦） */}
      {letter.locked ? (
        <span className="letter-card__lock" aria-label="已锁定">
          <Lock size={12} />
        </span>
      ) : (
        !editing && (
          <button className="letter-card__edit" onClick={startEdit} aria-label="编辑">
            <Pencil size={13} />
          </button>
        )
      )}

      {/* 信封顶饰线 */}
      <div className="letter-card__crest">
        <span className="letter-card__crest-line" />
        <span className="letter-card__crest-kind">{kindLabel}</span>
        <span className="letter-card__crest-line" />
      </div>

      {/* 日期 */}
      <div className="letter-card__date">{dateStr}</div>

      {editing ? (
        <div className="letter-card__editor" onClick={(e) => e.stopPropagation()}>
          <input
            className="letter-compose__title"
            value={tTitle}
            placeholder="标题（可空）"
            onChange={(e) => setTTitle(e.target.value)}
          />
          <textarea
            className="letter-card__editarea"
            autoFocus
            value={tContent}
            rows={10}
            onChange={(e) => setTContent(e.target.value)}
          />
          <div className="idea-form__foot">
            <button
              className="mini-btn"
              onClick={(e) => {
                e.stopPropagation()
                setEditing(false)
              }}
            >
              取消
            </button>
            <button
              className="mini-btn mini-btn--accent"
              disabled={!tContent.trim() || busy}
              onClick={save}
            >
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 标题（衬线大字）*/}
          {letter.title && (
            <h3 className="letter-card__title">{letter.title}</h3>
          )}

          {/* 正文（折叠/展开）*/}
          <div className="letter-card__body">
            {open ? (
              <p className="letter-card__full">{letter.content}</p>
            ) : (
              <p className="letter-card__preview">
                {preview}
                {letter.content.length > 200 && '…'}
              </p>
            )}
          </div>

          {/* 底部签名 */}
          <div className="letter-card__foot">
            <span className="letter-card__sig">— Emet</span>
            <span className="letter-card__expand">
              {open ? '收起' : '展开全文'}
            </span>
          </div>
        </>
      )}
    </article>
  )
}

// ════════════════ 留言板 ════════════════
function MessageBoard() {
  const [list, setList] = useState(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const taRef = useRef(null)

  const load = () =>
    messageAll()
      .then(setList)
      .catch(() => setList((prev) => prev || []))

  useEffect(() => {
    let alive = true
    messageAll()
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]))
    return () => {
      alive = false
    }
  }, [])

  const send = async () => {
    const content = text.trim()
    if (!content || sending) return
    setSending(true)
    try {
      await messageLeave(content)
      setText('')
      await load()
    } catch (e) {
      alert(e.message || '发送失败')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className="composer">
        <textarea
          ref={taRef}
          value={text}
          rows={2}
          placeholder="写点什么…"
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="composer-send"
          disabled={!text.trim() || sending}
          onClick={send}
          aria-label="发送"
        >
          <Send size={17} />
        </button>
      </div>

      <div className="stack">
        {list === null ? (
          <p className="faint list-hint">加载中…</p>
        ) : list.length === 0 ? (
          <p className="faint list-hint">还没有留言</p>
        ) : (
          list.map((m) => <MsgCard key={m.id} m={m} onChanged={load} />)
        )}
      </div>

      {/* FAB：聚焦顶部输入框（留言板的"新增"就是 composer） */}
      <button
        className="fab"
        onClick={() => {
          taRef.current?.focus()
          taRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }}
        aria-label="写留言"
      >
        <Plus size={24} />
      </button>
    </>
  )
}

// 留言卡：编辑 + 删除 + 移动。双方留言都可编辑（拍板：不做角色区分，克制靠约定）
function MsgCard({ m, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const c = draft.trim()
    if (!c || busy) return
    setBusy(true)
    try {
      await messageUpdate(m.id, { content: c })
      showToast('已保存')
      setEditing(false)
      onChanged()
    } catch (e) {
      showToast(e?.message || '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (busy || !window.confirm('删除这条留言？')) return
    setBusy(true)
    try {
      await messageDelete(m.id)
      onChanged()
    } catch (e) {
      showToast(e?.message || '删除失败')
      setBusy(false)
    }
  }

  return (
    <div
      className={'card msg-card' + (m.from === 'emet' ? ' msg-card--emet' : '')}
      style={{ position: 'relative' }}
    >
      {!m.locked && !editing && (
        <>
          <button
            className="idea-card__del"
            style={{ right: 56 }}
            onClick={() => {
              setDraft(m.content || '')
              setEditing(true)
            }}
            aria-label="编辑"
          >
            <Pencil size={13} />
          </button>
          <MoveButton id={m.id} fromType="message" onMoved={onChanged} />
          <button className="idea-card__del" onClick={remove} aria-label="删除">
            <X size={14} />
          </button>
        </>
      )}
      <div className="msg-card__head">
        <span className="msg-card__who">{SENDER_LABEL[m.from] || m.from}</span>
        <span className="faint msg-card__time">
          {shortDateZh(m.created_at)} {timeOfDayZh(m.created_at)}
        </span>
      </div>
      {editing ? (
        <div className="inline-edit">
          <textarea
            autoFocus
            value={draft}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="idea-form__foot">
            <button className="mini-btn" onClick={() => setEditing(false)}>
              取消
            </button>
            <button
              className="mini-btn mini-btn--accent"
              disabled={!draft.trim() || busy}
              onClick={save}
            >
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <p className="msg-card__content">{m.content}</p>
      )}
    </div>
  )
}

// ════════════════ 灵感板 ════════════════
function IdeaBoard() {
  const [list, setList] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [content, setContent] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () =>
    ideaAll()
      .then(setList)
      .catch(() => setList((prev) => prev || []))

  useEffect(() => {
    let alive = true
    ideaAll()
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]))
    return () => {
      alive = false
    }
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
      alert(e.message || '保存失败')
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
      alert(e.message || '删除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {formOpen && (
        <div className="card idea-form">
          <textarea
            autoFocus
            value={content}
            rows={3}
            placeholder="记下这个灵感…"
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="idea-form__tags">
            <input
              value={tagsInput}
              placeholder="#标签 用逗号或空格分隔（可空）"
              onChange={(e) => setTagsInput(e.target.value)}
            />
          </div>
          <div className="idea-form__foot">
            <button className="mini-btn" onClick={() => setFormOpen(false)}>
              取消
            </button>
            <button className="mini-btn mini-btn--accent" disabled={!content.trim() || busy} onClick={save}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}

      <div className="stack">
        {list === null ? (
          <p className="faint list-hint">加载中…</p>
        ) : list.length === 0 ? (
          <p className="faint list-hint">还没有灵感</p>
        ) : (
          list.map((i) => <IdeaCard key={i.id} idea={i} busy={busy} onChanged={load} onRemove={remove} />)
        )}
      </div>

      {/* FAB 取代原"记一个灵感"内联按钮（与记忆页同款） */}
      <button className="fab" onClick={() => setFormOpen(true)} aria-label="记灵感">
        <Plus size={24} />
      </button>
    </>
  )
}

function IdeaCard({ idea: i, busy: listBusy, onChanged, onRemove }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [tagsDraft, setTagsDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const c = draft.trim()
    if (!c || busy) return
    setBusy(true)
    try {
      const tags = tagsDraft.split(/[,，\s#]+/).map((t) => t.trim()).filter(Boolean)
      await ideaUpdate(i.id, { content: c, tags })
      showToast('已保存')
      setEditing(false)
      onChanged()
    } catch (e) {
      showToast(e?.message || '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card idea-card" style={{ position: 'relative' }}>
      {!i.locked && !editing && (
        <>
          <button
            className="idea-card__del"
            style={{ right: 56 }}
            onClick={() => {
              setDraft(i.content || '')
              setTagsDraft((i.tags || []).join(', '))
              setEditing(true)
            }}
            aria-label="编辑"
          >
            <Pencil size={13} />
          </button>
          <MoveButton id={i.id} fromType="idea" onMoved={onChanged} />
          <button
            className="idea-card__del"
            onClick={() => onRemove(i.id)}
            disabled={listBusy}
            aria-label="删除"
          >
            <X size={14} />
          </button>
        </>
      )}
      {editing ? (
        <div className="inline-edit">
          <textarea autoFocus value={draft} rows={3} onChange={(e) => setDraft(e.target.value)} />
          <input
            className="inline-edit__tags"
            value={tagsDraft}
            placeholder="#标签 用逗号或空格分隔（可空）"
            onChange={(e) => setTagsDraft(e.target.value)}
          />
          <div className="idea-form__foot">
            <button className="mini-btn" onClick={() => setEditing(false)}>
              取消
            </button>
            <button className="mini-btn mini-btn--accent" disabled={!draft.trim() || busy} onClick={save}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="idea-card__content">{i.content}</p>
          {i.tags?.length > 0 && (
            <div className="mem-card__tags">
              {i.tags.map((t) => (
                <span key={t} className="mem-hashtag">
                  #{t}
                </span>
              ))}
            </div>
          )}
          <div className="faint idea-card__date">{(i.created_at || '').slice(0, 10)}</div>
        </>
      )}
    </div>
  )
}
