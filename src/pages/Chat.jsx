import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Send, Plus, History, X, Square, ChevronDown, Check, Wrench } from 'lucide-react'
import { marked } from 'marked'
import { chatSystemPrompt } from '../api.js'
import { streamChat } from '../utils/anthropic.js'
import { listAnthropicTools, callTool } from '../utils/mcp.js'
import { loadProviders, getActiveTarget, setActiveTarget } from '../utils/providers.js'
import { loadAssistant } from '../utils/assistant.js'
import AssistantSettings, { AssistantAvatar } from '../components/AssistantSettings.jsx'
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
  const [modelOpen, setModelOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistant, setAssistant] = useState(loadAssistant)
  const [target, setTarget] = useState(getActiveTarget)
  const bottomRef = useRef(null)
  const abortRef = useRef(null)

  const pickModel = (providerId, model) => {
    setActiveTarget(providerId, model)
    setTarget(getActiveTarget())
    setModelOpen(false)
  }

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
    if (!target) {
      showToast('请先在设置页添加供应商')
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
          ? { ...s, messages: [...s.messages, { role: 'user', content: text }, { role: 'assistant', content: '', thinking: '', tools: [] }] }
          : s,
      ),
    )

    setStreaming(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const a = loadAssistant()
      const system = await chatSystemPrompt()
      // API 的 messages：去掉最后那个空占位，再按助手设置的上下文条数 N 截断
      //（只截断发送，界面与存储里的历史消息不动）
      const full = (loadSessions().find((s) => s.id === sid)?.messages || [])
        .filter((m) => m.content !== '')
        .map((m) => ({ role: m.role, content: m.content }))
      const history = full.slice(-a.contextCount)

      // 改最后一条 assistant 占位（mutator 收到当前 last，返回新 last）
      const mutateLast = (mutator) => {
        update((prev) =>
          prev.map((s) => {
            if (s.id !== sid) return s
            const msgs = [...s.messages]
            msgs[msgs.length - 1] = mutator({ ...msgs[msgs.length - 1] })
            return { ...s, messages: msgs }
          }),
        )
      }

      // 工具调用回调：在 assistant 消息的 tools 数组里登记/更新（按 id 合并）
      const onToolUse = (ev) =>
        mutateLast((m) => {
          const tools = [...(m.tools || [])]
          const idx = tools.findIndex((t) => t.id === ev.id)
          const entry = {
            id: ev.id,
            name: ev.name,
            input: ev.input,
            result: ev.phase === 'result' ? ev.result : idx >= 0 ? tools[idx].result : undefined,
            status: ev.phase === 'result' ? 'done' : 'running',
          }
          if (idx >= 0) tools[idx] = entry
          else tools.push(entry)
          return { ...m, role: 'assistant', tools }
        })

      // 工具仅 Anthropic 原生协议启用（拍板①A）；拉取失败则降级为无工具纯聊天
      let tools = null
      if (target?.provider?.protocol !== 'openai') {
        try {
          tools = await listAnthropicTools()
        } catch {
          tools = null
        }
      }

      await streamChat({
        system,
        messages: history,
        temperature: a.temperature,
        maxTokens: a.maxTokens,
        tools,
        runTool: (name, input) => callTool(name, input),
        signal: ctrl.signal,
        onDelta: (_d, fullText) => mutateLast((m) => ({ ...m, role: 'assistant', content: fullText })),
        onThinking: (_d, fullThinking) => mutateLast((m) => ({ ...m, role: 'assistant', thinking: fullThinking })),
        onToolUse,
      })
    } catch (e) {
      if (e.name === 'AbortError') {
        showToast('已停止')
      } else {
        const msg = e.message === 'NO_PROVIDER' ? '请先在设置页添加供应商' : e.message || '请求失败'
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

  return (
    <div className="chat-page">
      {/* 顶栏：当前供应商 · 模型，点击切换 */}
      <header className="chat-bar">
        <button className="chat-bar__btn" onClick={() => setHistoryOpen(true)} aria-label="历史对话">
          <History size={19} />
        </button>
        <div className="chat-bar__center">
          <button className="chat-assistant" onClick={() => setAssistantOpen(true)} aria-label="助手设置">
            <AssistantAvatar avatar={assistant.avatar} size={20} />
            <span className="chat-assistant__name">{assistant.name}</span>
            <ChevronDown size={12} className="faint" />
          </button>
          <button className="chat-model" onClick={() => setModelOpen(true)}>
            {target ? (
              <>
                <span className="chat-model__prov">{target.provider.name}</span>
                <span className="chat-model__id">{target.model}</span>
              </>
            ) : (
              <span className="faint">未配置供应商</span>
            )}
            <ChevronDown size={12} />
          </button>
        </div>
        <button className="chat-bar__btn" onClick={newSession} aria-label="新对话">
          <Plus size={20} />
        </button>
      </header>

      {/* 消息区 */}
      <div className="chat-scroll">
        {!target && (
          <div className="card chat-hint">
            还没有可用的供应商。去 <Link to="/settings">设置页</Link> 添加一个就能开聊。
          </div>
        )}
        {messages.length === 0 && target && (
          <p className="faint chat-empty">说点什么吧。</p>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="chat-msg chat-msg--user">
              <div className="chat-bubble chat-bubble--user">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="chat-msg chat-msg--emet">
              <div className="chat-emet-head">
                <AssistantAvatar avatar={assistant.avatar} size={18} />
                <span className="chat-emet-name">{assistant.name}</span>
              </div>
              {m.thinking ? (
                <details className="chat-think">
                  <summary className="chat-think__summary">思考过程</summary>
                  <div className="chat-think__body">{m.thinking}</div>
                </details>
              ) : null}
              {(m.tools || []).map((t) => (
                <details key={t.id} className="chat-tool">
                  <summary className="chat-tool__summary">
                    <Wrench size={12} />
                    <span className="chat-tool__name">{t.name}</span>
                    {t.status === 'running' && <span className="chat-tool__spin">调用中…</span>}
                  </summary>
                  <div className="chat-tool__body">
                    <div className="chat-tool__label">参数</div>
                    <pre className="chat-tool__pre">{JSON.stringify(t.input || {}, null, 2)}</pre>
                    {t.result != null && (
                      <>
                        <div className="chat-tool__label">结果</div>
                        <pre className="chat-tool__pre">{t.result}</pre>
                      </>
                    )}
                  </div>
                </details>
              ))}
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

      {/* 供应商/模型切换面板 */}
      {modelOpen && (
        <>
          <div className="ts-scrim" onClick={() => setModelOpen(false)} />
          <div className="ts-panel card">
            <div className="ts-head">
              <span className="ts-title">选择模型</span>
              <button className="ts-close" onClick={() => setModelOpen(false)} aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="model-sheet">
              {loadProviders().filter((p) => p.enabled && p.apiKey).length === 0 ? (
                <p className="faint ts-empty">
                  没有可用供应商，去 <Link to="/settings" onClick={() => setModelOpen(false)}>设置页</Link> 添加。
                </p>
              ) : (
                loadProviders()
                  .filter((p) => p.enabled && p.apiKey)
                  .map((p) => (
                    <div key={p.id} className="model-sheet__group">
                      <div className="model-sheet__prov faint">
                        {p.name}
                        <em className="prov-badge">{p.protocol === 'openai' ? 'OpenAI 兼容' : 'Anthropic'}</em>
                      </div>
                      {p.models.map((m) => {
                        const active = target?.provider.id === p.id && target?.model === m
                        return (
                          <button
                            key={m}
                            className={'model-sheet__item' + (active ? ' is-active' : '')}
                            onClick={() => pickModel(p.id, m)}
                          >
                            {m}
                            {active && <Check size={14} />}
                          </button>
                        )
                      })}
                    </div>
                  ))
              )}
            </div>
          </div>
        </>
      )}

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

      {/* 助手设置抽屉（与设置页共用 AssistantSettings；改动即时生效） */}
      {assistantOpen && (
        <>
          <div className="ts-scrim" onClick={() => setAssistantOpen(false)} />
          <div className="ts-panel card asst-panel">
            <div className="ts-head">
              <span className="ts-title">助手设置</span>
              <button className="ts-close" onClick={() => setAssistantOpen(false)} aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="asst-panel__scroll">
              <AssistantSettings onChange={setAssistant} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
