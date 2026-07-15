// 独处手账（项目书 2-2）：Emet 独处时的产出时间线。
// 按逻辑日（凌晨 4 点切，后端已算好 entry.day）分组；四种 action 配小图标；
// 游标翻页「加载更早」。只读页面——手账是他自己的本子，这里只是翻看。

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BookOpen, Sparkles, Send, Cloud } from 'lucide-react'
import { idleLogList } from '../api.js'
import { showToast } from '../utils/toast.js'

const ACTION_META = {
  diary: { icon: BookOpen, label: '手账' },
  reflect: { icon: Sparkles, label: '感悟' },
  post: { icon: Send, label: '发了动态' },
  rest: { icon: Cloud, label: '发呆' },
}

function dayLabel(day) {
  if (!day) return ''
  const [, m, d] = day.split('-')
  return `${+m} 月 ${+d} 日`
}

function timeLabel(ts) {
  // ts 是 UTC ISO，转东八区 HH:MM
  try {
    const t = new Date(new Date(ts).getTime() + 8 * 3600 * 1000)
    return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`
  } catch {
    return ''
  }
}

export default function IdleJournal() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState(null)
  const [nextBefore, setNextBefore] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    let alive = true
    idleLogList({ limit: 30 })
      .then((r) => {
        if (!alive) return
        setEntries(r.entries || [])
        setNextBefore(r.next_before || null)
      })
      .catch(() => alive && setEntries([]))
    return () => {
      alive = false
    }
  }, [])

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return
    setLoadingMore(true)
    try {
      const r = await idleLogList({ before: nextBefore, limit: 30 })
      setEntries((prev) => [...(prev || []), ...(r.entries || [])])
      setNextBefore(r.next_before || null)
    } catch (e) {
      showToast(e?.message || '加载失败')
    } finally {
      setLoadingMore(false)
    }
  }

  // 按逻辑日分组（entries 已按时间倒序）
  const groups = []
  for (const e of entries || []) {
    const last = groups[groups.length - 1]
    if (last && last.day === e.day) last.items.push(e)
    else groups.push({ day: e.day, items: [e] })
  }

  return (
    <div className="page detail">
      <header className="detail-header">
        <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <span className="detail-title">独处手账</span>
        <div className="detail-header__right" />
      </header>

      {entries === null ? (
        <p className="faint list-hint">加载中…</p>
      ) : entries.length === 0 ? (
        <p className="faint list-hint">他还没有独处过。到设置里打开「独处时间」，白天的窗口里他会自己安排。</p>
      ) : (
        <div className="stack">
          {groups.map((g) => (
            <section key={g.day} className="idle-day">
              <div className="section-label">{dayLabel(g.day)}</div>
              {g.items.map((e) => {
                const meta = ACTION_META[e.action] || ACTION_META.rest
                const Icon = meta.icon
                return (
                  <div key={e.ts} className={'card idle-entry idle-entry--' + e.action}>
                    <div className="idle-entry__head">
                      <span className="idle-entry__badge">
                        <Icon size={13} />
                        {meta.label}
                      </span>
                      <span className="faint idle-entry__time">{timeLabel(e.ts)}</span>
                    </div>
                    {e.content && <p className="idle-entry__content">{e.content}</p>}
                    {e.note && <p className="faint idle-entry__note">{e.note}</p>}
                  </div>
                )
              })}
            </section>
          ))}
          {nextBefore && (
            <button className="mini-btn feed-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? '加载中…' : '加载更早'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
