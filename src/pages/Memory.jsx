import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, CalendarDays, Plus, X, List, LayoutGrid, ArrowUpDown, Check } from 'lucide-react'
import MemoryCard from '../components/MemoryCard.jsx'
import Galaxy from '../components/Galaxy.jsx'
import GalaxyMiro from '../components/GalaxyMiro.jsx'
import { CATEGORIES } from '../utils/categories.js'
import { monthLabel, monthKeyOf, shortDateZh, timeOfDayZh, formatDateZh, formatDateFriendly, weekdayZh } from '../utils/time.js'
import { DIARY_AUTHORS, diaryAuthorLabel } from '../utils/authors.js'
import { showToast } from '../utils/toast.js'
import { memoryAll, countByCategory, momentAll, diaryAll, diaryDate, getData } from '../api.js'
import { smartSearch } from '../utils/search.js'

const FILTERS = [{ key: 'all', label: '全部' }, ...CATEGORIES]

// 完整排序菜单（旧版 A4）
const SORT_KEYS = [
  { key: 'importance', label: '重要度' },
  { key: 'edit', label: '编辑日期' },
  { key: 'create', label: '创建日期' },
  { key: 'title', label: '标题' },
]

export default function Memory() {
  const navigate = useNavigate()
  // ?tab=galaxy&focus=<id> 支持从详情页"查看✦"跳星图聚焦（旧版 B12）
  // sub-tab 同步 URL：详情页返回能保留 sub-tab，不被 useState 默认值重置
  // 用 prev URLSearchParams 保留其它参数（例如 Rings 内部的 view=diary）
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = ['galaxy', 'rings', 'log'].includes(searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'memory'
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
  const focusId = searchParams.get('focus') || null
  // 星图视觉版本：默认 1（当前 Dear Data 风格），?gv=2 切到 Miró 预览
  const galaxyVariant = searchParams.get('gv') === '2' ? '2' : '1'

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
          className={'subtab' + (tab === 'rings' ? ' is-active' : '')}
          onClick={() => setTab('rings')}
        >
          年轮
        </button>
        <button
          className={'subtab' + (tab === 'log' ? ' is-active' : '')}
          onClick={() => setTab('log')}
        >
          日志
        </button>
        <button className="subtab" onClick={() => navigate('/archive')}>
          档案
        </button>
      </div>

      {tab === 'memory' && <MemoryManage />}
      {tab === 'galaxy' && (galaxyVariant === '2' ? <GalaxyMiro focusId={focusId} /> : <Galaxy focusId={focusId} />)}
      {tab === 'rings' && <Rings />}
      {tab === 'log' && <MemoryManage mode="log" />}
    </div>
  )
}

function MemoryManage({ mode = 'memory' }) {
  // mode='log': 只显示 tags 含 'log' 的，隐藏分类筛选条；暂作"日志"过渡视图
  const isLog = mode === 'log'
  const navigate = useNavigate()
  const [all, setAll] = useState(null) // null=loading
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sortKey, setSortKey] = useState('create')
  const [sortOrder, setSortOrder] = useState('desc')
  const [view, setView] = useState('gallery') // gallery | list（旧版 A5）
  const [sortOpen, setSortOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [curMonth, setCurMonth] = useState('')
  const listRef = useRef(null)

  // 下拉刷新（旧版 A8）
  const [ptr, setPtr] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const touchRef = useRef({ startY: 0, pulling: false })

  const load = () =>
    memoryAll()
      .then(setAll)
      .catch(() => setAll([]))

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

  const list = useMemo(() => {
    if (!all) return []
    let arr = all
    // 日志和记忆互斥：log tag 的归日志 tab，其它归记忆 tab
    if (isLog) arr = arr.filter((m) => m.tags?.includes('log'))
    else arr = arr.filter((m) => !m.tags?.includes('log'))
    if (category !== 'all') arr = arr.filter((m) => m.category === category)
    const q = query.trim()
    if (q) {
      // 有查询：smartSearch 按相关性排（关键词分词+三维加权+沿藤蔓走一步）；忽略 sortKey
      arr = smartSearch(arr, q, { withLinked: true })
    } else {
      // 无查询：保留旧版排序（重要度/编辑日期/创建日期/标题 + 升降序）
      arr = [...arr]
      if (sortKey === 'importance') arr.sort((a, b) => b.rawImportance - a.rawImportance)
      else if (sortKey === 'edit') arr.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      else if (sortKey === 'title') arr.sort((a, b) => a.content.localeCompare(b.content))
      else arr.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      if (sortOrder === 'asc') arr.reverse()
    }
    arr.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) // 置顶恒在最前
    return arr
  }, [all, category, query, sortKey, sortOrder])

  // 时间线抽屉的月份（按当前列表算，跳转目标一定存在）
  const monthsByYear = useMemo(() => {
    const set = new Set()
    list.forEach((m) => set.add(monthKeyOf(m.created_at)))
    const months = Array.from(set).sort().reverse()
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
  }, [list])

  // 滚动跟踪当前可见月份（旧版 A7 的 sticky 月份标签）
  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const c = listRef.current
        if (!c) return
        const cards = c.querySelectorAll('[data-month]')
        if (!cards.length) return
        let best = cards[0]
        for (const el of cards) {
          if (el.getBoundingClientRect().top < 140) best = el
          else break
        }
        setCurMonth(best.dataset.month || '')
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [list])

  const jumpToMonth = (ym) => {
    setDrawerOpen(false)
    const target = listRef.current?.querySelector('[data-month="' + ym + '"]')
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setCurMonth(ym)
    }
  }

  // 下拉刷新 touch 处理
  const onTouchStart = (e) => {
    if (refreshing || window.scrollY > 0) return
    touchRef.current = { startY: e.touches[0].clientY, pulling: true }
  }
  const onTouchMove = (e) => {
    const t = touchRef.current
    if (!t.pulling || refreshing) return
    const dy = e.touches[0].clientY - t.startY
    if (dy <= 0 || window.scrollY > 0) {
      setPtr(0)
      return
    }
    setPtr(Math.min(dy * 0.5, 100))
  }
  const onTouchEnd = async () => {
    const t = touchRef.current
    if (!t.pulling) return
    touchRef.current.pulling = false
    if (ptr >= 60 && !refreshing) {
      setRefreshing(true)
      setPtr(48)
      try {
        await getData(true)
        await load()
        showToast('已刷新')
      } catch (e) {
        showToast('刷新失败')
      } finally {
        setRefreshing(false)
        setPtr(0)
      }
    } else {
      setPtr(0)
    }
  }

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {/* 下拉刷新指示条 */}
      <div className="ptr" style={{ height: ptr }}>
        <span className="faint">
          {refreshing ? '刷新中…' : ptr >= 60 ? '松开刷新' : ptr > 0 ? '下拉刷新' : ''}
        </span>
      </div>

      {/* 搜索 + 视图切换 + 排序 */}
      <div className="mem-controls">
        <div className="search-box">
          <Search size={16} className="search-box__icon" />
          <input
            className="search-box__input"
            placeholder={isLog ? '搜索日志…' : '搜索记忆…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className="cal-btn"
          onClick={() => setView((v) => (v === 'gallery' ? 'list' : 'gallery'))}
          aria-label={view === 'gallery' ? '列表视图' : '画廊视图'}
        >
          {view === 'gallery' ? <List size={18} /> : <LayoutGrid size={18} />}
        </button>
        <button
          className={'cal-btn' + (sortOpen ? ' is-active' : '')}
          onClick={() => setSortOpen((v) => !v)}
          aria-label="排序方式"
        >
          <ArrowUpDown size={17} />
        </button>
      </div>

      {/* 排序菜单（旧版 A4 完整版）*/}
      {sortOpen && (
        <>
          <div className="tl-scrim tl-scrim--clear" onClick={() => setSortOpen(false)} />
          <div className="sort-menu card">
            {SORT_KEYS.map((s) => (
              <button
                key={s.key}
                className={'dm-opt' + (sortKey === s.key ? ' is-checked' : '')}
                onClick={() => setSortKey(s.key)}
              >
                {s.label}
                {sortKey === s.key && <Check size={14} />}
              </button>
            ))}
            <div className="dm-divider" />
            {[
              ['desc', '降序'],
              ['asc', '升序'],
            ].map(([k, label]) => (
              <button
                key={k}
                className={'dm-opt' + (sortOrder === k ? ' is-checked' : '')}
                onClick={() => setSortOrder(k)}
              >
                {label}
                {sortOrder === k && <Check size={14} />}
              </button>
            ))}
          </div>
        </>
      )}

      {/* 分类筛选 + 数量（日志模式隐藏：暂不分类） */}
      {!isLog && (
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
      )}

      {/* sticky 月份标签 + 日历按钮（旧版 A7：滚动定位）*/}
      {curMonth && list.length > 0 && (
        <div className="month-bar">
          <span className="month-bar__label">{monthLabel(curMonth)}</span>
          <button className="month-bar__btn" onClick={() => setDrawerOpen(true)} aria-label="时间线">
            <CalendarDays size={18} />
          </button>
        </div>
      )}

      {/* 时间线抽屉 */}
      {drawerOpen && (
        <>
          <div className="tl-scrim" onClick={() => setDrawerOpen(false)} />
          <aside className="tl-drawer">
            <div className="tl-drawer__head">
              <span>时间线</span>
              <button onClick={() => setDrawerOpen(false)} aria-label="关闭">
                <X size={15} />
              </button>
            </div>
            <div className="tl-drawer__inner">
              {monthsByYear.map((g) => (
                <div key={g.year}>
                  <div className="tl-drawer__year">{g.year}年</div>
                  {g.items.map((ym) => (
                    <button
                      key={ym}
                      className={'tl-drawer__month' + (curMonth === ym ? ' is-active' : '')}
                      onClick={() => jumpToMonth(ym)}
                    >
                      {parseInt(ym.slice(5, 7), 10)}月
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </aside>
        </>
      )}

      {/* 列表 */}
      <div className={'mem-list' + (view === 'list' ? ' mem-list--compact' : ' stack')} ref={listRef}>
        {all === null ? (
          <p className="faint list-hint">加载中…</p>
        ) : list.length === 0 ? (
          <p className="faint list-hint">{isLog ? '还没有日志' : '没有匹配的记忆'}</p>
        ) : (
          list.map((m) => (
            <MemoryCard
              key={m.id}
              memory={m}
              query={query.trim()}
              compact={view === 'list'}
              onClick={() => navigate(`/memory/${m.id}`)}
              onTagClick={(t) => navigate(`/tags/${encodeURIComponent(t)}`)}
            />
          ))
        )}
      </div>

      {/* 新增按钮 */}
      <button
        className="fab"
        onClick={() => navigate(isLog ? '/memory/new?tag=log' : '/memory/new')}
        aria-label={isLog ? '新增日志' : '新增记忆'}
      >
        <Plus size={24} />
      </button>
    </div>
  )
}

// ── 年轮：瞬记时间线 + 日记列表（设计 4.3b）──────────────
function Rings() {
  // view 也同步进 URL（?tab=rings&view=diary）：详情页返回能保留 view
  const [searchParams, setSearchParams] = useSearchParams()
  const view = ['diary', 'weekly', 'monthly'].includes(searchParams.get('view'))
    ? searchParams.get('view')
    : 'moment'
  const setView = (next) => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.set('view', next)
        return p
      },
      { replace: true },
    )
  }

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
          <button
            className={'seg-btn' + (view === 'weekly' ? ' is-active' : '')}
            onClick={() => setView('weekly')}
          >
            周记
          </button>
          <button
            className={'seg-btn' + (view === 'monthly' ? ' is-active' : '')}
            onClick={() => setView('monthly')}
          >
            月记
          </button>
        </div>
      </div>
      {view === 'moment' && <MomentTimeline />}
      {view === 'diary' && <DiaryList />}
      {view === 'weekly' && <PeriodReviewList author="weekly" emptyHint="还没有周记。等周日 23:00 cron 自动写一篇，或者用 admin 路由手动触发。" />}
      {view === 'monthly' && <PeriodReviewList author="monthly" emptyHint="还没有月记。等月底 23:30 cron 自动写一篇，或者用 admin 路由手动触发。" />}
    </>
  )
}

// 周记/月记列表：按 author 单一过滤，不带 chip；卡片视觉跟 diary-card 同款
function PeriodReviewList({ author, emptyHint }) {
  const navigate = useNavigate()
  const [list, setList] = useState(null)

  useEffect(() => {
    let alive = true
    diaryAll()
      .then((l) => alive && setList(l.filter((d) => d.author === author)))
      .catch(() => alive && setList([]))
    return () => {
      alive = false
    }
  }, [author])

  return (
    <div className="stack">
      {list === null ? (
        <p className="faint list-hint">加载中…</p>
      ) : list.length === 0 ? (
        <p className="faint list-hint">{emptyHint || '没有内容'}</p>
      ) : (
        list.map((d) => (
          <button key={d.id} className="card diary-card" onClick={() => navigate(`/diary/${d.id}`)}>
            {d.title && <div className="diary-card__title">{d.title}</div>}
            <div className="faint diary-card__meta">
              {formatDateZh(diaryDate(d))} {weekdayZh(diaryDate(d))}
            </div>
            <p className="diary-card__preview">{d.content}</p>
          </button>
        ))
      )}
    </div>
  )
}

function MomentTimeline() {
  const navigate = useNavigate()
  const [list, setList] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

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

  // 时间线抽屉的"年→月"分组
  const monthsByYear = useMemo(() => {
    const yearMap = new Map()
    groups.forEach((g) => {
      const y = g.ym.slice(0, 4)
      if (!yearMap.has(y)) yearMap.set(y, [])
      yearMap.get(y).push(g.ym)
    })
    return [...yearMap.entries()].map(([year, items]) => ({ year, items }))
  }, [groups])

  const jumpToMonth = (ym) => {
    setDrawerOpen(false)
    const target = document.querySelector('[data-moment-month="' + ym + '"]')
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (list === null) return <p className="faint list-hint">加载中…</p>
  if (list.length === 0) {
    return (
      <>
        <p className="faint list-hint">还没有瞬记</p>
        <button
          className="fab"
          onClick={() => navigate('/moment/new')}
          aria-label="新增瞬记"
        >
          <Plus size={24} />
        </button>
      </>
    )
  }

  return (
    <>
      {/* sticky 月份跳转按钮 */}
      {groups.length > 1 && (
        <div className="month-bar">
          <span className="month-bar__label faint">{groups.length} 个月</span>
          <button
            className="month-bar__btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="时间线"
          >
            <CalendarDays size={18} />
          </button>
        </div>
      )}

      {/* 时间线抽屉 */}
      {drawerOpen && (
        <>
          <div className="tl-scrim" onClick={() => setDrawerOpen(false)} />
          <aside className="tl-drawer">
            <div className="tl-drawer__head">
              <span>时间线</span>
              <button onClick={() => setDrawerOpen(false)} aria-label="关闭">
                <X size={15} />
              </button>
            </div>
            <div className="tl-drawer__inner">
              {monthsByYear.map((g) => (
                <div key={g.year}>
                  <div className="tl-drawer__year">{g.year}年</div>
                  {g.items.map((ym) => (
                    <button
                      key={ym}
                      className="tl-drawer__month"
                      onClick={() => jumpToMonth(ym)}
                    >
                      {parseInt(ym.slice(5, 7), 10)}月
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </aside>
        </>
      )}

      <div className="timeline">
        {groups.map((g) => (
          <div key={g.ym} className="tl-month" data-moment-month={g.ym}>
            <div className="tl-month__label">{monthLabel(g.ym)}</div>
            {g.items.map((m) => (
              <div
                key={m.id}
                className="tl-item"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/moment/${m.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    navigate(`/moment/${m.id}`)
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
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

      <button
        className="fab"
        onClick={() => navigate('/moment/new')}
        aria-label="新增瞬记"
      >
        <Plus size={24} />
      </button>
    </>
  )
}

function DiaryList() {
  const navigate = useNavigate()
  const [list, setList] = useState(null)
  const [author, setAuthor] = useState('all')
  // 同日多篇时哪些日期处于展开态
  const [expandedDates, setExpandedDates] = useState(() => new Set())
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    let alive = true
    diaryAll()
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]))
    return () => {
      alive = false
    }
  }, [])

  // 切 chip 时清空展开状态（避免上次筛选下展开的日期残留）
  const switchAuthor = (next) => {
    setAuthor(next)
    setExpandedDates(new Set())
  }

  // 日记 tab 不该出现 weekly / monthly（它们有专属 sub-tab）；先剔除再算 counts/filtered
  const diaryOnly = useMemo(
    () => (list || []).filter((d) => d.author !== 'weekly' && d.author !== 'monthly'),
    [list],
  )

  const counts = useMemo(() => {
    const c = { all: diaryOnly.length }
    for (const d of diaryOnly) c[d.author] = (c[d.author] || 0) + 1
    return c
  }, [diaryOnly])

  const filtered = useMemo(() => {
    if (!list) return []
    return author === 'all' ? diaryOnly : diaryOnly.filter((d) => d.author === author)
  }, [list, diaryOnly, author])

  // 按 diary_date 聚合；同日内 created_at asc（早→晚）；外层日期 desc
  const grouped = useMemo(() => {
    const map = new Map()
    for (const d of filtered) {
      const dk = diaryDate(d)
      if (!map.has(dk)) map.set(dk, [])
      map.get(dk).push(d)
    }
    for (const items of map.values()) {
      items.sort((a, b) => {
        const ta = a.created_at || ''
        const tb = b.created_at || ''
        return ta < tb ? -1 : ta > tb ? 1 : 0
      })
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [filtered])

  const toggleDate = (date) => {
    setExpandedDates((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  // 时间线抽屉：从 grouped 的日期 key 抽出唯一月份，按年分组
  const monthsByYear = useMemo(() => {
    const set = new Set()
    grouped.forEach(([date]) => set.add(date.slice(0, 7)))
    const months = [...set].sort().reverse()
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
  }, [grouped])

  const jumpToMonth = (ym) => {
    setDrawerOpen(false)
    const target = document.querySelector('[data-diary-month="' + ym + '"]')
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <div className="chips">
        {DIARY_AUTHORS.map((a) => (
          <button
            key={a.key}
            className={'chip' + (author === a.key ? ' is-active' : '')}
            onClick={() => switchAuthor(a.key)}
          >
            {a.label}
            <em className="chip-count">{counts[a.key] || 0}</em>
          </button>
        ))}
      </div>

      {monthsByYear.length > 0 && (
        <div className="month-bar">
          <span className="month-bar__label faint">
            {monthsByYear.reduce((n, g) => n + g.items.length, 0)} 个月
          </span>
          <button
            className="month-bar__btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="时间线"
          >
            <CalendarDays size={18} />
          </button>
        </div>
      )}

      {drawerOpen && (
        <>
          <div className="tl-scrim" onClick={() => setDrawerOpen(false)} />
          <aside className="tl-drawer">
            <div className="tl-drawer__head">
              <span>时间线</span>
              <button onClick={() => setDrawerOpen(false)} aria-label="关闭">
                <X size={15} />
              </button>
            </div>
            <div className="tl-drawer__inner">
              {monthsByYear.map((g) => (
                <div key={g.year}>
                  <div className="tl-drawer__year">{g.year}年</div>
                  {g.items.map((ym) => (
                    <button
                      key={ym}
                      className="tl-drawer__month"
                      onClick={() => jumpToMonth(ym)}
                    >
                      {parseInt(ym.slice(5, 7), 10)}月
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </aside>
        </>
      )}

      <div className="stack">
        {list === null ? (
          <p className="faint list-hint">加载中…</p>
        ) : grouped.length === 0 ? (
          <p className="faint list-hint">没有日记</p>
        ) : (
          grouped.map(([date, items]) => {
            const ym = date.slice(0, 7)
            return (
              <div key={date} data-diary-month={ym}>
                {items.length === 1 ? (
                  <button
                    className="card diary-card"
                    onClick={() => navigate(`/diary/${items[0].id}`)}
                  >
                    {items[0].title && <div className="diary-card__title">{items[0].title}</div>}
                    <div className="faint diary-card__meta">
                      {diaryAuthorLabel(items[0].author)} · {formatDateZh(diaryDate(items[0]))}{' '}
                      {weekdayZh(diaryDate(items[0]))}
                    </div>
                    <p className="diary-card__preview">{items[0].content}</p>
                  </button>
                ) : (
                  <DiaryDayCard
                    date={date}
                    items={items}
                    expanded={expandedDates.has(date)}
                    onToggle={() => toggleDate(date)}
                    onItemClick={(id) => navigate(`/diary/${id}`)}
                  />
                )}
              </div>
            )
          })
        )}
      </div>
    </>
  )
}

// 同日多篇日记的聚合卡：标题"6月17日 · 3篇" + author 角标，点击切换展开
// 子项仅显示 标题（无标题则 80 字 preview）+ HH:MM，点击进单篇详情
function DiaryDayCard({ date, items, expanded, onToggle, onItemClick }) {
  const authorCounts = items.reduce((acc, d) => {
    acc[d.author] = (acc[d.author] || 0) + 1
    return acc
  }, {})
  const timeHHMM = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return (
    <div className={'card diary-day-card' + (expanded ? ' is-open' : '')}>
      <button type="button" className="diary-day-card__header" onClick={onToggle}>
        <div className="diary-day-card__head-text">
          <span className="diary-day-card__title">
            {formatDateFriendly(date)} · {items.length}篇
          </span>
          <span className="faint diary-day-card__meta">
            {Object.entries(authorCounts)
              .map(([k, n]) => `${diaryAuthorLabel(k)} ×${n}`)
              .join('  ')}
          </span>
        </div>
        <span className="diary-day-card__chevron">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="diary-day-card__children">
          {items.map((d) => {
            const fallback =
              (d.content || '').slice(0, 80) +
              ((d.content || '').length > 80 ? '…' : '')
            return (
              <button
                key={d.id}
                type="button"
                className="diary-day-card__child"
                onClick={() => onItemClick(d.id)}
              >
                <span className="diary-day-card__child-time faint">
                  {timeHHMM(d.created_at)}
                </span>
                <span className="diary-day-card__child-title">
                  {d.title || fallback}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
