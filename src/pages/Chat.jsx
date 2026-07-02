import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Send, Plus, History, X, Square, ChevronDown, Check, Wrench, Sparkles } from 'lucide-react'
import { marked } from 'marked'
import { chatSystemPrompt } from '../api.js'
import { streamChat } from '../utils/anthropic.js'
import { listAnthropicTools, callTool } from '../utils/mcp.js'
import { loadProviders, getActiveTarget, setActiveTarget, isProviderReady } from '../utils/providers.js'
import { loadAssistant } from '../utils/assistant.js'
import AssistantSettings, { AssistantAvatar } from '../components/AssistantSettings.jsx'
import { showToast } from '../utils/toast.js'
import { formatCardTime } from '../utils/time.js'
// 会话存储集中在 utils/sessions.js（设置页导出/导入共用同一来源）
import { loadSessions, saveSessions as persistSessions, newMessage } from '../utils/sessions.js'
import { pull, schedulePush, deleteRemote } from '../utils/sync.js'

marked.setOptions({ breaks: true, gfm: true })

// ── 对话沉淀：独立一次请求，让模型把对话里值得长期保存的内容用工具存进记忆库 ──
const DISTILL_SYSTEM =
  '你是 Emet 的记忆沉淀助手。任务：回顾一段对话，把其中值得长期保存的内容用工具存进记忆库。' +
  '只保存对话里真实出现的内容，不要编造；保存动作一律通过工具完成，最后用一两句话简短汇报。'
const DISTILL_PROMPT =
  '请回顾上面这段对话，提炼 1–3 条值得长期保存的内容，用 memory_save 工具逐条保存' +
  '（每条的分类 category、重要度 importance、标签 tags 由你判断）；如果其中有适合记成「当下状态」的，' +
  '可以再用 moment_save 另存一条瞬记。全部保存完成后，用一两句话向静怡汇报你存了什么。'

// ── 缓存锚定窗口（Step2）：起点取 STEP 整数倍、只每 STEP 条前移一次（防滑动毁缓存前缀），
//    再吸附到 user 消息（Anthropic 要求首条为 user）。发送与压缩共用，避免两处算法漂移。──
const ANCHOR_STEP = 20
function anchorStart(full, ctx) {
  let start = full.length > ctx ? Math.floor((full.length - ctx) / ANCHOR_STEP) * ANCHOR_STEP : 0
  while (start < full.length && full[start].role !== 'user') start++
  return start
}

// ── 对话压缩（Step3b）：滑出锚定窗口的旧消息 → 覆盖式滚动摘要，Emet 记性不断档 ──
const SUMMARY_SYSTEM =
  '你是对话记忆压缩器。把「旧摘要」与「新滑出窗口的对话」合并成一份接续摘要，500 字以内：' +
  '保留正在进行的话题、未完成的约定、重要事实与决定、情绪基调；用第三人称白描，不评论。只输出摘要正文。'

export default function Chat() {
  const [sessions, setSessions] = useState(loadSessions)
  const [curId, setCurId] = useState(() => loadSessions().find((s) => !s.deleted)?.id || null)
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

  const cur = sessions.find((s) => s.id === curId && !s.deleted) || null
  const messages = cur?.messages || []
  const visibleSessions = sessions.filter((s) => !s.deleted) // 墓碑不进列表

  // 流式期间持续滚到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, streaming])

  // 挂载时从云端拉增量并入本地（多设备同步）；失败（离线/无密钥）静默
  useEffect(() => {
    let alive = true
    pull()
      .then(() => alive && setSessions(loadSessions()))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

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
    // 墓碑删除：标 deleted 而非真删，让删除能同步到其他设备
    update((prev) => prev.map((s) => (s.id === id ? { ...s, deleted: true, updated_at: new Date().toISOString() } : s)))
    if (curId === id) setCurId(null)
    deleteRemote(id).catch(() => {})
  }

  const stop = () => {
    abortRef.current?.abort()
  }

  // 把会话最后一条空 assistant 占位换成括号错误提示，避免留空气泡
  const replaceEmptyWithError = (sid, msg) =>
    update((prev) =>
      prev.map((s) => {
        if (s.id !== sid) return s
        const msgs = [...s.messages]
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant' && !last.content) {
          msgs[msgs.length - 1] = { ...last, role: 'assistant', content: '（' + msg + '）' }
        }
        return { ...s, messages: msgs }
      }),
    )

  // 跑一轮 agentic 流（占位由调用方先建好）：把增量写进该会话最后一条 assistant 消息。
  // send 与 distill 共用。
  const streamAssistant = ({ sid, system, messages, tools, temperature, maxTokens, signal }) => {
    const mutateLast = (mutator) =>
      update((prev) =>
        prev.map((s) => {
          if (s.id !== sid) return s
          const msgs = [...s.messages]
          msgs[msgs.length - 1] = mutator({ ...msgs[msgs.length - 1] })
          return { ...s, messages: msgs }
        }),
      )
    const onToolUse = (ev) =>
      mutateLast((m) => {
        const t = [...(m.tools || [])]
        const i = t.findIndex((x) => x.id === ev.id)
        const entry = {
          id: ev.id,
          name: ev.name,
          input: ev.input,
          result: ev.phase === 'result' ? ev.result : i >= 0 ? t[i].result : undefined,
          status: ev.phase === 'result' ? 'done' : 'running',
        }
        if (i >= 0) t[i] = entry
        else t.push(entry)
        return { ...m, role: 'assistant', tools: t }
      })
    return streamChat({
      system,
      messages,
      temperature,
      maxTokens,
      tools,
      runTool: (name, input) => callTool(name, input),
      signal,
      onDelta: (_d, ft) => mutateLast((m) => ({ ...m, role: 'assistant', content: ft })),
      onThinking: (_d, ft) => mutateLast((m) => ({ ...m, role: 'assistant', thinking: ft })),
      onToolUse,
      // 缓存命中探针：把每轮 token 用量挂到该条 assistant 消息（仅 Anthropic 原生会回传）
      onUsage: (u) => mutateLast((m) => ({ ...m, role: 'assistant', usage: u })),
    })
  }

  // 对话压缩（Step3b）：锚点前移后，把新滑出窗口的消息并进滚动摘要（覆盖式、封顶）。
  // 异步跑、失败静默（summaryUpTo 不动，下次锚点自动重试）；约每 10 轮才触发一次。
  const maybeCompress = async (sid) => {
    try {
      const s = loadSessions().find((x) => x.id === sid)
      if (!s) return
      const full = (s.messages || []).filter((m) => m.content !== '' && !m.distill)
      const start = anchorStart(full, loadAssistant().contextCount)
      const upTo = s.summaryUpTo || 0
      if (start <= upTo) return // 没有新滑出的消息
      const aName = loadAssistant().name || 'Emet'
      const lines = full
        .slice(upTo, start)
        .map((m) => `${m.role === 'user' ? '静怡' : aName}：${(m.content || '').trim()}`)
        .join('\n')
      const prompt = (s.summary ? `【旧摘要】\n${s.summary}\n\n` : '') + `【新滑出窗口的对话】\n${lines}`
      // 单条 user 消息 + 字符串 system：不打缓存断点、不上报保活快照，纯一次性调用
      const text = (await streamChat({ system: SUMMARY_SYSTEM, messages: [{ role: 'user', content: prompt }], maxTokens: 1000 })).trim()
      if (!text) return
      update((prev) =>
        prev.map((x) =>
          x.id === sid ? { ...x, summary: text.slice(0, 1200), summaryUpTo: start, updated_at: new Date().toISOString() } : x,
        ),
      )
      schedulePush(sid)
    } catch {
      /* 摘要失败不影响聊天 */
    }
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
        updated_at: new Date().toISOString(),
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
          ? { ...s, updated_at: new Date().toISOString(), messages: [...s.messages, newMessage('user', { content: text }), newMessage('assistant', { content: '', thinking: '', tools: [] })] }
          : s,
      ),
    )

    setStreaming(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const a = loadAssistant()
      const system = await chatSystemPrompt()
      // API 的 messages：去掉空占位与沉淀汇报，再按上下文条数 N 截断
      //（只截断发送，界面与存储里的历史消息不动）
      const full = (loadSessions().find((s) => s.id === sid)?.messages || [])
        .filter((m) => m.content !== '' && !m.distill)
        .map((m) => ({ role: m.role, content: m.content }))
      // 锚定窗口（算法见顶部 anchorStart）；窗口外的旧对话由滚动摘要兜着（见 maybeCompress）
      const history = full.slice(anchorStart(full, a.contextCount))

      // 本会话的滚动摘要垫进 system（第 4 个缓存断点；无摘要则不占）
      const sess0 = loadSessions().find((s) => s.id === sid)
      if (sess0?.summary) system.summary = sess0.summary

      // 工具仅 Anthropic 原生协议启用（拍板①A）；拉取失败则降级为无工具纯聊天
      let tools = null
      if (target?.provider?.protocol !== 'openai') {
        try {
          tools = await listAnthropicTools()
        } catch {
          tools = null
        }
      }

      await streamAssistant({ sid, system, messages: history, tools, temperature: a.temperature, maxTokens: a.maxTokens, signal: ctrl.signal })
      schedulePush(sid) // 防抖推送到云端
      maybeCompress(sid) // 不 await：锚点前移时异步更新滚动摘要
    } catch (e) {
      if (e.name === 'AbortError') {
        showToast('已停止')
      } else {
        const msg = e.message === 'NO_PROVIDER' ? '请先在设置页添加供应商' : e.message || '请求失败'
        showToast(msg)
        replaceEmptyWithError(sid, msg)
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  // 对话沉淀：独立一次请求，让模型把对话里值得长期保存的内容用工具存进记忆库
  const distill = async (id) => {
    if (streaming) return
    const session = sessions.find((s) => s.id === id)
    if (!session) return
    if (!target) {
      showToast('请先在设置页添加供应商')
      return
    }
    // 需要工具调用 → 必须 Anthropic 原生协议（拍板⑥）
    if (target.provider?.protocol === 'openai') {
      showToast('对话沉淀需要工具调用，请在顶栏切换到 Anthropic 原生供应商')
      return
    }
    const conv = session.messages.filter((m) => m.content !== '' && !m.distill)
    if (!conv.length) {
      showToast('这段对话还没有内容可沉淀')
      return
    }
    // 防重复：沉淀过的再点要二次确认
    if (session.distilled && !window.confirm('这段对话已经沉淀过，确定要再来一次吗？')) return

    setCurId(id)
    setHistoryOpen(false)
    // 沉淀汇报作为一条独立 assistant 消息（distill 标记：不进后续聊天上下文）
    update((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, messages: [...s.messages, newMessage('assistant', { content: '', thinking: '', tools: [], distill: true })] }
          : s,
      ),
    )

    setStreaming(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const a = loadAssistant()
      let tools
      try {
        tools = await listAnthropicTools()
      } catch (e) {
        throw new Error(e?.message || '工具加载失败，无法沉淀')
      }
      if (!tools || !tools.length) throw new Error('没有可用工具，无法沉淀')

      // 把对话整理成一段文字（最近 40 条），作为独立请求的单条 user 消息，规避角色交替问题
      const aName = assistant.name || 'Emet'
      const transcript = conv
        .slice(-40)
        .map((m) => `${m.role === 'user' ? '静怡' : aName}：${(m.content || '').trim()}`)
        .join('\n\n')
      const messages = [{ role: 'user', content: `下面是一段对话记录，请你回顾：\n\n${transcript}\n\n---\n\n${DISTILL_PROMPT}` }]

      await streamAssistant({ sid: id, system: DISTILL_SYSTEM, messages, tools, maxTokens: a.maxTokens, signal: ctrl.signal })
      // 打沉淀标记
      update((prev) => prev.map((s) => (s.id === id ? { ...s, distilled: true, updated_at: new Date().toISOString() } : s)))
      schedulePush(id) // 推送到云端
    } catch (e) {
      if (e.name === 'AbortError') showToast('已停止')
      else {
        showToast(e.message || '沉淀失败')
        replaceEmptyWithError(id, e.message || '沉淀失败')
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
                {m.distill && <span className="chat-distill-tag">对话沉淀</span>}
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
              {m.usage &&
                (() => {
                  const inTok = m.usage.input_tokens || 0
                  const read = m.usage.cache_read_input_tokens || 0
                  const write = m.usage.cache_creation_input_tokens || 0
                  const out = m.usage.output_tokens || 0
                  const totalIn = inTok + read + write // 总输入（含命中/写入的缓存部分）
                  if (!totalIn && !out) return null
                  const pct = totalIn ? Math.round((read / totalIn) * 100) : 0
                  // 命中优先显示命中率；首轮只有写入时显示写入量；都没有则只显示收发量
                  const cache = read > 0 ? ` · 缓存命中 ${pct}% (${read})` : write > 0 ? ` · 写入缓存 ${write}` : ''
                  return (
                    <div
                      style={{
                        marginTop: 5,
                        fontSize: 11,
                        lineHeight: 1.5,
                        letterSpacing: '0.03em',
                        color: '#b3aaa0',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      ↑{totalIn} ↓{out} tokens{cache}
                    </div>
                  )
                })()}
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
              {loadProviders().filter(isProviderReady).length === 0 ? (
                <p className="faint ts-empty">
                  没有可用供应商，去 <Link to="/settings" onClick={() => setModelOpen(false)}>设置页</Link> 添加。
                </p>
              ) : (
                loadProviders()
                  .filter(isProviderReady)
                  .map((p) => (
                    <div key={p.id} className="model-sheet__group">
                      <div className="model-sheet__prov faint">
                        {p.name}
                        <em className="prov-badge">
                          {p.protocol === 'openai' ? 'OpenAI 兼容' : p.protocol === 'claude-cli' ? '本机 Claude' : 'Anthropic'}
                        </em>
                      </div>
                      {p.models.map((m) => {
                        const active = target?.provider.id === p.id && target?.model === m
                        return (
                          <button
                            key={m}
                            // 打开面板时把选中项自动滚进可视区，避免被面板高度盖住看不到。
                            // 用 rAF 等布局稳定后再滚，否则 ref 回调时面板高度还没算好，滚动无效。
                            ref={active ? (el) => { if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'center' })) } : undefined}
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
            {visibleSessions.length === 0 ? (
              <p className="faint ts-empty">还没有对话</p>
            ) : (
              <div className="chat-history__list">
                {visibleSessions.map((s) => (
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
                      className={'chat-history__act' + (s.distilled ? ' is-done' : '')}
                      onClick={(e) => {
                        e.stopPropagation()
                        distill(s.id)
                      }}
                      aria-label="沉淀此对话"
                      title={s.distilled ? '已沉淀过，点击可再沉淀' : '沉淀此对话'}
                    >
                      <Sparkles size={14} />
                    </button>
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
