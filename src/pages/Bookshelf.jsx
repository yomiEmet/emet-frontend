// 共读书架（三期）：书列表 + txt 上架。
// 上架：读 ArrayBuffer → 解码(UTF-8/GBK) → 归一化 → 分章 → 建书 → 分章逐个 POST → 进阅读器。

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BookOpen, Upload, Trash2 } from 'lucide-react'
import { bookList, bookCreate, bookChapterUpload, bookDelete } from '../api.js'
import { decodeTxt, normalize, splitChapters } from '../utils/bookImport.js'
import { showToast } from '../utils/toast.js'

export default function Bookshelf() {
  const navigate = useNavigate()
  const [books, setBooks] = useState(null)
  const [progress, setProgress] = useState(null) // 上架进度文案
  const fileRef = useRef(null)

  const load = () =>
    bookList()
      .then((r) => setBooks(r.books || []))
      .catch(() => setBooks((prev) => prev || []))

  useEffect(() => {
    let alive = true
    bookList()
      .then((r) => alive && setBooks(r.books || []))
      .catch(() => alive && setBooks([]))
    return () => {
      alive = false
    }
  }, [])

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许重复选同一文件
    if (!file) return
    try {
      setProgress('读取文件…')
      const buf = await file.arrayBuffer()
      const text = normalize(decodeTxt(buf))
      const chapters = splitChapters(text)
      if (!chapters.length) {
        setProgress(null)
        showToast('没解析出内容')
        return
      }
      const title = file.name.replace(/\.[^.]+$/, '').slice(0, 100)
      setProgress(`建书《${title}》…`)
      const { book } = await bookCreate({ title, author: '' })
      for (let i = 0; i < chapters.length; i++) {
        setProgress(`上传章节 ${i + 1}/${chapters.length}…`)
        await bookChapterUpload(book.id, { idx: i, title: chapters[i].title, text: chapters[i].text })
      }
      setProgress(null)
      showToast(`《${title}》已上架，共 ${chapters.length} 章`)
      await load()
      navigate(`/books/${book.id}`)
    } catch (err) {
      setProgress(null)
      showToast(err?.message || '上架失败')
    }
  }

  const remove = async (id, title) => {
    if (!window.confirm(`删除《${title}》？批注和进度会一起删掉。`)) return
    try {
      await bookDelete(id)
      await load()
    } catch (e) {
      showToast(e?.message || '删除失败')
    }
  }

  return (
    <div className="page detail">
      <header className="detail-header">
        <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <span className="detail-title">共读书架</span>
        <div className="detail-header__right">
          <button className="detail-more" onClick={() => fileRef.current?.click()} aria-label="上架">
            <Upload size={18} />
          </button>
        </div>
      </header>

      <input
        ref={fileRef}
        type="file"
        accept=".txt,text/plain"
        style={{ display: 'none' }}
        onChange={onFile}
      />

      {progress && <p className="book-progress">{progress}</p>}

      {books === null ? (
        <p className="faint list-hint">加载中…</p>
      ) : books.length === 0 ? (
        <div className="book-empty">
          <BookOpen size={28} className="faint" />
          <p className="faint">书架还是空的</p>
          <button className="set-btn set-btn--accent" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> 上传一本 txt
          </button>
        </div>
      ) : (
        <div className="stack">
          {books.map((b) => {
            const read = b.bookmark ? (b.bookmark.chapter_idx || 0) + 1 : 0
            const pct = b.chapter_count ? Math.round((read / b.chapter_count) * 100) : 0
            return (
              <div key={b.id} className="card book-item" onClick={() => navigate(`/books/${b.id}`)}>
                <div className="book-item__spine" />
                <div className="book-item__body">
                  <strong className="book-item__title">{b.title}</strong>
                  <span className="faint book-item__meta">
                    共 {b.chapter_count} 章
                    {read > 0 && ` · 读到第 ${read} 章（${pct}%）`}
                  </span>
                </div>
                <button
                  className="book-item__del faint"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(b.id, b.title)
                  }}
                  aria-label="删除"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
