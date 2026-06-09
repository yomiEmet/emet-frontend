import { useState, useEffect } from 'react'
import { Search, TreePine } from 'lucide-react'
import MemoryCard from '../components/MemoryCard.jsx'
import { CATEGORIES } from '../utils/categories.js'
import { memoryList, memorySearch } from '../api.js'

const FILTERS = [{ key: 'all', label: '全部' }, ...CATEGORIES]
const SORTS = [
  { key: 'recent', label: '最新' },
  { key: 'importance', label: '重要度' },
]

export default function Memory() {
  const [tab, setTab] = useState('memory') // memory | rings

  return (
    <div className="page">
      {/* 顶部子 Tab */}
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
      </div>

      {tab === 'memory' ? <MemoryManage /> : <RingsStub />}
    </div>
  )
}

function MemoryManage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState('recent')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const q = query.trim()
    const req = q ? memorySearch({ query: q, category }) : memoryList({ category, sort })
    req
      .then((res) => {
        if (alive) setItems(res.items || [])
      })
      .catch(() => {
        if (alive) setItems([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [query, category, sort])

  return (
    <>
      {/* 搜索框 */}
      <div className="search-box">
        <Search size={16} className="search-box__icon" />
        <input
          className="search-box__input"
          placeholder="搜索记忆…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* 分类筛选 */}
      <div className="chips">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={'chip' + (category === f.key ? ' is-active' : '')}
            onClick={() => setCategory(f.key)}
          >
            {f.label}
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
              disabled={!!query.trim()}
            >
              {s.label}
            </button>
          </span>
        ))}
      </div>

      {/* 列表 */}
      <div className="mem-list stack">
        {loading ? (
          <p className="faint list-hint">加载中…</p>
        ) : items.length === 0 ? (
          <p className="faint list-hint">没有匹配的记忆</p>
        ) : (
          items.map((m) => <MemoryCard key={m.id} memory={m} />)
        )}
      </div>
    </>
  )
}

function RingsStub() {
  return (
    <div className="placeholder">
      <TreePine size={48} strokeWidth={1.4} />
      <h2>年轮</h2>
      <p>瞬记时间线 + 日记列表。第一期第 5 步接 moment / diary API。</p>
    </div>
  )
}
