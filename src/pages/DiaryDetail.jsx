import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock, Trash2, MoreHorizontal } from 'lucide-react'
import { diaryGet, diaryDate, diaryUpdate, diaryDelete } from '../api.js'
import { dayKey, formatDateZh, weekdayZh } from '../utils/time.js'
import { showToast } from '../utils/toast.js'

const SAVE_TEXT = { idle: '', saving: '保存中…', saved: '已保存', error: '保存失败' }

// 日记 / 周记 / 月记 / 故事 共用详情页。永远 inline 可编辑——没有"进入编辑"切换，
// 字段就是输入框但视觉透明像正文。锁定时变只读。500ms 防抖 auto-save。
// 删除 / 锁定走右上角 ⋯ 菜单。
export default function DiaryDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [diary, setDiary] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [work, setWork] = useState(null)
  const [saveState, setSaveState] = useState('idle')
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const workRef = useRef(null)
  const timerRef = useRef(null)
  const savingRef = useRef(false)

  useEffect(() => {
    let alive = true
    diaryGet(id).then((d) => {
      if (!alive) return
      if (!d) setNotFound(true)
      else {
        setDiary(d)
        const w = {
          title: d.title || '',
          content: d.content || '',
          diary_date: d.diary_date || dayKey(),
          author_label: d.author_label || '',
        }
        setWork(w)
        workRef.current = w
      }
    })
    return () => {
      alive = false
    }
  }, [id])

  const set = (key, value) => {
    if (!workRef.current || diary?.locked) return
    const next = { ...workRef.current, [key]: value }
    workRef.current = next
    setWork(next)
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
    setMenuOpen(false)
    if (!diary || busy) return
    setBusy(true)
    try {
      await diaryUpdate(id, { locked: !diary.locked })
      const d = await diaryGet(id)
      setDiary(d)
      showToast(diary.locked ? '已解锁' : '已锁定')
    } catch (e) {
      showToast(e?.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    setMenuOpen(false)
    if (!diary) return
    if (diary.locked) {
      showToast('请先解锁')
      return
    }
    if (!window.confirm('确认删除？删除后不可恢复。')) return
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
  if (!diary || !work) {
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
    diary.author === 'weekly'
      ? '周记'
      : diary.author === 'monthly'
        ? '月记'
        : diary.author === 'story'
          ? '故事'
          : '日记'
  const readonly = !!diary.locked

  return (
    <div className="page detail">
      <header className="detail-header">
        <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <span className="detail-title">{titleLabel}</span>
        <div className="detail-header__right">
          {saveState !== 'idle' && (
            <span className="faint" style={{ fontSize: 12, marginRight: 8 }}>
              {SAVE_TEXT[saveState]}
            </span>
          )}
          {diary.locked && <Lock size={16} className="faint" />}
          <button
            className="set-btn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="更多"
            style={{ marginLeft: 8 }}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </header>

      {menuOpen && (
        <>
          <div className="tl-scrim tl-scrim--clear" onClick={() => setMenuOpen(false)} />
          <div className="sort-menu card">
            <button className="dm-opt" onClick={toggleLock} disabled={busy}>
              <Lock size={14} /> {diary.locked ? '解锁' : '锁定'}
            </button>
            <button className="dm-opt" onClick={doDelete}>
              <Trash2 size={14} /> 删除
            </button>
          </div>
        </>
      )}

      {/* 标题：透明 input 像 h1 */}
      <input
        className="diary-read__title"
        placeholder="标题（可留空）"
        value={work.title}
        readOnly={readonly}
        onChange={(e) => set('title', e.target.value)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          padding: 0,
          margin: '6px 0 4px',
          fontFamily: 'inherit',
        }}
      />

      {/* meta：日期 显示+可选切换；不直接暴露 date input 影响阅读 */}
      <div className="faint diary-read__meta">
        {formatDateZh(diaryDate(diary))} {weekdayZh(diaryDate(diary))}
      </div>

      {/* 正文：透明 textarea，行数随内容自适应（粗略），like normal text */}
      <textarea
        className="detail-read-body"
        placeholder="写点什么…"
        value={work.content}
        readOnly={readonly}
        onChange={(e) => set('content', e.target.value)}
        rows={Math.max(12, (work.content || '').split('\n').length + 2)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          padding: 0,
          fontFamily: 'inherit',
          fontSize: 'inherit',
          lineHeight: 'inherit',
          color: 'inherit',
          resize: 'vertical',
          whiteSpace: 'pre-wrap',
        }}
      />

      {/* author_label：底部署名 */}
      <div className="diary-read__author faint" style={{ marginTop: 16 }}>
        —{' '}
        <input
          value={work.author_label}
          readOnly={readonly}
          onChange={(e) => set('author_label', e.target.value)}
          placeholder="作者署名（例：Emet · Claude Opus 4.6）"
          style={{
            background: 'transparent',
            border: 'none',
            outline: 'none',
            padding: 0,
            fontFamily: 'inherit',
            fontSize: 'inherit',
            color: 'inherit',
            width: '70%',
          }}
        />
      </div>
    </div>
  )
}
