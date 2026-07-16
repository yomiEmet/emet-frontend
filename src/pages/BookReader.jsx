// 共读阅读器（三期）：pre-wrap 逐字渲染（与存储正文一致，绝不加工）+ 划线批注。
// 批注锚定：章节索引 + 字符偏移 + quote 兜底（偏移对不上按 quote 文本搜索恢复）。
// 双方批注不同色；共享书签 = 双方共用的阅读进度。

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, List, X, Highlighter } from 'lucide-react'
import {
  bookMeta,
  bookChapter,
  bookAnnotations,
  bookAnnotate,
  bookAnnotationDelete,
  bookmarkSet,
} from '../api.js'
import { showToast } from '../utils/toast.js'

// 容器内 (node,offset) → 全局字符偏移：按文档顺序累加文本节点长度。
// 前提：容器里只有我们逐字渲染的文本（纯文本节点 + <mark> 里的文本），
// 走出来的拼接 === 章节正文，偏移才准。
function offsetInContainer(container, node, offset) {
  let total = 0
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) {
    if (n === node) return total + offset
    total += n.textContent.length
  }
  return total + offset
}

// 批注 → [start,end)：偏移能对上原 quote 就用偏移，否则按 quote 搜索恢复
function resolveAnno(a, text) {
  if (Number.isInteger(a.start) && a.start >= 0 && a.end <= text.length && text.slice(a.start, a.end) === a.quote) {
    return [a.start, a.end]
  }
  if (a.quote) {
    const i = text.indexOf(a.quote)
    if (i >= 0) return [i, i + a.quote.length]
  }
  return null
}

export default function BookReader() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [meta, setMeta] = useState(null) // { book, chapters, bookmark }
  const [idx, setIdx] = useState(0)
  const [chapter, setChapter] = useState(null) // { idx, title, text }
  const [annos, setAnnos] = useState([])
  const [tocOpen, setTocOpen] = useState(false)
  const [sel, setSel] = useState(null) // { start, end, quote }
  const [draftNote, setDraftNote] = useState('')
  const [composing, setComposing] = useState(false)
  const [openAnno, setOpenAnno] = useState(null) // 点开的批注组 { ranges idx }
  const textRef = useRef(null)

  // 首载：元数据 + 书签定位起始章
  useEffect(() => {
    let alive = true
    bookMeta(id)
      .then((m) => {
        if (!alive) return
        setMeta(m)
        setIdx(m.bookmark?.chapter_idx || 0)
      })
      .catch(() => alive && showToast('打不开这本书'))
    return () => {
      alive = false
    }
  }, [id])

  // 切章：拉正文 + 全书批注（批注量小，一次拉齐按章过滤）
  useEffect(() => {
    if (!meta) return
    let alive = true
    setChapter(null)
    setSel(null)
    setOpenAnno(null)
    Promise.all([bookChapter(id, idx), bookAnnotations(id)])
      .then(([c, a]) => {
        if (!alive) return
        setChapter(c.chapter)
        setAnnos((a.annotations || []).filter((x) => x.chapter_idx === idx))
        window.scrollTo(0, 0)
      })
      .catch(() => alive && showToast('这一章加载失败'))
    // 更新共享书签（谁翻到哪，进度就到哪）
    bookmarkSet(id, { chapter_idx: idx, offset: 0 }).catch(() => {})
    return () => {
      alive = false
    }
  }, [id, idx, meta])

  const reloadAnnos = () =>
    bookAnnotations(id)
      .then((a) => setAnnos((a.annotations || []).filter((x) => x.chapter_idx === idx)))
      .catch(() => {})

  // 选区 → 偏移。composing 期间（批注输入框聚焦）不抢选区。
  const onSelect = () => {
    if (composing) return
    const s = window.getSelection()
    if (!s || s.isCollapsed || !s.rangeCount) {
      setSel(null)
      return
    }
    const range = s.getRangeAt(0)
    const cont = textRef.current
    if (!cont || !cont.contains(range.commonAncestorContainer)) {
      setSel(null)
      return
    }
    let start = offsetInContainer(cont, range.startContainer, range.startOffset)
    let end = offsetInContainer(cont, range.endContainer, range.endOffset)
    if (start > end) [start, end] = [end, start]
    if (end - start < 1) {
      setSel(null)
      return
    }
    const quote = (chapter?.text || '').slice(start, end)
    setSel({ start, end, quote })
  }

  const saveAnno = async () => {
    if (!sel) return
    try {
      await bookAnnotate(id, {
        chapter_idx: idx,
        start: sel.start,
        end: sel.end,
        quote: sel.quote,
        note: draftNote.trim(),
        author: 'yomi',
      })
      setSel(null)
      setDraftNote('')
      window.getSelection()?.removeAllRanges()
      await reloadAnnos()
      showToast('划线已记下')
    } catch (e) {
      showToast(e?.message || '保存失败')
    }
  }

  const delAnno = async (annoId) => {
    try {
      await bookAnnotationDelete(id, annoId)
      setOpenAnno(null)
      await reloadAnnos()
    } catch (e) {
      showToast(e?.message || '删除失败')
    }
  }

  // 正文分段渲染：把批注区间包成 <mark>，其余为纯文本（保持逐字一致）。
  // 用「区间切分」而非「重叠即丢」：按所有批注的边界把正文切成最小片段，
  // 每个片段收集覆盖它的全部批注——这样两人（含部分重叠/包含）的划线都能高亮、都能点开。
  const segments = useMemo(() => {
    const text = chapter?.text || ''
    if (!text) return []
    const ranges = []
    for (const a of annos) {
      const r = resolveAnno(a, text)
      if (r && r[1] > r[0]) ranges.push({ start: r[0], end: r[1], anno: a })
    }
    if (!ranges.length) return [{ k: 0, mark: false, text }]
    // 所有边界点（含首尾），去重排序 → 相邻两点间即一个最小片段
    const bounds = new Set([0, text.length])
    for (const r of ranges) {
      bounds.add(r.start)
      bounds.add(r.end)
    }
    const points = [...bounds].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b)
    const segs = []
    let key = 0
    for (let i = 0; i < points.length - 1; i++) {
      const s = points[i]
      const e = points[i + 1]
      if (e <= s) continue
      // 覆盖 [s,e) 的全部批注（一个片段可被多人/多条批注同时覆盖）
      const covering = ranges.filter((r) => r.start <= s && r.end >= e).map((r) => r.anno)
      if (covering.length) segs.push({ k: key++, mark: true, text: text.slice(s, e), annos: covering })
      else segs.push({ k: key++, mark: false, text: text.slice(s, e) })
    }
    return segs
  }, [chapter, annos])

  const total = meta?.book?.chapter_count || 0
  const canPrev = idx > 0
  const canNext = idx < total - 1

  return (
    <div className="page detail book-reader">
      <header className="detail-header">
        <button className="detail-back" onClick={() => navigate('/books')} aria-label="返回书架">
          <ArrowLeft size={20} />
        </button>
        <span className="detail-title">{meta?.book?.title || '共读'}</span>
        <div className="detail-header__right">
          <button className="detail-more" onClick={() => setTocOpen(true)} aria-label="目录">
            <List size={18} />
          </button>
        </div>
      </header>

      {chapter === null ? (
        <p className="faint list-hint">加载中…</p>
      ) : (
        <>
          {/* 老书正文首行可能已含标题（旧版分章把标题拼进了正文），此时不再用 h2 渲染，避免重复 */}
          {chapter.title && !(chapter.text || '').startsWith(chapter.title) && (
            <h2 className="book-chapter-title">{chapter.title}</h2>
          )}
          <div
            ref={textRef}
            className="book-text"
            onMouseUp={onSelect}
            onTouchEnd={onSelect}
          >
            {segments.map((s) =>
              s.mark ? (
                <mark
                  key={s.k}
                  className={'book-mark book-mark--' + (s.annos[0].author === 'emet' ? 'emet' : 'yomi')}
                  onClick={() => setOpenAnno(s.annos)}
                >
                  {s.text}
                </mark>
              ) : (
                <span key={s.k}>{s.text}</span>
              ),
            )}
          </div>

          {/* 章节翻页 */}
          <div className="book-nav">
            <button className="set-btn" disabled={!canPrev} onClick={() => setIdx((i) => i - 1)}>
              <ChevronLeft size={15} /> 上一章
            </button>
            <span className="faint book-nav__pos">
              {idx + 1} / {total}
            </span>
            <button className="set-btn" disabled={!canNext} onClick={() => setIdx((i) => i + 1)}>
              下一章 <ChevronRight size={15} />
            </button>
          </div>
        </>
      )}

      {/* 选区批注条 */}
      {sel && (
        <div className="book-annobar card">
          <div className="book-annobar__quote">
            <Highlighter size={13} /> {sel.quote.slice(0, 40)}
            {sel.quote.length > 40 && '…'}
          </div>
          <textarea
            className="book-annobar__note"
            value={draftNote}
            rows={2}
            placeholder="写点批注（可留空只划线）…"
            onFocus={() => setComposing(true)}
            onBlur={() => setComposing(false)}
            onChange={(e) => setDraftNote(e.target.value)}
          />
          <div className="book-annobar__foot">
            <button
              className="mini-btn"
              onClick={() => {
                setSel(null)
                setDraftNote('')
                window.getSelection()?.removeAllRanges()
              }}
            >
              取消
            </button>
            <button className="mini-btn mini-btn--accent" onClick={saveAnno}>
              划线
            </button>
          </div>
        </div>
      )}

      {/* 批注查看 */}
      {openAnno && (
        <>
          <div className="tl-scrim" onClick={() => setOpenAnno(null)} />
          <div className="book-anno-pop card">
            {openAnno.map((a) => (
              <div key={a.id} className="book-anno-item">
                <div className="book-anno-item__head">
                  <span className={'book-anno-who book-anno-who--' + a.author}>
                    {a.author === 'emet' ? 'Emet' : '静怡'}
                  </span>
                  {a.author === 'yomi' && (
                    <button className="faint" onClick={() => delAnno(a.id)} aria-label="删除">
                      <X size={13} />
                    </button>
                  )}
                </div>
                <p className="book-anno-item__quote faint">“{a.quote}”</p>
                {a.note && <p className="book-anno-item__note">{a.note}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* 目录 */}
      {tocOpen && (
        <>
          <div className="tl-scrim" onClick={() => setTocOpen(false)} />
          <div className="book-toc card">
            <div className="book-toc__head">
              <strong>目录</strong>
              <button className="faint" onClick={() => setTocOpen(false)} aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="book-toc__list">
              {(meta?.chapters || []).map((c) => (
                <button
                  key={c.idx}
                  className={'book-toc__item' + (c.idx === idx ? ' is-current' : '')}
                  onClick={() => {
                    setIdx(c.idx)
                    setTocOpen(false)
                  }}
                >
                  {c.title}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
