import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock, Trash2, Pencil, Check, X } from 'lucide-react'
import { diaryGet, diaryDate, diaryUpdate, diaryDelete } from '../api.js'
import { formatDateZh, weekdayZh, dayKey } from '../utils/time.js'
import { showToast } from '../utils/toast.js'

const SAVE_TEXT = { idle: '', saving: '编辑中…', saved: '已保存', error: '保存失败' }

// 日记 / 周记 / 月记 / 故事 共用详情页（背后都是 diary: KV）。
// 上半段标题 / meta；编辑态可改 title / content / diary_date / author_label / locked；
// 底部展示并可编辑 author_label（例如 "Emet · Claude Opus 4.6"）。
// 自动保存 500ms 防抖，删除走硬删 KV。
export default function DiaryDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [diary, setDiary] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [editing, setEditing] = useState(false)
  const [work, setWork] = useState(null)
  const [saveState, setSaveState] = useState('idle')
  const [busy, setBusy] = useState(false)
  const workRef = useRef(null)
  const timerRef = useRef(null)
  const savingRef = useRef(false)

  const refresh = async () => {
    const d = await diaryGet(id)
    if (!d) setNotFound(true)
    else setDiary(d)
    return d
  }

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

  // 进编辑：把当前 diary 拷一份给 work
  const enterEdit = () => {
    if (!diary || diary.locked) {
      if (diary?.locked) showToast('请先解锁')
      return
    }
    const w = {
      title: diary.title || '',
      content: diary.content || '',
      diary_date: diary.diary_date || dayKey(),
      author_label: diary.author_label || '',
    }
    setWork(w)
    workRef.current = w
    setEditing(true)
    setSaveState('idle')
  }

  // 退编辑：先 flush 一次保存（如果有 pending），再退出
  const exitEdit = async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
      await doSave()
    }
    setEditing(false)
    setWork(null)
    workRef.current = null
    setSaveState('idle')
    await refresh()
  }

  // 字段写入 + 防抖保存
  const set = (key, value) => {
    if (!work) return
    const next = { ...workRef.current, [key]: value }
    workRef.current = next
    setWork(next)
    scheduleSave()
  }

  const scheduleSave = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setSaveState('saving')
    timerRef.current = setTimeout(doSave, 500)
  }

  const doSave = async () => {
    timerRef.current = null
    if (savingRef.current) return
    savingRef.current = true
    const w = workRef.current
    if (!w) {
      savingRef.current = false
      return
    }
    try {
      await diaryUpdate(id, {
        title: w.title,
        content: w.content,
        diary_date: w.diary_date,
        author_label: w.author_label,
      })
      setSaveState('saved')
    } catch (e) {
      setSaveState('error')
      showToast(e?.message || '保存失败')
    } finally {
      savingRef.current = false
    }
  }

  const toggleLock = async () => {
    if (!diary || busy) return
    setBusy(true)
    try {
      await diaryUpdate(id, { locked: !diary.locked })
      await refresh()
      showToast(diary.locked ? '已解锁' : '已锁定')
    } catch (e) {
      showToast(e?.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (!diary) return
    if (diary.locked) {
      showToast('请先解锁')
      return
    }
    if (!window.confirm('确认删除这篇日记？删除后不可恢复。')) return
    try {
      await diaryDelete(id)
      showToast('已删除')
      navigate(-1)
    } catch (e) {
      showToast(e?.message || '删除失败')
    }
  }

  if (notFound) {
    return (
      <div className="page detail">
        <header className="detail-header">
          <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
            <ArrowLeft size={20} />
          </button>
          <span className="detail-title">日记</span>
        </header>
        <p className="faint list-hint">这篇日记不存在</p>
      </div>
    )
  }

  if (!diary) {
    return (
      <div className="page detail">
        <header className="detail-header">
          <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
            <ArrowLeft size={20} />
          </button>
          <span className="detail-title">日记</span>
        </header>
        <p className="faint list-hint">加载中…</p>
      </div>
    )
  }

  const titleLabel =
    diary.author === 'weekly' ? '周记' : diary.author === 'monthly' ? '月记' : diary.author === 'story' ? '故事' : '日记'

  return (
    <div className="page detail">
      <header className="detail-header">
        <button
          className="detail-back"
          onClick={editing ? exitEdit : () => navigate(-1)}
          aria-label="返回"
        >
          <ArrowLeft size={20} />
        </button>
        <span className="detail-title">{titleLabel}</span>
        <div className="detail-header__right">
          {editing && (
            <span className="faint" style={{ fontSize: 12, marginRight: 8 }}>
              {SAVE_TEXT[saveState]}
            </span>
          )}
          {diary.locked && <Lock size={16} className="faint" />}
          {!editing ? (
            <button
              className="set-btn"
              onClick={enterEdit}
              disabled={diary.locked}
              style={{ marginLeft: 8 }}
            >
              <Pencil size={12} /> 编辑
            </button>
          ) : (
            <button
              className="set-btn"
              onClick={exitEdit}
              style={{ marginLeft: 8 }}
            >
              <Check size={12} /> 完成
            </button>
          )}
        </div>
      </header>

      {editing ? (
        <>
          <input
            className="diary-edit__title"
            placeholder="标题（可留空）"
            value={work.title}
            onChange={(e) => set('title', e.target.value)}
          />
          <div className="diary-edit__meta">
            <input
              type="date"
              className="set-input"
              value={work.diary_date}
              onChange={(e) => set('diary_date', e.target.value)}
            />
            <button className="set-btn" onClick={toggleLock} disabled={busy}>
              <Lock size={12} /> {diary.locked ? '解锁' : '锁定'}
            </button>
            <button className="set-btn set-btn--danger" onClick={doDelete}>
              <Trash2 size={12} /> 删除
            </button>
          </div>
          <textarea
            className="diary-edit__content"
            placeholder="内容…"
            rows={20}
            value={work.content}
            onChange={(e) => set('content', e.target.value)}
          />
          <label className="diary-edit__author">
            <span className="faint">作者署名</span>
            <input
              className="set-input"
              placeholder="例：Emet · Claude Opus 4.6"
              value={work.author_label}
              onChange={(e) => set('author_label', e.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          {diary.title && <h1 className="diary-read__title">{diary.title}</h1>}
          <div className="faint diary-read__meta">
            {formatDateZh(diaryDate(diary))} {weekdayZh(diaryDate(diary))}
          </div>
          <div className="detail-read-body">{diary.content}</div>
          {diary.author_label && (
            <div className="diary-read__author">— {diary.author_label}</div>
          )}
          {!diary.author_label && diary.author === 'weekly' && (
            <div className="diary-read__author faint">— Emet · 自动生成</div>
          )}
          {!diary.author_label && diary.author === 'monthly' && (
            <div className="diary-read__author faint">— Emet · 自动生成</div>
          )}
        </>
      )}
    </div>
  )
}
