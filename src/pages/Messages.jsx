import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Send, Plus, X, Lock, MoreHorizontal } from 'lucide-react'
import {
  messageAll,
  messageLeave,
  ideaAll,
  ideaCreate,
  ideaDelete,
  letterAll,
  memoryMove,
} from '../api.js'
import { shortDateZh, timeOfDayZh, formatDateZh } from '../utils/time.js'
import { showToast } from '../utils/toast.js'

// 移动到… 弹出菜单（六类互转，去掉自己）
const ALL_MOVE_TYPES = [
  ['memory', '记忆'],
  ['moment', '瞬记'],
  ['diary', '日记'],
  ['story', '故事'],
  ['message', '便条'],
  ['idea', '想法'],
]
function MoveButton({ id, fromType, onMoved }) {
  const [open, setOpen] = useState(false)
  const types = ALL_MOVE_TYPES.filter(([k]) => k !== fromType)
  const doMove = async (to, label) => {
    setOpen(false)
    try {
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
          <div className="tl-scrim tl-scrim--clear" onClick={() => setOpen(false)} />
          <div className="sort-menu card" style={{ right: 8, top: 36 }}>
            <div className="dm-opt faint" style={{ pointerEvents: 'none' }}>移动到</div>
            {types.map(([k, label]) => (
              <button key={k} className="dm-opt" onClick={() => doMove(k, label)}>
                {label}
              </button>
            ))}
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
            />
          ))}
        </div>
      )}
    </div>
  )
}

function LetterCard({ letter, open, onToggle }) {
  const kindLabel = letter.kind === 'handoff' ? '交接信' : '日常信'
  const dateStr = formatDateZh(letter.created_at)
  const preview = (letter.content || '').slice(0, 200)
  return (
    <article
      className={
        'letter-card letter-card--' + letter.kind + (open ? ' is-open' : '')
      }
      onClick={onToggle}
    >
      {/* 角标：锁 */}
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
    </article>
  )
}

// ════════════════ 留言板 ════════════════
function MessageBoard() {
  const [list, setList] = useState(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const load = () =>
    messageAll()
      .then(setList)
      .catch(() => setList([]))

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
          list.map((m) => (
            <div
              key={m.id}
              className={'card msg-card' + (m.from === 'emet' ? ' msg-card--emet' : '')}
              style={{ position: 'relative' }}
            >
              <MoveButton id={m.id} fromType="message" onMoved={load} />
              <div className="msg-card__head">
                <span className="msg-card__who">{SENDER_LABEL[m.from] || m.from}</span>
                <span className="faint msg-card__time">
                  {shortDateZh(m.created_at)} {timeOfDayZh(m.created_at)}
                </span>
              </div>
              <p className="msg-card__content">{m.content}</p>
            </div>
          ))
        )}
      </div>
    </>
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
      .catch(() => setList([]))

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
      {!formOpen ? (
        <button className="idea-add-btn" onClick={() => setFormOpen(true)}>
          <Plus size={16} /> 记一个灵感
        </button>
      ) : (
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
          list.map((i) => (
            <div key={i.id} className="card idea-card" style={{ position: 'relative' }}>
              {!i.locked && (
                <>
                  <MoveButton id={i.id} fromType="idea" onMoved={load} />
                  <button className="idea-card__del" onClick={() => remove(i.id)} aria-label="删除">
                    <X size={14} />
                  </button>
                </>
              )}
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
            </div>
          ))
        )}
      </div>
    </>
  )
}
