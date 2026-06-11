import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Send, Plus, History, X, Square } from 'lucide-react'
import { marked } from 'marked'
import { chatSystemPrompt } from '../api.js'
import { streamChat, getApiKey } from '../utils/anthropic.js'
import { showToast } from '../utils/toast.js'
import { formatCardTime } from '../utils/time.js'

marked.setOptions({ breaks: true, gfm: true })

// 聊天会话存 localStorage（三期第一版，后端持久化以后再说）
const LS_KEY = 'emet.chatSessions'

function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || []
  } catch {
    return []
  }
}

function persistSessions(sessions) {
  localStorage.setItem(LS_KEY, JSON.stringify(sessions))
}

export default function Chat() {
  const [sessions, setSessions] = useState(loadSessions)
  const [curId, setCurId] = useState(() => loadSessions()[0]?.id || null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const bottomRef = useRef(null)
  const abortRef = useRef(null)

  const cur = sessions.find((s) => s.id === curId) || null
  const messages = cur?.messages || []

  // 流式期间持续滚到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, streaming])

  const update = (fn) => {
    setSessions((prev) => {
      const next = fn(prev)
      persistSessions(next)
      return next
    })
  }

  const newSession = () => {
    if (streaming) return
    setCurId(null)
    setHistoryOpen(false)
  }

  const deleteSession = (id) => {
    if (!window.confirm('删除这段对话？')) return
    update((prev) => prev.filter((s) => s.id !== id))
    if (curId === id) setCurId(null)
  }

  const stop = () => {
    abortRef.current?.abort()
  }

  const send = async () => {
    const text = input.trim()
    if (!text || streaming) return
    if (!getApiKey()) {
      showToast('请先在设置页填 API Key')
      return
    }

    // 没有当前会话就建一个，标题取首条消息前 14 字
    let sid = curId
    if (!sid) {
      sid = 'c' + Date.now()
      const session = {
        id: sid,
        title: text.replace(/\s+/g, ' ').slice(0, 14),
        created_at: new Date().toISOString(),
        messages: [],
      }
      update((prev) => [session, ...prev])
      setCurId(sid)
    }

    setInput('')
    // 追加用户消息 + 空的 assistant 占位
    update((prev) =>
      prev.map((s) =>
        s.id === sid
          ? { ...s, messages: [...s.messages, { role: 'user', content: text }, { role: 'assistant', content: '' }] }
          : s,
      ),
    )

    setStreaming(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const system = await chatSystemPrompt()
      // API 的 messages：去掉最后那个空占位
      const history = (loadSessions().find((s) => s.id === sid)?.messages || [])
        .filter((m) => m.content !== '')
        .map((m) => ({ role: m.role, content: m.content }))

      await streamChat({
        system,
        messages: history,
        signal: ctrl.signal,
        onDelta: (_d, full) => {
          update((prev) =>
            prev.map((s) => {
              if (s.id !== sid) return s
              const msgs = [...s.messages]
              msgs[msgs.length - 1] = { role: 'assistant', content: full }
              return { ...s, messages: msgs }
            }),
          )
        },
      })
    } catch (e) {
      if (e.name === 'AbortError') {
        showToast('已停止')
      } else {
        const msg = e.message === 'NO_KEY' ? '请先在设置页填 API Key' : e.message || '请求失败'
        showToast(msg)
        // 把空占位换成错误提示，避免留一个空气泡
        update((prev) =>
          prev.map((s) => {
            if (s.id !== sid) return s
            const msgs = [...s.messages]
            const last = msgs[msgs.length - 1]
            if (last?.role === 'assistant' && !last.content) {
              msgs[msgs.length - 1] = { role: 'assistant', content: '（' + msg + '）' }
            }
            return { ...s, messages: msgs }
          }),
        )
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const hasKey = !!getApiKey()

  return (
    <div className="chat-page">
      {/* 顶栏 */}
      <header className="chat-bar">
        <button className="chat-bar__btn" onClick={() => setHistoryOpen(true)} aria-label="历史对话">
          <History size={19} />
        </button>
        <span className="chat-bar__title">{cur ? cur.title : '消息'}</span>
        <button className="chat-bar__btn" onClick={newSession} aria-label="新对话">
          <Plus size={20} />
        </button>
      </header>

      {/* 消息区 */}
      <div className="chat-scroll">
        {!hasKey && (
          <div className="card chat-hint">
            还没有配置 API Key。去 <Link to="/settings">设置页</Link> 填上就能开聊。
          </div>
        )}
        {messages.length === 0 && hasKey && (
          <p className="faint chat-empty">说点什么吧。</p>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="chat-msg chat-msg--user">
              <div className="chat-bubble chat-bubble--user">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="chat-msg chat-msg--emet">
              <div
                className="chat-bubble chat-bubble--emet"
                // Emet 的输出走 Markdown（自己人，信任渲染）
                dangerouslySetInnerHTML={{
                  __html:
                    marked.parse(m.content || '') +
                    (streaming && i === messages.length - 1 ? '<span class="chat-cursor">▍</span>' : ''),
                }}
              />
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div className="chat-input">
        <textarea
          rows={1}
          value={input}
          placeholder="说点什么…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
        />
        {streaming ? (
          <button className="chat-send chat-send--stop" onClick={stop} aria-label="停止">
            <Square size={15} fill="currentColor" />
          </button>
        ) : (
          <button className="chat-send" disabled={!input.trim()} onClick={send} aria-label="发送">
            <Send size={17} />
          </button>
        )}
      </div>

      {/* 历史对话抽屉 */}
      {historyOpen && (
        <>
          <div className="ts-scrim" onClick={() => setHistoryOpen(false)} />
          <div className="chat-history card">
            <div className="ts-head">
              <span className="ts-title">历史对话</span>
              <button className="ts-close" onClick={() => setHistoryOpen(false)} aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            {sessions.length === 0 ? (
              <p className="faint ts-empty">还没有对话</p>
            ) : (
              <div className="chat-history__list">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={'chat-history__item' + (s.id === curId ? ' is-active' : '')}
                    onClick={() => {
                      setCurId(s.id)
                      setHistoryOpen(false)
                    }}
                  >
                    <span className="chat-history__title">{s.title}</span>
                    <span className="faint chat-history__time">{formatCardTime(s.created_at)}</span>
                    <button
                      className="faint"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteSession(s.id)
                      }}
                      aria-label="删除"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
