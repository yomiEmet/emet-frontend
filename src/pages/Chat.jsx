import { useState, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Send, Plus, Menu, Search, X, Square, ChevronDown, ChevronLeft, ChevronRight, Check, Wrench, Sparkles, Copy, RotateCcw, Star, Pencil } from 'lucide-react'
import { marked } from 'marked'
import { chatSystemPrompt, memInject } from '../api.js'
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

// 复制到剪贴板 + toast（气泡操作条用）
function copyText(t) {
  if (!t) return
  navigator.clipboard.writeText(t).then(
    () => showToast('已复制'),
    () => showToast('复制失败'),
  )
}

// ── 版本组（slot）：同一条消息位置的多个版本。编辑我的消息 / 重roll 都往对应 slot 追加一个
//    新版本，用 < i/n > 独立切换（各 slot 互不影响，不是树状分支）。──
// slot 缺省时（旧数据）每条消息自成一组，行为与从前完全一致。
const slotOf = (m) => m.slot || m.mid

// 把会话消息按 slot 分组，每组挑出当前激活的变体，按首次出现顺序排。
// 变体候选 = 有内容且非 error，或正在流式生成的那条；无 variantSel 记录时默认显示最新的一条。
// 整组只有失败/空占位时兜底显示最后一条并标 dead（渲染重试入口）。
function buildRows(session, streamingMid) {
  const messages = session?.messages || []
  const hidden = new Set(session?.hiddenMids || []) // 旧版重roll隐藏的消息，继续隐藏
  const sel = session?.variantSel || {}
  const order = []
  const groups = new Map()
  for (const m of messages) {
    if (hidden.has(m.mid)) continue
    const s = slotOf(m)
    if (!groups.has(s)) {
      groups.set(s, [])
      order.push(s)
    }
    groups.get(s).push(m)
  }
  const rows = []
  for (const s of order) {
    const all = groups.get(s)
    const variants = all.filter((m) => (m.content && !m.error) || m.mid === streamingMid)
    if (!variants.length) {
      rows.push({ slot: s, m: all[all.length - 1], idx: 0, count: 1, variantMids: [], dead: true })
      continue
    }
    const selMid = sel[s]
    let idx = selMid ? variants.findIndex((m) => m.mid === selMid) : -1
    if (idx < 0) idx = variants.length - 1 // 默认最新
    rows.push({ slot: s, m: variants[idx], idx, count: variants.length, variantMids: variants.map((v) => v.mid) })
  }
  return rows
}

// 版本切换器 < i/n >：只在同一位置有多个版本时出现
function VariantSwitcher({ idx, count, onPrev, onNext, align }) {
  if (count <= 1) return null
  return (
    <div className={'chatx-vsw' + (align === 'right' ? ' chatx-vsw--right' : '')}>
      <button onClick={onPrev} disabled={idx <= 0} aria-label="上一版本">
        <ChevronLeft size={14} />
      </button>
      <span>
        {idx + 1}/{count}
      </span>
      <button onClick={onNext} disabled={idx >= count - 1} aria-label="下一版本">
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

// 用户消息：点药丸展开 meta 行（时间/复制/编辑重发/收藏）+ 版本切换（编辑过就有多版本）
// 必须定义在 Chat 组件外，否则父组件每次渲染都重建组件、局部状态会丢
function UserMsg({ m, favOn, onFav, idx, count, onSwitch, onEdit }) {
  const [metaOpen, setMetaOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const startEdit = () => {
    setDraft(m.content || '')
    setEditing(true)
    setMetaOpen(false)
  }
  const save = () => {
    const t = draft.trim()
    if (!t) return
    setEditing(false)
    onEdit(t)
  }
  return (
    <div className="chat-msg chat-msg--user">
      <div className="chatx-usercol">
        {editing ? (
          <div className="chatx-useredit">
            <textarea
              autoFocus
              value={draft}
              rows={2}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  save()
                }
              }}
            />
            <div className="chatx-useredit__foot">
              <button className="mini-btn" onClick={() => setEditing(false)}>
                取消
              </button>
              <button className="mini-btn mini-btn--accent" disabled={!draft.trim()} onClick={save}>
                发送
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="chat-bubble chat-bubble--user chatx-userbtn"
            onClick={() => setMetaOpen((v) => !v)}
          >
            {m.content}
          </button>
        )}
        {!editing && (
          <VariantSwitcher idx={idx} count={count} align="right" onPrev={() => onSwitch(idx - 1)} onNext={() => onSwitch(idx + 1)} />
        )}
        {!editing && metaOpen && (
          <div className="chatx-meta">
            <span>{formatCardTime(m.ts)}</span>
            <button className="chatx-act" onClick={() => copyText(m.content)} title="复制" aria-label="复制">
              <Copy size={13} />
            </button>
            <button className="chatx-act" onClick={startEdit} title="编辑重发" aria-label="编辑重发">
              <Pencil size={13} />
            </button>
            {m.mid && (
              <button
                className={'chatx-act' + (favOn ? ' is-on' : '')}
                onClick={() => onFav(m.mid)}
                title={favOn ? '取消收藏' : '收藏'}
                aria-label="收藏"
              >
                <Star size={13} fill={favOn ? 'currentColor' : 'none'} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Chat() {
  const [sessions, setSessions] = useState(loadSessions)
  const [curId, setCurId] = useState(() => loadSessions().find((s) => !s.deleted)?.id || null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [sideOpen, setSideOpen] = useState(false) // 移动端侧栏抽屉；桌面常驻
  const [sideQuery, setSideQuery] = useState('')
  const [favOpen, setFavOpen] = useState(false) // 收藏面板
  const [selectMode, setSelectMode] = useState(false) // 长按进入的多选态
  const [selected, setSelected] = useState(() => new Set())
  const suppressClickRef = useRef(false) // 长按松手的尾随click不当成选择切换
  const [modelOpen, setModelOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistant, setAssistant] = useState(loadAssistant)
  const [target, setTarget] = useState(getActiveTarget)
  const [streamingMid, setStreamingMid] = useState(null) // 正在生成的占位 mid（渲染光标 + 组上下文）
  const bottomRef = useRef(null)
  const abortRef = useRef(null)

  const pickModel = (providerId, model) => {
    setActiveTarget(providerId, model)
    setTarget(getActiveTarget())
    setModelOpen(false)
  }

  const cur = sessions.find((s) => s.id === curId && !s.deleted) || null
  // rows：按 slot 分组后的激活变体序列（见 buildRows）。每行带 { m, slot, idx, count, variantMids }。
  // useMemo：引用只随 cur / streamingMid 变——否则每次输入敲字都新建数组、触发滚动 effect 拽到底。
  const rows = useMemo(() => buildRows(cur, streamingMid), [cur, streamingMid])
  const rowMsgs = rows.map((r) => r.m) // 当前可见的消息（收藏/多选用）
  const visibleSessions = sessions.filter((s) => !s.deleted) // 墓碑不进列表

  // 收藏：存会话级 favs = [{gid, mids, at}]（一次多选=一组），搭 /api/chat 同步顺风车。
  // 已知局限（拍板认可先上低成本版）：删除会话后其收藏一并消失。
  const favMids = new Set((cur?.favs || []).flatMap((g) => g.mids))
  const favItems = (() => {
    const out = []
    for (const s of sessions) {
      if (s.deleted) continue
      const byMid = new Map((s.messages || []).map((m) => [m.mid, m]))
      for (const g of s.favs || []) {
        const first = byMid.get(g.mids?.[0])
        out.push({
          gid: g.gid,
          sid: s.id,
          title: s.title || '未命名对话',
          at: g.at || '',
          count: g.mids?.length || 0,
          firstMid: g.mids?.[0],
          excerpt: (first?.content || '').replace(/\s+/g, ' ').slice(0, 80) || '（消息已不存在）',
        })
      }
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : -1))
  })()

  const toggleFav = (mid) => {
    if (!curId || !mid) return
    const had = favMids.has(mid)
    update((prev) =>
      prev.map((s) => {
        if (s.id !== curId) return s
        const favs = [...(s.favs || [])]
        const next = had
          ? favs.map((g) => ({ ...g, mids: g.mids.filter((x) => x !== mid) })).filter((g) => g.mids.length)
          : [...favs, { gid: 'f' + Date.now(), mids: [mid], at: new Date().toISOString() }]
        // favRev：收藏字段自己的版本号，合并按它取高者（防陈旧设备整体覆盖，见 mergeSession）
        return { ...s, favs: next, favRev: (s.favRev || 0) + 1, updated_at: new Date().toISOString() }
      }),
    )
    schedulePush(curId)
    showToast(had ? '已取消收藏' : '已收藏')
  }

  const removeFavGroup = (sid, gid) => {
    update((prev) =>
      prev.map((s) =>
        s.id === sid
          ? {
              ...s,
              favs: (s.favs || []).filter((g) => g.gid !== gid),
              favRev: (s.favRev || 0) + 1,
              updated_at: new Date().toISOString(),
            }
          : s,
      ),
    )
    schedulePush(sid)
  }

  const jumpToFav = (sid, mid) => {
    setFavOpen(false)
    setSideOpen(false)
    setCurId(sid)
    setTimeout(() => {
      document.querySelector(`[data-mid="${mid}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 150)
  }

  // ── 多选 ──
  // 长按定时器挂 ref：流式期间每个增量都重渲染，闭包版定时器会变孤儿
  //（touchstart 设的 t 被新一轮 handler 丢掉、touchmove 清不到，滑一下就误入多选）
  const lpTimerRef = useRef(null)
  const lpClear = () => clearTimeout(lpTimerRef.current)
  const lpHandlers = (mid) => ({
    onTouchStart: () => {
      lpClear()
      lpTimerRef.current = setTimeout(() => enterSelect(mid), 480)
    },
    onTouchEnd: lpClear,
    onTouchMove: lpClear,
    onMouseDown: () => {
      lpClear()
      lpTimerRef.current = setTimeout(() => enterSelect(mid), 480)
    },
    onMouseUp: lpClear,
    onMouseLeave: lpClear,
  })
  const enterSelect = (mid) => {
    // 流式中不进多选：底部操作条会顶掉停止按钮
    if (!mid || selectMode || streaming) return
    // 吃掉长按松手的尾随 click；触屏可能根本不产生这个 click，600ms 后自动清除
    suppressClickRef.current = true
    setTimeout(() => {
      suppressClickRef.current = false
    }, 600)
    setSelectMode(true)
    setSelected(new Set([mid]))
  }
  const exitSelect = () => {
    setSelectMode(false)
    setSelected(new Set())
  }
  const toggleSelect = (mid) => {
    if (!mid) return
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(mid)) n.delete(mid)
      else n.add(mid)
      return n
    })
  }
  const onRowClickCapture = (mid) => (e) => {
    e.stopPropagation()
    e.preventDefault()
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    toggleSelect(mid)
  }
  const favSelected = () => {
    if (!curId || !selected.size) return
    const mids = rowMsgs.filter((m) => selected.has(m.mid)).map((m) => m.mid) // 按消息顺序存
    if (!mids.length) {
      // 选中项已不在当前会话（比如中途切了会话），别写空收藏组
      exitSelect()
      return
    }
    update((prev) =>
      prev.map((s) =>
        s.id === curId
          ? {
              ...s,
              favs: [...(s.favs || []), { gid: 'f' + Date.now(), mids, at: new Date().toISOString() }],
              favRev: (s.favRev || 0) + 1,
              updated_at: new Date().toISOString(),
            }
          : s,
      ),
    )
    schedulePush(curId)
    showToast(`已收藏 ${mids.length} 条`)
    exitSelect()
  }
  const copySelected = () => {
    const aName = assistant.name || 'Emet'
    const parts = rowMsgs
      .filter((m) => selected.has(m.mid))
      .map((m) => `${m.role === 'user' ? '静怡' : aName}：${m.content || ''}`)
    copyText(parts.join('\n\n'))
    exitSelect()
  }

  // 滚到底：只在新消息追加、流式开关、流式增量时触发——不随版本切换滚动
  const msgCount = cur?.messages?.length || 0
  const streamLen = streaming ? rows[rows.length - 1]?.m?.content?.length || 0 : 0
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [msgCount, streaming, streamLen])

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
    setSideOpen(false)
    exitSelect()
  }

  // 侧栏会话列表：标题过滤（简单包含匹配就够）
  const sideList = sideQuery.trim()
    ? visibleSessions.filter((s) => (s.title || '').toLowerCase().includes(sideQuery.trim().toLowerCase()))
    : visibleSessions

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
          // error 标记：这条不进后续 API 上下文（否则「（请求失败）」会被当成
          // Emet 的正式发言反复发回给模型，长期污染对话）
          msgs[msgs.length - 1] = { ...last, role: 'assistant', content: '（' + msg + '）', error: true }
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
      // 只压缩当前激活的变体序列（切走的旧版本不进摘要）
      const full = buildRows(s, null).map((r) => r.m).filter((m) => m.content && !m.distill && !m.error)
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

  // 组装请求并跑一轮流式。genMid = 要生成的那条 assistant 占位 mid。
  // 前置约定：调用方已把占位（和必要的用户变体）写进会话。
  // 上下文 = genMid 之前的激活变体序列（切走的旧版本、genMid 之后的 slot 都不进）。
  const runTurn = async (sid, genMid) => {
    setStreaming(true)
    setStreamingMid(genMid)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const a = loadAssistant()
      const system = await chatSystemPrompt()
      // API 的 messages：激活变体序列里 genMid 之前的部分，去掉空/沉淀/error，再按上下文条数截断
      //（只截断发送，界面与存储里的历史消息不动）
      const sess = loadSessions().find((s) => s.id === sid)
      const seq = buildRows(sess, genMid).map((r) => r.m)
      const genIdx = seq.findIndex((m) => m.mid === genMid)
      const before = genIdx >= 0 ? seq.slice(0, genIdx) : seq
      const full = before
        .filter((m) => m.content && !m.distill && !m.error)
        .map((m) => ({ role: m.role, content: m.content }))
      // 锚定窗口（算法见顶部 anchorStart）；窗口外的旧对话由滚动摘要兜着（见 maybeCompress）
      const history = full.slice(anchorStart(full, a.contextCount))

      // 本会话的滚动摘要垫进 system（第 4 个缓存断点；无摘要则不占）
      if (sess?.summary) system.summary = sess.summary

      // Paramecium 目录注入：按当前话题检索记忆标题目录（用户道=最近3条user消息，
      // echo道=上条回复的余味）。5s 超时降级为不注入，绝不拦聊天。
      // 注入结果并进 volatile → 落在末条消息里、全部缓存断点之后（唯一缓存安全位）。
      const injPromise = memInject(
        full.filter((m) => m.role === 'user').slice(-3).map((m) => m.content).join('\n'),
        [...full].reverse().find((m) => m.role === 'assistant')?.content?.slice(0, 500) || '',
      ).catch(() => null)

      // 工具仅 Anthropic 原生协议启用（拍板①A）；拉取失败则降级为无工具纯聊天
      let tools = null
      if (target?.provider?.protocol !== 'openai') {
        try {
          tools = await listAnthropicTools()
        } catch {
          tools = null
        }
      }

      const inj = await injPromise
      if (inj?.injection) system.volatile = (system.volatile ? system.volatile + '\n' : '') + inj.injection

      await streamAssistant({ sid, system, messages: history, tools, temperature: a.temperature, maxTokens: a.maxTokens, signal: ctrl.signal })
      schedulePush(sid) // 防抖推送到云端
      maybeCompress(sid) // 不 await：锚点前移时异步更新滚动摘要
    } catch (e) {
      if (e.name === 'AbortError') {
        showToast('已停止')
        // 首 token 前就停 → 空占位标 error，从变体里剔除、slot 自动回退到旧版本
        update((prev) =>
          prev.map((s) =>
            s.id === sid
              ? { ...s, messages: s.messages.map((m) => (m.mid === genMid && !m.content ? { ...m, error: true } : m)) }
              : s,
          ),
        )
      } else {
        const msg = e.message === 'NO_PROVIDER' ? '请先在设置页添加供应商' : e.message || '请求失败'
        showToast(msg)
        replaceEmptyWithError(sid, msg)
      }
    } finally {
      setStreaming(false)
      setStreamingMid(null)
      abortRef.current = null
    }
  }

  // 往某个 slot 追加一个新 assistant 变体并生成（重roll / 编辑重发共用）。
  // 不设 variantSel：默认显示最新变体，旧版本留着可 < i/n > 切回。失败的空占位会自动从变体里剔除。
  const startTurnInSlot = async (sid, targetSlot) => {
    const ph = newMessage('assistant', { content: '', thinking: '', tools: [] })
    ph.slot = targetSlot || ph.mid // 无目标 slot（编辑的是末条用户消息）→ 自成新 slot
    update((prev) =>
      prev.map((s) => (s.id === sid ? { ...s, updated_at: new Date().toISOString(), messages: [...s.messages, ph] } : s)),
    )
    await runTurn(sid, ph.mid)
  }

  // 重roll：往同一 assistant slot 追加一个新版本（旧的保留为可切换变体）
  const regen = (slot) => {
    if (streaming || !slot || !curId) return
    if (!target) {
      showToast('请先在设置页添加供应商')
      return
    }
    startTurnInSlot(curId, slot)
  }

  // 编辑我的消息重发：往用户 slot 追加新变体 c，再往「紧随其后的 assistant slot」生成新版本。
  // 切回旧的用户消息不影响 assistant 版本（各 slot 独立，不是树状分支）——按静怡的规格。
  const editUser = async (userSlot, newText) => {
    if (streaming || !curId) return
    if (!target) {
      showToast('请先在设置页添加供应商')
      return
    }
    const sid = curId
    const uv = newMessage('user', { content: newText })
    uv.slot = userSlot
    update((prev) =>
      prev.map((s) => (s.id === sid ? { ...s, updated_at: new Date().toISOString(), messages: [...s.messages, uv] } : s)),
    )
    // 追加用户变体后重算行序，找紧随其后的 assistant slot（没有则新建一个 slot）
    const sess = loadSessions().find((s) => s.id === sid)
    const rws = buildRows(sess, null)
    const uIdx = rws.findIndex((r) => r.slot === userSlot)
    const nextAsst = uIdx >= 0 ? rws.slice(uIdx + 1).find((r) => r.m.role === 'assistant' && !r.m.distill) : null
    await startTurnInSlot(sid, nextAsst ? nextAsst.slot : null)
  }

  // 切换某 slot 显示的版本（同步为偏好，走 variantRev 合并保护）
  const switchVariant = (slot, targetIdx, variantMids) => {
    const mid = variantMids[targetIdx]
    if (!mid || !curId) return
    update((prev) =>
      prev.map((s) =>
        s.id === curId
          ? {
              ...s,
              variantSel: { ...(s.variantSel || {}), [slot]: mid },
              variantRev: (s.variantRev || 0) + 1,
              updated_at: new Date().toISOString(),
            }
          : s,
      ),
    )
    schedulePush(curId)
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
    // 追加用户消息 + 空的 assistant 占位，各自成一个新 slot
    const uMsg = newMessage('user', { content: text })
    uMsg.slot = uMsg.mid
    const ph = newMessage('assistant', { content: '', thinking: '', tools: [] })
    ph.slot = ph.mid
    update((prev) =>
      prev.map((s) =>
        s.id === sid ? { ...s, updated_at: new Date().toISOString(), messages: [...s.messages, uMsg, ph] } : s,
      ),
    )

    await runTurn(sid, ph.mid)
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
    const hid = new Set(session.hiddenMids || [])
    const conv = session.messages.filter((m) => m.content !== '' && !m.distill && !m.error && !hid.has(m.mid))
    if (!conv.length) {
      showToast('这段对话还没有内容可沉淀')
      return
    }
    // 防重复：沉淀过的再点要二次确认
    if (session.distilled && !window.confirm('这段对话已经沉淀过，确定要再来一次吗？')) return

    setCurId(id)
    setSideOpen(false)
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
    <div className="chatx-root">
      {/* 移动端侧栏遮罩 */}
      {sideOpen && <div className="chatx-mask" onClick={() => setSideOpen(false)} />}

      {/* 侧边栏：会话列表（档案室骨架——桌面常驻 300px，移动端抽屉）*/}
      <aside className={'chatx-side' + (sideOpen ? ' open' : '')}>
        <div className="chatx-side__head">
          <span className="chatx-brand">对话</span>
          <button className="chatx-icon" onClick={newSession} title="新对话" aria-label="新对话">
            <Plus size={17} />
          </button>
        </div>
        <div className="chatx-side__search">
          <Search size={14} />
          <input
            placeholder="搜索对话"
            value={sideQuery}
            onChange={(e) => setSideQuery(e.target.value)}
          />
        </div>
        <button className="chatx-side__fav" onClick={() => setFavOpen(true)}>
          <Star size={14} />
          <span>收藏</span>
          {favItems.length > 0 && <em className="chatx-side__favcount">{favItems.length}</em>}
        </button>
        <div className="chatx-side__list">
          {sideList.length === 0 ? (
            <p className="faint chatx-side__empty">{sideQuery ? '没有匹配的对话' : '还没有对话'}</p>
          ) : (
            sideList.map((s) => (
              <div
                key={s.id}
                className={'chatx-conv' + (s.id === curId ? ' is-active' : '')}
                onClick={() => {
                  setCurId(s.id)
                  setSideOpen(false)
                  exitSelect()
                }}
              >
                <div className="chatx-conv__title">{s.title || '未命名对话'}</div>
                <div className="chatx-conv__meta">
                  <span>
                    {formatCardTime(s.updated_at || s.created_at)} ·{' '}
                    {Math.max(0, (s.messages || []).length - (s.hiddenMids || []).length)} 条
                  </span>
                  <span className="chatx-conv__acts">
                    <button
                      className={s.distilled ? 'is-done' : ''}
                      onClick={(e) => {
                        e.stopPropagation()
                        distill(s.id)
                      }}
                      aria-label="沉淀此对话"
                      title={s.distilled ? '已沉淀过，点击可再沉淀' : '沉淀此对话'}
                    >
                      <Sparkles size={13} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteSession(s.id)
                      }}
                      aria-label="删除"
                      title="删除"
                    >
                      <X size={13} />
                    </button>
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      <main className="chatx-main">
        {/* 细顶栏：移动端汉堡 + 助手/模型入口 */}
        <header className="chatx-top">
          <button className="chatx-icon chatx-menu" onClick={() => setSideOpen(true)} aria-label="会话列表">
            <Menu size={18} />
          </button>
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
          <span className="chatx-top__spacer" />
          <button className="chatx-icon chatx-menu" onClick={newSession} aria-label="新对话">
            <Plus size={18} />
          </button>
        </header>

        {/* 消息区 */}
        <div className="chat-scroll chatx-scroll">
          <div className="chatx-thread">
        {!target && (
          <div className="card chat-hint">
            还没有可用的供应商。去 <Link to="/settings">设置页</Link> 添加一个就能开聊。
          </div>
        )}
        {rows.length === 0 && target && (
          <p className="faint chat-empty">说点什么吧。</p>
        )}
        {rows.map((row, i) => {
          const m = row.m
          const isStreamingRow = m.mid === streamingMid
          return (
          <div
            key={row.slot || i}
            className={
              'chatx-mrow' +
              (selectMode ? ' is-selecting' : '') +
              (selectMode && selected.has(m.mid) ? ' is-selected' : '')
            }
            data-mid={m.mid}
            onClickCapture={selectMode ? onRowClickCapture(m.mid) : undefined}
            {...(!selectMode && m.mid ? lpHandlers(m.mid) : {})}
          >
          {m.role === 'user' ? (
            <UserMsg
              m={m}
              favOn={favMids.has(m.mid)}
              onFav={toggleFav}
              idx={row.idx}
              count={row.count}
              onSwitch={(ti) => switchVariant(row.slot, ti, row.variantMids)}
              onEdit={(text) => editUser(row.slot, text)}
            />
          ) : (
            <div className="chat-msg chat-msg--emet">
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
                    (streaming && isStreamingRow ? '<span class="chat-cursor">▍</span>' : ''),
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
              {/* 失败/空占位兜底：只显示重试入口（往同一 slot 再生成一次）*/}
              {row.dead && !(streaming && isStreamingRow) && !m.distill && (
                <div className="chatx-actions">
                  <button className="chatx-act" onClick={() => regen(row.slot)} title="重试" aria-label="重试">
                    <RotateCcw size={15} />
                  </button>
                </div>
              )}
              {/* 操作条：复制 + 收藏 + 重roll + 版本切换（流式中的当前生成条整条不给）*/}
              {!row.dead && m.content && !m.distill && !(streaming && isStreamingRow) && (
                <div className="chatx-actions">
                  <button className="chatx-act" onClick={() => copyText(m.content)} title="复制" aria-label="复制">
                    <Copy size={15} />
                  </button>
                  {m.mid && (
                    <button
                      className={'chatx-act' + (favMids.has(m.mid) ? ' is-on' : '')}
                      onClick={() => toggleFav(m.mid)}
                      title={favMids.has(m.mid) ? '取消收藏' : '收藏'}
                      aria-label="收藏"
                    >
                      <Star size={15} fill={favMids.has(m.mid) ? 'currentColor' : 'none'} />
                    </button>
                  )}
                  <button className="chatx-act" onClick={() => regen(row.slot)} title="重新生成" aria-label="重新生成">
                    <RotateCcw size={15} />
                  </button>
                  <VariantSwitcher
                    idx={row.idx}
                    count={row.count}
                    onPrev={() => switchVariant(row.slot, row.idx - 1, row.variantMids)}
                    onNext={() => switchVariant(row.slot, row.idx + 1, row.variantMids)}
                  />
                </div>
              )}
            </div>
          )}
          </div>
          )
        })}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* 输入区（多选态换成操作条）*/}
        <div className="chatx-inputwrap">
          {selectMode ? (
            <div className="chatx-selbar">
              <span className="faint">已选 {selected.size} 条</span>
              <span className="chatx-top__spacer" />
              <button className="mini-btn" disabled={!selected.size} onClick={copySelected}>
                复制
              </button>
              <button className="mini-btn mini-btn--accent" disabled={!selected.size} onClick={favSelected}>
                收藏
              </button>
              <button className="mini-btn" onClick={exitSelect}>
                取消
              </button>
            </div>
          ) : (
            <div className="chat-input chatx-input">
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
          )}
        </div>
      </main>

      {/* 收藏面板 */}
      {favOpen && (
        <>
          <div className="ts-scrim" onClick={() => setFavOpen(false)} />
          <div className="ts-panel card chatx-favpanel">
            <div className="ts-head">
              <span className="ts-title">收藏</span>
              <button className="ts-close" onClick={() => setFavOpen(false)} aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="chatx-favlist">
              {favItems.length === 0 ? (
                <p className="faint ts-empty">还没有收藏。点消息下的 ☆，或长按消息多选收藏。</p>
              ) : (
                favItems.map((f) => (
                  <div key={f.gid} className="chatx-favitem" onClick={() => jumpToFav(f.sid, f.firstMid)}>
                    <div className="chatx-favitem__ex">{f.excerpt}</div>
                    <div className="chatx-favitem__meta">
                      <span>
                        {f.title} · {formatCardTime(f.at)}
                        {f.count > 1 ? ` · ${f.count} 条` : ''}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeFavGroup(f.sid, f.gid)
                        }}
                        aria-label="取消收藏"
                        title="取消收藏"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

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
