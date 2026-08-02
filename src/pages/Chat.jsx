import { useState, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Send, Plus, Menu, Search, X, Square, ChevronDown, ChevronLeft, ChevronRight, Check, Wrench, Sparkles, Copy, RotateCcw, Star, Pencil, ImagePlus } from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { chatSystemPrompt, memInject, chatImageUpload } from '../api.js'
import { BASE_URL, getAdminKey } from '../api/client.js'
import AuthImg from '../components/AuthImg.jsx'
import { compressImage } from '../utils/image.js'
import { streamChat } from '../utils/anthropic.js'
import { listAnthropicTools, callTool } from '../utils/mcp.js'
import { loadProviders, getActiveTarget, setActiveTarget, isProviderReady } from '../utils/providers.js'
import { loadAssistant, saveAssistant } from '../utils/assistant.js'
import AssistantSettings, { AssistantAvatar } from '../components/AssistantSettings.jsx'
import { showToast } from '../utils/toast.js'
import { formatCardTime, toCST } from '../utils/time.js'
// 会话存储集中在 utils/sessions.js（设置页导出/导入共用同一来源）
import { loadSessions, saveSessions as persistSessions, newMessage } from '../utils/sessions.js'
import { pull, schedulePush, deleteRemote } from '../utils/sync.js'

marked.setOptions({ breaks: true, gfm: true })

// 消毒防线：marked v18 会原样透传 markdown 里的裸 HTML（<img onerror>、javascript: 链接等）。
// Emet 的回复虽是"自己人"，但她挂着能读外部内容的工具——被读到的内容若含注入，
// 可能诱导她在回复里"回声"出恶意 HTML，进而偷走浏览器里的访问密钥。
// 所有模型输出渲染前统一过 DOMPurify；流式光标 span 是我们自己的静态字符串，在消毒后追加。
const renderSafeMarkdown = (text) => DOMPurify.sanitize(marked.parse(text || ''))

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

// ── 聊天图片：当轮 base64 内存缓存（id → {data, media_type}）──
// 消息体只存 id 引用（会话 KV 不装 base64）；发送瞬间刚压缩过必有缓存，
// 重roll/编辑重发时没有就从 worker 拉回来转一次。历史轮不重发图（只发当轮）。
const _chatImgData = new Map()
async function resolveChatImages(ids) {
  const out = []
  for (const id of ids || []) {
    if (_chatImgData.has(id)) {
      out.push(_chatImgData.get(id))
      continue
    }
    try {
      // 带 X-Admin-Key 头取图（密钥不进 URL）；与 AuthImg 同源同缓存策略
      const r = await fetch(`${BASE_URL}/api/chat-image/${encodeURIComponent(id)}`, {
        headers: getAdminKey() ? { 'X-Admin-Key': getAdminKey() } : {},
      })
      if (!r.ok) continue
      const blob = await r.blob()
      const b64 = await new Promise((res, rej) => {
        const fr = new FileReader()
        fr.onload = () => res(String(fr.result).split(',')[1])
        fr.onerror = () => rej(new Error('图片读取失败'))
        fr.readAsDataURL(blob)
      })
      const rec = { data: b64, media_type: blob.type || 'image/jpeg' }
      _chatImgData.set(id, rec)
      out.push(rec)
    } catch {
      /* 单张拉不回就少一张，不拦聊天 */
    }
  }
  return out
}

// 分气泡模式：按空行把回复拆成段（一段一个气泡，Telegram 式）。
// ``` 代码块内的空行不算分段，代码块整块留在同一个气泡里。
function splitBubbles(text) {
  if (!text) return []
  const parts = []
  let buf = []
  let inCode = false
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) inCode = !inCode
    if (!inCode && line.trim() === '') {
      if (buf.length) {
        parts.push(buf.join('\n'))
        buf = []
      }
    } else {
      buf.push(line)
    }
  }
  if (buf.length) parts.push(buf.join('\n'))
  return parts
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

// ── 跨窗口衔接（carry）：开新窗口时把上一个活跃窗口的滚动摘要+结尾原文快照进新会话，
//    注入 system（见 runTurn / anthropic.js）→ 换窗口像没换过一样，窗口只是时间上的切分。
//    快照存会话 carry 字段：创建时定格、之后不变（缓存前缀稳定），随会话云同步。──
const CARRY_TAIL_MSGS = 8 // 结尾原文最多带几条
const CARRY_TAIL_CHARS = 400 // 每条截断
const CARRY_TAIL_TOTAL = 2400 // 结尾原文总字数封顶（超了从最早的行开始丢）

// 会话的激活内容序列：与滚动摘要 summaryUpTo 的下标语义共用一套
//（maybeCompress / prepareCarry / buildCarry 三处必须用同一个构造，否则摘要覆盖范围会错位）
function contentSeq(s) {
  return buildRows(s, null).map((r) => r.m).filter((m) => m.content && !m.distill && !m.error)
}

// 上一个活跃窗口：非删除、有真实内容、时间最新的会话
function latestRealSession(sessions, excludeId) {
  let best = null
  let bestT = -1
  for (const s of sessions) {
    if (!s || s.deleted || s.id === excludeId) continue
    if (!contentSeq(s).length) continue
    const t = new Date(s.updated_at || s.created_at || 0).getTime() || 0
    if (t > bestT) {
      bestT = t
      best = s
    }
  }
  return best
}

// "2026年7月26日 03:12"（东八区）——衔接头里的绝对时间，配合 volatile 里的当前时间，
// 模型自己就能拿捏"刚才/昨天/上周"
function carryTimeZh(iso) {
  if (!iso) return '时间不详'
  const d = toCST(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 即时版衔接快照（不调模型，永远可用）：上一窗口的滚动摘要（如有）+ 结尾原文。
// prev 没有真实内容时返回 null。
function buildCarry(prev, aName) {
  const seq = contentSeq(prev)
  if (!seq.length) return null
  const tail = seq.slice(-CARRY_TAIL_MSGS)
  const lines = tail.map((m) => {
    let t = (m.content || '').trim().replace(/\s+/g, ' ')
    if (t.length > CARRY_TAIL_CHARS) t = t.slice(0, CARRY_TAIL_CHARS) + '…'
    return `${m.role === 'user' ? '静怡' : aName}：${t}`
  })
  while (lines.length > 1 && lines.join('\n').length > CARRY_TAIL_TOTAL) lines.shift()
  const endedAt = tail[tail.length - 1]?.ts || prev.updated_at || ''
  const title = (prev.title || '未命名对话').trim()
  const text = [
    '【上一段对话的衔接】',
    `你和静怡的对话按窗口切分，这是上一个窗口「${title}」的收尾，最后一条消息在 ${carryTimeZh(endedAt)}。` +
      '对照当前时间拿捏分寸：隔得近就自然接着聊，隔得久就当作上次聊过的事，不必刻意复述。',
    ...(prev.summary ? ['', '较早部分的摘要：', prev.summary] : []),
    '',
    '结尾原文：',
    ...lines,
  ].join('\n')
  return { from: prev.id, title, endedAt, text }
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
  const [viewImg, setViewImg] = useState(null) // 点缩略图看大图；null = 关闭
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
        {!editing && m.images?.length > 0 && (
          <div className="chatx-msgimgs">
            {m.images.map((id) => (
              <AuthImg key={id} kind="chat" id={id} onClick={() => setViewImg({ kind: 'chat', id })} />
            ))}
          </div>
        )}
        {viewImg && (
          <div className="img-lightbox" onClick={() => setViewImg(null)}>
            <AuthImg kind={viewImg.kind} id={viewImg.id} />
          </div>
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

// 思考链折叠块：思考进行时自动展开+呼吸标题，正文一出现自动收起；用户可手动开合（手动后不再自动跟随）。
function ThinkFold({ text, active }) {
  const [open, setOpen] = useState(active)
  const touched = useRef(false)
  useEffect(() => {
    if (!touched.current) setOpen(active)
  }, [active])
  const toggle = () => {
    touched.current = true
    setOpen((o) => !o)
  }
  return (
    <div className={'chat-think' + (active ? ' is-active' : '') + (open ? ' is-open' : '')}>
      <button type="button" className="chat-think__summary" onClick={toggle}>
        <span className="chat-think__caret" aria-hidden>▸</span>
        <span className="chat-think__label">{active ? '正在思考' : '思考过程'}</span>
        {active && <span className="chat-think__dots" aria-hidden><i /><i /><i /></span>}
      </button>
      {open && <div className="chat-think__body">{text}</div>}
    </div>
  )
}

export default function Chat() {
  const [sessions, setSessions] = useState(loadSessions)
  const [curId, setCurId] = useState(() => loadSessions().find((s) => !s.deleted)?.id || null)
  const [input, setInput] = useState('')
  const [chatImgs, setChatImgs] = useState([]) // 待发送图片 [{data, media_type, preview}]，最多 3 张
  const chatFileRef = useRef(null)
  const [streaming, setStreaming] = useState(false)
  const [sideOpen, setSideOpen] = useState(false) // 移动端侧栏抽屉；桌面常驻
  const [sideQuery, setSideQuery] = useState('')
  const [favOpen, setFavOpen] = useState(false) // 收藏面板
  const [observeMid, setObserveMid] = useState(null) // 观察模式下点开思考的消息 mid
  const [modelOpen, setModelOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistant, setAssistant] = useState(loadAssistant)
  const [target, setTarget] = useState(getActiveTarget)
  const [streamingMid, setStreamingMid] = useState(null) // 正在生成的占位 mid（渲染光标 + 组上下文）
  const bottomRef = useRef(null)
  const abortRef = useRef(null)
  const pendingCarryRef = useRef(null) // { prevId, promise }：点「新对话」时的跨窗口衔接预热

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

  // ── 分气泡模式（Telegram式，assistant.bubbleMode 持久开关）──
  // 观察态 observing 是气泡模式内的临时视图状态（双击空白切换，不持久化、无横幅）：
  // 有思考的气泡外围一圈淡色光圈，点击气泡弹出思考。原版排版下思考折叠条外显，不需要观察态。
  const bubbleMode = !!assistant.bubbleMode
  const [observing, setObserving] = useState(false)
  const onThreadDblClick = (e) => {
    if (!bubbleMode) return
    if (e.target.closest('.chatx-mrow') || e.target.closest('a') || e.target.closest('button')) return
    setObserving((v) => {
      if (v) setObserveMid(null)
      return !v
    })
  }
  // 在设置里关掉分气泡模式时，顺带退出观察态
  useEffect(() => {
    if (!bubbleMode) {
      setObserving(false)
      setObserveMid(null)
    }
  }, [bubbleMode])

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
    // 跨窗口衔接预热：点「新对话」这一刻就锁定上一个活跃窗口、开始准备衔接内容
    //（可能含一次摘要补全），等首条消息真正发出时多半已就绪，不拖第一句话的响应
    const prev = latestRealSession(loadSessions())
    pendingCarryRef.current = prev ? { prevId: prev.id, promise: prepareCarry(prev.id) } : null
    setCurId(null)
    setSideOpen(false)
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
      // 只压缩当前激活的变体序列（切走的旧版本不进摘要）；构造必须与 carry 侧共用 contentSeq
      const full = contentSeq(s)
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

  // 衔接预热（跨窗口记忆）：若上一窗口有大段内容未被滚动摘要覆盖（短/中会话从没触发过
  // maybeCompress），补跑一次摘要合并并写回上一会话——summaryUpTo 只前进，多设备合并
  // 天然兼容（mergeSession 成对取进度更远的一方）。失败/无供应商静默降级为即时版快照。
  const prepareCarry = async (prevId) => {
    const load = () => loadSessions().find((x) => x.id === prevId)
    const aName = loadAssistant().name || 'Emet'
    const prev = load()
    if (!prev) return null
    try {
      const seq = contentSeq(prev)
      const head = Math.max(0, seq.length - CARRY_TAIL_MSGS) // 结尾原文之外的部分才需要摘要盖住
      const upTo = prev.summaryUpTo || 0
      if (head - upTo >= 5) {
        const lines = seq
          .slice(upTo, head)
          .map((m) => `${m.role === 'user' ? '静怡' : aName}：${(m.content || '').trim()}`)
          .join('\n')
        const prompt = (prev.summary ? `【旧摘要】\n${prev.summary}\n\n` : '') + `【新滑出窗口的对话】\n${lines}`
        const text = (await streamChat({ system: SUMMARY_SYSTEM, messages: [{ role: 'user', content: prompt }], maxTokens: 1000 })).trim()
        if (text) {
          update((all) =>
            all.map((x) =>
              x.id === prevId
                ? { ...x, summary: text.slice(0, 1200), summaryUpTo: head, updated_at: new Date().toISOString() }
                : x,
            ),
          )
          schedulePush(prevId)
        }
      }
    } catch {
      /* 摘要补全失败 → 用现有摘要+结尾原文兜底 */
    }
    return buildCarry(load() || prev, aName)
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
        .map((m) => ({ role: m.role, content: m.content, ...(m.images?.length ? { images: m.images } : {}) }))
      // 锚定窗口（算法见顶部 anchorStart）；窗口外的旧对话由滚动摘要兜着（见 maybeCompress）
      const history = full.slice(anchorStart(full, a.contextCount))

      // 当轮图片：末条 user 消息带存图引用 → 解析回 base64 挂 _imgs（发送瞬间在内存缓存里，
      // 重roll 时从 worker 拉回）。只有末条真发图；历史轮图不重发，通道层只见 images 标记。
      const lastH = history[history.length - 1]
      if (lastH?.role === 'user' && lastH.images?.length) {
        const imgs = await resolveChatImages(lastH.images)
        if (imgs.length) lastH._imgs = imgs
      }

      // 本会话的滚动摘要垫进 system（第 4 个缓存断点；无摘要则不占）
      if (sess?.summary) system.summary = sess.summary
      // 跨窗口衔接快照（会话内静态）：垫在 semi 与 summary 之间、不占断点（见 anthropic.js）
      if (sess?.carry?.text) system.carry = sess.carry.text

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

  // 选图即压缩（最长边1280/JPEG0.82），出缩略预览；重复选同一张允许
  const pickChatImages = async (e) => {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    if (!files.length) return
    const room = 3 - chatImgs.length
    if (room <= 0) {
      showToast('最多 3 张图')
      return
    }
    try {
      const picked = []
      for (const f of files.slice(0, room)) picked.push(await compressImage(f))
      setChatImgs((prev) => [...prev, ...picked])
    } catch (err) {
      showToast(err?.message || '图片处理失败')
    }
  }

  const send = async () => {
    const text = input.trim()
    if ((!text && chatImgs.length === 0) || streaming) return
    if (!target) {
      showToast('请先在设置页添加供应商')
      return
    }

    // 带图先上传拿 id：失败就中断发送（图和文字都留在输入区，不丢内容）
    let imgIds = null
    if (chatImgs.length) {
      try {
        const r = await chatImageUpload(chatImgs.map(({ data, media_type }) => ({ data, media_type })))
        imgIds = Array.isArray(r?.ids) && r.ids.length ? r.ids : null
        if (!imgIds) throw new Error('图片没有存上，请再试一次')
        // 发送瞬间的 base64 进内存缓存，本轮请求直接用、不用再拉回来
        imgIds.forEach((id, i) => _chatImgData.set(id, { data: chatImgs[i].data, media_type: chatImgs[i].media_type }))
      } catch (e) {
        showToast(e?.message || '图片上传失败')
        return
      }
    }

    // 没有当前会话就建一个，标题取首条消息前 14 字
    let sid = curId
    const isNew = !sid
    if (!sid) {
      sid = 'c' + Date.now()
      const session = {
        id: sid,
        title: (text || '发来了图片').replace(/\s+/g, ' ').slice(0, 14),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        messages: [],
      }
      update((prev) => [session, ...prev])
      setCurId(sid)
    }

    setInput('')
    setChatImgs([])
    // 追加用户消息 + 空的 assistant 占位，各自成一个新 slot
    // 纯图无文字时 content 用 [图片] 占位：上下文过滤/合并都以 content 非空为前提，别给空串
    const uMsg = newMessage('user', { content: text || '[图片]', ...(imgIds ? { images: imgIds } : {}) })
    uMsg.slot = uMsg.mid
    const ph = newMessage('assistant', { content: '', thinking: '', tools: [] })
    ph.slot = ph.mid
    update((prev) =>
      prev.map((s) =>
        s.id === sid ? { ...s, updated_at: new Date().toISOString(), messages: [...s.messages, uMsg, ph] } : s,
      ),
    )

    // 跨窗口衔接：新窗口把上一个活跃窗口的摘要+结尾快照进本会话（记忆跨窗口连续，
    // 窗口只是时间上的切分）。预热没就绪最多等 4 秒；超时/没预热用即时版；没有上一窗口跳过。
    // 放在消息回显之后：她的话即时上屏，只有 Emet 开口最多晚这几秒。
    if (isNew) {
      const prevSess = latestRealSession(loadSessions(), sid)
      if (prevSess) {
        const pending = pendingCarryRef.current
        let carry = null
        if (pending?.prevId === prevSess.id) {
          carry = await Promise.race([pending.promise, new Promise((r) => setTimeout(r, 4000))])
        }
        if (!carry) carry = buildCarry(prevSess, loadAssistant().name || 'Emet')
        if (carry) update((all) => all.map((s) => (s.id === sid ? { ...s, carry } : s)))
      }
      pendingCarryRef.current = null
    }

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
          <div className="chatx-modepill">
            <button className={!bubbleMode ? 'is-active' : ''} onClick={() => setAssistant(saveAssistant({ bubbleMode: false }))}>普通</button>
            <button className={bubbleMode ? 'is-active' : ''} onClick={() => setAssistant(saveAssistant({ bubbleMode: true }))}>气泡</button>
          </div>
          <span className="chatx-top__spacer" />
          <button className="chatx-icon chatx-menu" onClick={newSession} aria-label="新对话">
            <Plus size={18} />
          </button>
        </header>

        {/* 消息区（分气泡模式下双击空白静默切换观察态）*/}
        <div className="chat-scroll chatx-scroll" onDoubleClick={onThreadDblClick}>
          <div className="chatx-thread">
        {!target && (
          <div className="card chat-hint">
            还没有可用的供应商。去 <Link to="/settings">设置页</Link> 添加一个就能开聊。
          </div>
        )}
        {rows.length === 0 && target && (
          <p className="faint chat-empty">说点什么吧。</p>
        )}
        {/* 跨窗口衔接标记：像一条时间切分线，点开可见从上一窗口带过来的内容 */}
        {cur?.carry && (
          <details className="chatx-carry">
            <summary>衔接自「{cur.carry.title}」 · {formatCardTime(cur.carry.endedAt)}</summary>
            <pre>{cur.carry.text}</pre>
          </details>
        )}
        {rows.map((row, i) => {
          const m = row.m
          const isStreamingRow = m.mid === streamingMid
          const hasThink = !!(m.thinking || (m.tools && m.tools.length))
          return (
          <div key={row.slot || i} className="chatx-mrow" data-mid={m.mid}>
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
                <span className="chat-emet-name">{assistant.name}</span>
                {m.distill && <span className="chat-distill-tag">对话沉淀</span>}
              </div>
              {/* 思考链：思考进行时（本行在流式且正文未出）自动展开+呼吸，正文一出现自动收起 */}
              {!bubbleMode && m.thinking ? (
                <ThinkFold text={m.thinking} active={isStreamingRow && !m.content} />
              ) : null}
              {!bubbleMode &&
                (m.tools || []).map((t) => (
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
              {/* 观察态点开的思考：在消息上方内联展开（参考图的淡色块），再点气泡收起 */}
              {bubbleMode && observing && hasThink && observeMid === m.mid && (
                <div className="chatx-thinkinline">
                  {m.thinking && (
                    <>
                      <div className="chatx-thinkinline__label">thinking</div>
                      <div className="chatx-thinkinline__body">{m.thinking}</div>
                    </>
                  )}
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
                </div>
              )}
              {bubbleMode ? (
                /* 分气泡（Telegram式）：按段拆成小气泡；观察态下有思考的气泡带淡色光圈，点击在上方展开思考 */
                <div
                  className={'chatx-tg' + (observing && hasThink ? ' is-glow' : '')}
                  onClick={
                    observing && hasThink
                      ? () => setObserveMid((prev) => (prev === m.mid ? null : m.mid))
                      : undefined
                  }
                  role={observing && hasThink ? 'button' : undefined}
                >
                  {(() => {
                    const parts = splitBubbles(m.content || '')
                    if (!parts.length && streaming && isStreamingRow) parts.push('')
                    return parts.map((p, pi) => (
                      <div
                        key={pi}
                        className="chat-bubble chat-bubble--emet chatx-tgbubble"
                        dangerouslySetInnerHTML={{
                          __html:
                            renderSafeMarkdown(p) +
                            (streaming && isStreamingRow && pi === parts.length - 1
                              ? '<span class="chat-cursor">▍</span>'
                              : ''),
                        }}
                      />
                    ))
                  })()}
                </div>
              ) : (
                <div
                  className="chat-bubble chat-bubble--emet"
                  // Emet 的输出走 Markdown + DOMPurify 消毒（防工具读到的内容借她的嘴注入）
                  dangerouslySetInnerHTML={{
                    __html:
                      renderSafeMarkdown(m.content || '') +
                      (streaming && isStreamingRow ? '<span class="chat-cursor">▍</span>' : ''),
                  }}
                />
              )}
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

        {/* 输入区 */}
        <div className="chatx-inputwrap">
          {chatImgs.length > 0 && (
            <div className="feed-compose__previews chatx-imgpreviews">
              {chatImgs.map((im, i) => (
                <div key={i} className="feed-compose__preview">
                  <img src={im.preview} alt="" />
                  <button
                    className="feed-compose__preview-del"
                    onClick={() => setChatImgs((prev) => prev.filter((_, j) => j !== i))}
                    aria-label="移除图片"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="chat-input chatx-input">
            <button
              className="chatx-attach"
              onClick={() => chatFileRef.current?.click()}
              disabled={streaming || chatImgs.length >= 3}
              aria-label="发图片"
            >
              <ImagePlus size={18} />
            </button>
            <input ref={chatFileRef} type="file" accept="image/*" multiple hidden onChange={pickChatImages} />
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
              <button className="chat-send" disabled={!input.trim() && chatImgs.length === 0} onClick={send} aria-label="发送">
                <Send size={17} />
              </button>
            )}
          </div>
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
                <p className="faint ts-empty">还没有收藏。点消息下的 ☆ 收藏。</p>
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
