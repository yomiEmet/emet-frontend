import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { memoryAll } from '../api.js'

// 标签空间 list 模式（旧版 C2）：全库标签总览。
export default function Tags() {
  const navigate = useNavigate()
  const [all, setAll] = useState(null)
  const [sort, setSort] = useState('hot') // hot=按条数 | recent=按最近使用

  useEffect(() => {
    let alive = true
    memoryAll()
      .then((l) => alive && setAll(l))
      .catch(() => alive && setAll([]))
    return () => {
      alive = false
    }
  }, [])

  const tags = useMemo(() => {
    if (!all) return []
    const map = {}
    all.forEach((m) => {
      m.tags.forEach((t) => {
        if (!map[t]) map[t] = { name: t, count: 0, latest: '' }
        map[t].count++
        if (m.created_at > map[t].latest) map[t].latest = m.created_at
      })
    })
    const arr = Object.values(map)
    if (sort === 'hot') arr.sort((a, b) => b.count - a.count)
    else arr.sort((a, b) => b.latest.localeCompare(a.latest))
    return arr
  }, [all, sort])

  return (
    <div className="page">
      <header className="detail-header">
        <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <span className="detail-title">所有标签</span>
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

      {all === null ? (
        <p className="faint list-hint">加载中…</p>
      ) : tags.length === 0 ? (
        <p className="faint list-hint">还没有标签</p>
      ) : (
        <div className="ts-list card">
          {tags.map((t) => (
            <button key={t.name} className="ts-item" onClick={() => navigate(`/tags/${encodeURIComponent(t.name)}`)}>
              <span className="ts-item__name">#{t.name}</span>
              <span className="faint ts-item__count">{t.count} 条</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
