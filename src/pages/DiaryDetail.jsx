import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock } from 'lucide-react'
import { diaryGet, diaryDate } from '../api.js'
import { formatDateZh, weekdayZh } from '../utils/time.js'
import { diaryAuthorLabel } from '../utils/authors.js'

// 日记全文阅读页（设计 4.3b "点击读全文"）。纯阅读，不做编辑。
export default function DiaryDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [diary, setDiary] = useState(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let alive = true
    diaryGet(id).then((d) => {
      if (!alive) return
      if (!d) setNotFound(true)
      else setDiary(d)
    })
    return () => {
      alive = false
    }
  }, [id])

  return (
    <div className="page detail">
      <header className="detail-header">
        <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <span className="detail-title">日记</span>
        <div className="detail-header__right">
          {diary?.locked && <Lock size={16} className="faint" />}
        </div>
      </header>

      {notFound ? (
        <p className="faint list-hint">这篇日记不存在</p>
      ) : !diary ? (
        <p className="faint list-hint">加载中…</p>
      ) : (
        <>
          {diary.title && <h1 className="diary-read__title">{diary.title}</h1>}
          <div className="faint diary-read__meta">
            {diaryAuthorLabel(diary.author)} · {formatDateZh(diaryDate(diary))} {weekdayZh(diaryDate(diary))}
          </div>
          <div className="detail-read-body">{diary.content}</div>
        </>
      )}
    </div>
  )
}
