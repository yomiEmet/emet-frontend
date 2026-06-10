import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CalendarDays, Plus, X } from 'lucide-react'
import MemoryCard from '../components/MemoryCard.jsx'
import Galaxy from '../components/Galaxy.jsx'
import { CATEGORIES } from '../utils/categories.js'
import { monthLabel, monthKeyOf, shortDateZh, timeOfDayZh, formatDateZh, weekdayZh } from '../utils/time.js'
import { DIARY_AUTHORS, diaryAuthorLabel } from '../utils/authors.js'
import { memoryAll, countByCategory, momentAll, diaryAll, diaryDate } from '../api.js'

const FILTERS = [{ key: 'all', label: '全部' }, ...CATEGORIES]
const SORTS = [
  { key: 'recent', label: '最新' },
  { key: 'importance', label: '重要度' },
]

export default function Memory() {
  const [tab, setTab] = useState('memory') // memory | galaxy | rings

  return (
    <div className="page">
      <div className="subtabs">
        <button
          className={'subtab' + (tab === 'memory' ? ' is-active' : '')}
          onClick={() => setTab('memory')}
        >
          记忆
        </button>
        <button
          className={'subtab' + (tab === 'galaxy' ? ' is-active' : '')}
          onClick={() => setTab('galaxy')}
        >
          星图
        </button>
        <button
          className={'subtab' + (tab === 'rings' ? ' is-active' : '')}
          onClick={() => setTab('rings')}
        >
          年轮
        </button>
      </div>

      {tab === 'memory' && <MemoryManage />}
      {tab === 'galaxy' && <Galaxy />}
      {tab === 'rings' && <Rings />}
    </div>
  )
}

function MemoryManage() {
  const navigate = useNavigate()
  const [all, setAll] = useState(null) // null=loading
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState('recent')
  const [month, setMonth] = useState('all')
  const [calOpen, setCalOpen] = useState(false)

  useEffect(() => {
    let alive = true
    memoryAll()
      .then((list) => alive && setAll(list))
      .catch(() => alive && setAll([]))
    return () => {
      alive = false
    }
  }, [])

  const counts = useMemo(() => (all ? countByCategory(all) : {}), [all])

  // 日历可选月份（去重、倒序）
  const months = useMemo(() => {
    if (!all) return []
    const set = new Set()
    all.forEach((m) => {
      const ym = (m.created_at || '').slice(0, 7)
      if (ym.length === 7) set.add(ym)
    })
    return Array.from(set).sort().reverse()
  }, [all])

  const list = useMemo(() => {
    if (!all) return []
    let arr = all
    if (category !== 'all') arr = arr.filter((m) => m.category === category)
    if (month !== 'all') arr = arr.filter((m) => (m.created_at || '').slice(0, 7) === month)
    const q = query.trim().toLowerCase()
    if (q) {
      arr = arr.filter(
        (m) =>
          m.content.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q)),
      )
    }
    arr = [...arr]
    if (sort === 'importance') arr.sort((a, b) => b.rawImportance - a.rawImportance)
    else arr.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    arr.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) // 置顶在前
    return arr
  }, [all, category, month, query, sort])

  // 按年分组月份，给日历抽屉用
  const monthsByYear = useMemo(() => {
    const groups = []
    let cur = null
    months.forEach((ym) => {
      const y = ym.slice(0, 4)
      if (!cur || cur.year !== y) {
        cur = { year: y, items: [] }
        groups.push(cur)
      }
      cur.items.push(ym)
    })
    return groups
  }, [months])

  return (
    <>
      {/* 搜索 + 日历 */}
      <div className="mem-controls">
        <div className="search-box">
          <Search size={16} className="search-box__icon" />
          <input
            className="search-box__input"
            placeholder="搜索记忆…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className={'cal-btn' + (month !== 'all' || calOpen ? ' is-active' : '')}
          onClick={() => setCalOpen((v) => !v)}
          aria-label="按月浏览"
        >
          <CalendarDays size={18} />
        </button>
      </div>

      {/* 日历抽屉 */}
      {calOpen && (
        <div className="cal-drawer card">
          <button
            className={'cal-month' + (month === 'all' ? ' is-active' : '')}
            onClick={() => {
              setMonth('all')
              setCalOpen(false)
            }}
          >
            全部
          </button>
          {monthsByYear.map((g) => (
            <div key={g.year} className="cal-year">
              <div className="cal-year__label">{g.year}年</div>
              <div className="cal-year__months">
                {g.items.map((ym) => (
                  <button
                    key={ym}
                    className={'cal-month' + (month === ym ? ' is-active' : '')}
                    onClick={() => {
                      setMonth(ym)
                      setCalOpen(false)
                    }}
                  >
                    {parseInt(ym.slice(5, 7), 10)}月
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 当前月份提示 */}
      {month !== 'all' && (
        <div className="mem-month-tag">
          {monthLabel(month)}
          <button onClick={() => setMonth('all')} aria-label="清除月份">
            <X size={13} />
          </button>
        </div>
      )}

      {/* 分类筛选 + 数量 */}
      <div className="chips">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={'chip' + (category === f.key ? ' is-active' : '')}
            onClick={() => setCategory(f.key)}
          >
            {f.label}
            <em className="chip-count">{counts[f.key] || 0}</em>
          </button>
        ))}
      </div>

      {/* 排序 */}
      <div className="sort-row">
        <span className="faint">排序</span>
        {SORTS.map((s, i) => (
          <span key={s.key}>
            {i > 0 && <span className="sort-sep faint">|</span>}
            <button
              className={'sort-btn' + (sort === s.key ? ' is-active' : '')}
              onClick={() => setSort(s.key)}
            >
              {s.label}
            </button>
          </span>
        ))}
      </div>

      {/* 列表 */}
      <div className="mem-list stack">
        {all === null ? (
          <p className="faint list-hint">加载中…</p>
        ) : list.length === 0 ? (
          <p className="faint list-hint">没有匹配的记忆</p>
        ) : (
          list.map((m) => (
            <MemoryCard key={m.id} memory={m} onClick={() => navigate(`/memory/${m.id}`)} />
          ))
        )}
      </div>

      {/* 新增按钮 */}
      <button className="fab" onClick={() => navigate('/memory/new')} aria-label="新增记忆">
        <Plus size={24} />
      </button>
    </>
  )
}

// ── 年轮：瞬记时间线 + 日记列表（设计 4.3b）──────────────
function Rings() {
  const [view, setView] = useState('moment') // moment | diary

  return (
    <>
      <div className="seg-row">
        <div className="seg">
          <button
            className={'seg-btn' + (view === 'moment' ? ' is-active' : '')}
            onClick={() => setView('moment')}
          >
            瞬记
          </button>
          <button
            className={'seg-btn' + (view === 'diary' ? ' is-active' : '')}
            onClick={() => setView('diary')}
          >
            日记
          </button>
        </div>
      </div>
      {view === 'moment' ? <MomentTimeline /> : <DiaryList />}
    </>
  )
}

function MomentTimeline() {
  const [list, setList] = useState(null)

  useEffect(() => {
    let alive = true
    momentAll()
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]))
    return () => {
      alive = false
    }
  }, [])

  // 按东八区月份分组（list 已按时间倒序）
  const groups = useMemo(() => {
    if (!list) return []
    const out = []
    let cur = null
    list.forEach((m) => {
      const ym = monthKeyOf(m.created_at)
      if (!cur || cur.ym !== ym) {
        cur = { ym, items: [] }
        out.push(cur)
      }
      cur.items.push(m)
    })
    return out
  }, [list])

  if (list === null) return <p className="faint list-hint">加载中…</p>
  if (list.length === 0) return <p className="faint list-hint">还没有瞬记</p>

  return (
    <div className="timeline">
      {groups.map((g) => (
        <div key={g.ym} className="tl-month">
          <div className="tl-month__label">{monthLabel(g.ym)}</div>
          {g.items.map((m) => (
            <div key={m.id} className="tl-item">
              <div className="tl-item__head">
                <span className="tl-item__date">{shortDateZh(m.created_at)}</span>
                <span className="faint tl-item__tod">{timeOfDayZh(m.created_at)}</span>
              </div>
              <p className="tl-item__content">{m.content}</p>
              {m.tags?.length > 0 && (
                <div className="mem-card__tags">
                  {m.tags.map((t) => (
                    <span key={t} className="mem-hashtag">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function DiaryList() {
  const navigate = useNavigate()
  const [list, setList] = useState(null)
  const [author, setAuthor] = useState('all')

  useEffect(() => {
    let alive = true
    diaryAll()
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]))
    return () => {
      alive = false
    }
  }, [])

  const counts = useMemo(() => {
    const c = { all: list?.length || 0 }
    for (const d of list || []) c[d.author] = (c[d.author] || 0) + 1
    return c
  }, [list])

  const filtered = useMemo(() => {
    if (!list) return []
    return author === 'all' ? list : list.filter((d) => d.author === author)
  }, [list, author])

  return (
    <>
      <div className="chips">
        {DIARY_AUTHORS.map((a) => (
          <button
            key={a.key}
            className={'chip' + (author === a.key ? ' is-active' : '')}
            onClick={() => setAuthor(a.key)}
          >
            {a.label}
            <em className="chip-count">{counts[a.key] || 0}</em>
          </button>
        ))}
      </div>

      <div className="stack">
        {list === null ? (
          <p className="faint list-hint">加载中…</p>
        ) : filtered.length === 0 ? (
          <p className="faint list-hint">没有日记</p>
        ) : (
          filtered.map((d) => (
            <button key={d.id} className="card diary-card" onClick={() => navigate(`/diary/${d.id}`)}>
              {d.title && <div className="diary-card__title">{d.title}</div>}
              <div className="faint diary-card__meta">
                {diaryAuthorLabel(d.author)} · {formatDateZh(diaryDate(d))} {weekdayZh(diaryDate(d))}
              </div>
              <p className="diary-card__preview">{d.content}</p>
            </button>
          ))
        )}
      </div>
    </>
  )
}
