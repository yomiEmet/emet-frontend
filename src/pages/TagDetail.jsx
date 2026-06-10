import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import MemoryCard from '../components/MemoryCard.jsx'
import { memoryAll } from '../api.js'

// 标签空间 detail 模式（旧版 C3）：某个标签下的全部记忆。
export default function TagDetail() {
  const { tag } = useParams()
  const navigate = useNavigate()
  const [all, setAll] = useState(null)
  const [sort, setSort] = useState('hot') // hot=按重要度 | recent=按时间

  useEffect(() => {
    let alive = true
    memoryAll()
      .then((l) => alive && setAll(l))
      .catch(() => alive && setAll([]))
    return () => {
      alive = false
    }
  }, [])

  const list = useMemo(() => {
    if (!all) return []
    const arr = all.filter((m) => m.tags.includes(tag))
    if (sort === 'hot') arr.sort((a, b) => b.rawImportance - a.rawImportance)
    else arr.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    return arr
  }, [all, tag, sort])

  return (
    <div className="page">
      <header className="detail-header">
        <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <span className="detail-title"># {tag}</span>
        <div className="detail-header__right" />
      </header>

      <div className="subtabs">
        <button className={'subtab' + (sort === 'hot' ? ' is-active' : '')} onClick={() => setSort('hot')}>
          热门
        </button>
        <button className={'subtab' + (sort === 'recent' ? ' is-active' : '')} onClick={() => setSort('recent')}>
          最新
        </button>
      </div>

      <div className="mem-list stack">
        {all === null ? (
          <p className="faint list-hint">加载中…</p>
        ) : list.length === 0 ? (
          <p className="faint list-hint">还没有这个标签下的记忆</p>
        ) : (
          list.map((m) => <MemoryCard key={m.id} memory={m} onClick={() => navigate(`/memory/${m.id}`)} />)
        )}
      </div>
    </div>
  )
}
