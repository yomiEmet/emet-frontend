import { useState, useEffect } from 'react'
import { Send, Plus, X } from 'lucide-react'
import { messageAll, messageLeave, ideaAll, ideaCreate, ideaDelete } from '../api.js'
import { shortDateZh, timeOfDayZh } from '../utils/time.js'

// 留言页（设计 4.4）：留言板（朋友圈式）+ 灵感板
export default function Messages() {
  const [tab, setTab] = useState('board') // board | idea

  return (
    <div className="page">
      <div className="subtabs">
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

      {tab === 'board' ? <MessageBoard /> : <IdeaBoard />}
    </div>
  )
}

const SENDER_LABEL = { emet: 'Emet', yomi: '静怡' }

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
            <div key={m.id} className={'card msg-card' + (m.from === 'emet' ? ' msg-card--emet' : '')}>
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
            <div key={i.id} className="card idea-card">
              {!i.locked && (
                <button className="idea-card__del" onClick={() => remove(i.id)} aria-label="删除">
                  <X size={14} />
                </button>
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
