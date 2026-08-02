import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Send, Plus, X, Lock, MoreHorizontal, Heart, MessageCircle, ImagePlus } from 'lucide-react'
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
  feedList,
  feedCreate,
  feedUpdate,
  feedDelete,
  feedLike,
  feedComment,
  feedCommentDelete,
} from '../api.js'
import AuthImg from '../components/AuthImg.jsx'
import LoadError from '../components/LoadError.jsx'
import { shortDateZh, timeOfDayZh, formatDateZh } from '../utils/time.js'
import { showToast } from '../utils/toast.js'
import { compressImage } from '../utils/image.js'
import { MOVE_GROUPS, visibleChildren, groupHasOptions } from '../utils/moveGroups.js'

// 自适应高度文本框：内容多长撑多高，不出内部滚动条/拉伸条（编辑态全部显示）
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
  const tab = ['letter', 'board', 'idea', 'feed'].includes(searchParams.get('tab'))
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
        <button
          className={'subtab' + (tab === 'feed' ? ' is-active' : '')}
          onClick={() => setTab('feed')}
        >
          动态
        </button>
      </div>

      {tab === 'letter' && <LetterBoard />}
      {tab === 'board' && <MessageBoard />}
      {tab === 'idea' && <IdeaBoard />}
      {tab === 'feed' && <FeedBoard />}
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
  const [loadErr, setLoadErr] = useState(null)
  const [kind, setKind] = useState('all')
  const [composeOpen, setComposeOpen] = useState(false)

  const load = () =>
    letterAll()
      .then((l) => {
        setList(l)
        setLoadErr(null)
      })
      // 刷新失败保留旧列表（首载失败才落空态），别把已显示的内容清掉
      .catch((e) => {
        setLoadErr(e)
        setList((prev) => prev || [])
      })

  useEffect(() => {
    let alive = true
    letterAll()
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

      {loadErr && <LoadError err={loadErr} onRetry={load} compact={filtered.length > 0} />}

      {filtered.length === 0 && !loadErr ? (
        <div className="letter-empty">
          <div className="letter-empty__line" />
          <p className="letter-empty__text">还没有信</p>
          <div className="letter-empty__line" />
        </div>
      ) : filtered.length > 0 ? (
        <div className="letter-list">
          {filtered.map((l) => (
            <LetterCard key={l.id} letter={l} onChanged={load} />
          ))}
        </div>
      ) : null}

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

// 信件卡：点击即编辑（与记忆一致，无铅笔）。锁定的信不可编辑，点击只展开阅读全文。
function LetterCard({ letter, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false) // 锁定信的只读展开
  const [tTitle, setTTitle] = useState('')
  const [tContent, setTContent] = useState('')
  const [busy, setBusy] = useState(false)

  const kindLabel = letter.kind === 'handoff' ? '交接信' : '日常信'
  const dateStr = formatDateZh(letter.created_at)
  const preview = (letter.content || '').slice(0, 200)

  const onCardClick = () => {
    if (editing) return
    if (letter.locked) {
      setOpen((v) => !v) // 锁定=只读，点击展开/收起
      return
    }
    setTTitle(letter.title || '')
    setTContent(letter.content || '')
    setEditing(true)
  }
  const save = async () => {
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
      className={'letter-card letter-card--' + letter.kind + (open || editing ? ' is-open' : '')}
      onClick={editing ? undefined : onCardClick}
    >
      {letter.locked && (
        <span className="letter-card__lock" aria-label="已锁定">
          <Lock size={12} />
        </span>
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
          <AutoTextarea
            className="letter-card__editarea"
            autoFocus
            value={tContent}
            onChange={(e) => setTContent(e.target.value)}
          />
          <div className="idea-form__foot">
            <button className="mini-btn" onClick={() => setEditing(false)}>
              取消
            </button>
            <button className="mini-btn mini-btn--accent" disabled={!tContent.trim() || busy} onClick={save}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {letter.title && <h3 className="letter-card__title">{letter.title}</h3>}

          <div className="letter-card__body">
            {letter.locked && open ? (
              <p className="letter-card__full">{letter.content}</p>
            ) : (
              <p className="letter-card__preview">
                {preview}
                {letter.content.length > 200 && '…'}
              </p>
            )}
          </div>

          <div className="letter-card__foot">
            <span className="letter-card__sig">— Emet</span>
            <span className="letter-card__expand">{letter.locked ? (open ? '收起' : '展开全文') : '点击编辑'}</span>
          </div>
        </>
      )}
    </article>
  )
}

// ════════════════ 留言板 ════════════════
function MessageBoard() {
  const [list, setList] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const taRef = useRef(null)

  const load = () =>
    messageAll()
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
    messageAll()
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
        ) : (
          <>
            {loadErr && <LoadError err={loadErr} onRetry={load} compact={list.length > 0} />}
            {list.length === 0 && !loadErr ? (
              <p className="faint list-hint">还没有留言</p>
            ) : (
              list.map((m) => <MsgCard key={m.id} m={m} onChanged={load} />)
            )}
          </>
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
          <AutoTextarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
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
        // 点内容即进编辑（与记忆一致，无铅笔）；锁定的留言不可编辑
        <p
          className={'msg-card__content' + (m.locked ? '' : ' is-editable')}
          onClick={
            m.locked
              ? undefined
              : () => {
                  setDraft(m.content || '')
                  setEditing(true)
                }
          }
        >
          {m.content}
        </p>
      )}
    </div>
  )
}

// ════════════════ 灵感板 ════════════════
function IdeaBoard() {
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
        ) : (
          <>
            {loadErr && <LoadError err={loadErr} onRetry={load} compact={list.length > 0} />}
            {list.length === 0 && !loadErr ? (
              <p className="faint list-hint">还没有灵感</p>
            ) : (
              list.map((i) => <IdeaCard key={i.id} idea={i} busy={busy} onChanged={load} onRemove={remove} />)
            )}
          </>
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
          <AutoTextarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
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
          {/* 点内容即进编辑（与记忆一致，无铅笔）；锁定的灵感不可编辑 */}
          <p
            className={'idea-card__content' + (i.locked ? '' : ' is-editable')}
            onClick={
              i.locked
                ? undefined
                : () => {
                    setDraft(i.content || '')
                    setTagsDraft((i.tags || []).join(', '))
                    setEditing(true)
                  }
            }
          >
            {i.content}
          </p>
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

// ════════════════ 动态流（二期 2-1）════════════════
// 时间线卡片：内容、来源小标、点赞心形、评论展开。
// 交互跟随现有三卡片习惯：点内容进编辑仅限自己发的手动动态；AI 自动产出（独处/梦）只读。
const FEED_SOURCE_LABEL = { 'idle-auto': '独处', dream: '梦' }

function FeedBoard() {
  const [items, setItems] = useState(null)
  const [nextBefore, setNextBefore] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [text, setText] = useState('')
  const [imgs, setImgs] = useState([]) // [{ data, media_type, preview }]，最多 3 张
  const [sending, setSending] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const taRef = useRef(null)
  const fileRef = useRef(null)

  const pickImages = async (e) => {
    const files = [...(e.target.files || [])]
    e.target.value = '' // 允许重复选同一张
    if (!files.length) return
    const room = 3 - imgs.length
    if (room <= 0) {
      showToast('最多 3 张图')
      return
    }
    try {
      const picked = []
      for (const f of files.slice(0, room)) picked.push(await compressImage(f))
      setImgs((prev) => [...prev, ...picked])
    } catch (err) {
      showToast(err?.message || '图片处理失败')
    }
  }

  const loadFirst = () =>
    feedList({ limit: 20 })
      .then((r) => {
        setItems(r.items || [])
        setNextBefore(r.next_before || null)
        setLoadErr(null)
      })
      // 刷新失败保留旧列表（与留言板同策略）
      .catch((e) => {
        setLoadErr(e)
        setItems((prev) => prev || [])
      })

  useEffect(() => {
    let alive = true
    feedList({ limit: 20 })
      .then((r) => {
        if (!alive) return
        setItems(r.items || [])
        setNextBefore(r.next_before || null)
        setLoadErr(null)
      })
      .catch((e) => {
        if (!alive) return
        setItems([])
        setLoadErr(e)
      })
    return () => {
      alive = false
    }
  }, [])

  const send = async () => {
    const content = text.trim()
    if ((!content && imgs.length === 0) || sending) return
    setSending(true)
    try {
      const r = await feedCreate(content, imgs.map(({ data, media_type }) => ({ data, media_type })))
      // 发图必须验真落库（worker 错误当 200 的坑）：带了图但返回的 item 没有图 = 没存上
      if (imgs.length && !(r?.item?.images?.length)) throw new Error('图片没有存上，请再试一次')
      setText('')
      setImgs([])
      // 新动态直接插到顶部，不整表重拉（避免把已翻出的更早动态冲掉）
      if (r?.item) setItems((prev) => [r.item, ...(prev || [])])
      else await loadFirst()
    } catch (e) {
      showToast(e?.message || '发送失败')
    } finally {
      setSending(false)
    }
  }

  // 游标翻页：接在已有列表后面，老内容永远可达
  const loadMore = async () => {
    if (!nextBefore || loadingMore) return
    setLoadingMore(true)
    try {
      const r = await feedList({ before: nextBefore, limit: 20 })
      setItems((prev) => [...(prev || []), ...(r.items || [])])
      setNextBefore(r.next_before || null)
    } catch (e) {
      showToast(e?.message || '加载失败')
    } finally {
      setLoadingMore(false)
    }
  }

  // 互动后只局部更新那一条 / 删除那一条，保住已加载的翻页（不再整表塌回第一页）
  const patchItem = (updated) => {
    if (!updated) return
    setItems((prev) => (prev || []).map((x) => (x.id === updated.id ? updated : x)))
  }
  const removeItem = (id) => setItems((prev) => (prev || []).filter((x) => x.id !== id))

  return (
    <>
      <div className="composer composer--feed">
        <textarea
          ref={taRef}
          value={text}
          rows={2}
          placeholder="分享一条动态…"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="composer-side">
          <button
            className="composer-attach"
            onClick={() => fileRef.current?.click()}
            disabled={sending || imgs.length >= 3}
            aria-label="添加图片"
          >
            <ImagePlus size={17} />
          </button>
          <button
            className="composer-send"
            disabled={(!text.trim() && imgs.length === 0) || sending}
            onClick={send}
            aria-label="发布"
          >
            <Send size={17} />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={pickImages}
        />
      </div>
      {imgs.length > 0 && (
        <div className="feed-compose__previews">
          {imgs.map((im, i) => (
            <div key={i} className="feed-compose__preview">
              <img src={im.preview} alt="" />
              <button
                className="feed-compose__preview-del"
                onClick={() => setImgs((prev) => prev.filter((_, j) => j !== i))}
                aria-label="移除图片"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="stack">
        {items === null ? (
          <p className="faint list-hint">加载中…</p>
        ) : (
          <>
            {loadErr && <LoadError err={loadErr} onRetry={loadFirst} compact={items.length > 0} />}
            {items.length === 0 && !loadErr ? (
              <p className="faint list-hint">还没有动态</p>
            ) : (
              items.map((f) => <FeedCard key={f.id} f={f} onPatch={patchItem} onRemove={removeItem} />)
            )}
          </>
        )}
        {nextBefore && (
          <button className="mini-btn feed-more" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? '加载中…' : '加载更早的动态'}
          </button>
        )}
      </div>

      <button
        className="fab"
        onClick={() => {
          taRef.current?.focus()
          taRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }}
        aria-label="发动态"
      >
        <Plus size={24} />
      </button>
    </>
  )
}

function FeedCard({ f, onPatch, onRemove }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [showComments, setShowComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [busy, setBusy] = useState(false)
  const [viewImg, setViewImg] = useState(null) // 点小图看大图；null = 关闭

  const isAuto = f.source !== 'manual'
  const editable = !isAuto && f.author === 'yomi' // 仅自己发的手动动态可编辑
  const sourceTag = FEED_SOURCE_LABEL[f.source]
  const likedByMe = !!f.likes?.yomi
  const likedByEmet = !!f.likes?.emet
  const comments = f.comments || []
  const images = f.images || []

  const toggleLike = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await feedLike(f.id, 'yomi')
      onPatch(r?.item)
    } catch (e) {
      showToast(e?.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    const c = draft.trim()
    if (!c || busy) return
    setBusy(true)
    try {
      const r = await feedUpdate(f.id, c)
      showToast('已保存')
      setEditing(false)
      onPatch(r?.item)
    } catch (e) {
      showToast(e?.message || '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (busy || !window.confirm('删除这条动态？')) return
    setBusy(true)
    try {
      await feedDelete(f.id)
      onRemove(f.id)
    } catch (e) {
      showToast(e?.message || '删除失败')
      setBusy(false)
    }
  }

  const sendComment = async () => {
    const c = commentText.trim()
    if (!c || busy) return
    setBusy(true)
    try {
      const r = await feedComment(f.id, c, 'yomi')
      setCommentText('')
      onPatch(r?.item)
    } catch (e) {
      showToast(e?.message || '评论失败')
    } finally {
      setBusy(false)
    }
  }

  const removeComment = async (cid) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await feedCommentDelete(f.id, cid)
      onPatch(r?.item)
    } catch (e) {
      showToast(e?.message || '删除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={'card msg-card feed-card' + (f.author === 'emet' ? ' msg-card--emet' : '')}
      style={{ position: 'relative' }}
    >
      {!editing && (
        <button className="idea-card__del" onClick={remove} aria-label="删除">
          <X size={14} />
        </button>
      )}
      <div className="msg-card__head">
        <span className="msg-card__who">
          {SENDER_LABEL[f.author] || f.author}
          {sourceTag && <em className="feed-card__source">{sourceTag}</em>}
        </span>
        <span className="faint msg-card__time">
          {shortDateZh(f.created_at)} {timeOfDayZh(f.created_at)}
        </span>
      </div>

      {editing ? (
        <div className="inline-edit">
          <AutoTextarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
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
        <p
          className={'msg-card__content' + (editable ? ' is-editable' : '')}
          onClick={
            editable
              ? () => {
                  setDraft(f.content || '')
                  setEditing(true)
                }
              : undefined
          }
        >
          {f.content}
        </p>
      )}

      {images.length > 0 && (
        <div className="feed-card__imgs" data-n={Math.min(images.length, 3)}>
          {images.map((id) => (
            <AuthImg key={id} kind="feed" id={id} onClick={() => setViewImg(id)} />
          ))}
        </div>
      )}

      {viewImg && (
        <div className="img-lightbox" onClick={() => setViewImg(null)}>
          <AuthImg kind="feed" id={viewImg} />
        </div>
      )}

      {/* 点赞 + 评论行 */}
      <div className="feed-card__actions">
        <button
          className={'feed-act' + (likedByMe ? ' is-on' : '')}
          onClick={toggleLike}
          aria-label="点赞"
        >
          <Heart size={15} fill={likedByMe ? 'currentColor' : 'none'} />
        </button>
        {likedByEmet && <span className="faint feed-card__emet-like">Emet ♥</span>}
        <button
          className={'feed-act' + (showComments ? ' is-on' : '')}
          onClick={() => setShowComments((v) => !v)}
          aria-label="评论"
        >
          <MessageCircle size={15} />
          {comments.length > 0 && <span className="feed-act__count">{comments.length}</span>}
        </button>
      </div>

      {showComments && (
        <div className="feed-card__comments">
          {comments.map((c) => (
            <div key={c.id} className="feed-comment">
              <span className="feed-comment__who">{SENDER_LABEL[c.author] || c.author}</span>
              <span className="feed-comment__text">{c.content}</span>
              {c.author === 'yomi' && (
                <button
                  className="feed-comment__del faint"
                  onClick={() => removeComment(c.id)}
                  aria-label="删除评论"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          <div className="feed-comment__composer">
            <input
              value={commentText}
              placeholder="写条评论…"
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendComment()
              }}
            />
            <button
              className="mini-btn mini-btn--accent"
              disabled={!commentText.trim() || busy}
              onClick={sendComment}
            >
              发送
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
