import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock, Trash2, MoreHorizontal, Pencil, Check, ChevronLeft } from 'lucide-react'
import { diaryGet, diaryDate, diaryUpdate, diaryDelete, memoryMove } from '../api.js'
import { dayKey, formatDateZh, weekdayZh } from '../utils/time.js'
import { showToast } from '../utils/toast.js'

const SAVE_TEXT = { idle: '', saving: '保存中…', saved: '已保存', error: '保存失败' }

// 移动到…六类互转。当前类型 diary 或 story（author='story' 视为 story）会从列表里被剔除
const ALL_MOVE_TYPES = [
  ['memory', '记忆'],
  ['moment', '瞬记'],
  ['diary', '日记'],
  ['story', '故事'],
  ['message', '便条'],
  ['idea', '想法'],
]

// 日记 / 周记 / 月记 / 故事 共用详情页。仿 MemoryDetail 的双模式：
// - 读态：标题 / meta / 正文 / 署名 像原版纯文字流，跟随页面滚动，不带任何输入框
// - 编辑态（点 ✎ 切换）：inputs / textarea，textarea 高度自适应内容不出现滚动条
// 删除 / 锁定走右上角 ⋯ 菜单。
export default function DiaryDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [diary, setDiary] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [editing, setEditing] = useState(false)
  const [work, setWork] = useState(null)
  const [saveState, setSaveState] = useState('idle')
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState('') // '' | 'main' | 'move'
  const workRef = useRef(null)
  const timerRef = useRef(null)
  const savingRef = useRef(false)
  const textareaRef = useRef(null)

  // textarea 自适应高度：每次内容变化 + 进入编辑态时调整
  const adjustHeight = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }
  useEffect(() => {
    if (editing) {
      // 等下一帧 DOM 真渲染了再调高度
      requestAnimationFrame(adjustHeight)
    }
  }, [editing, work?.content])

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

  const startEdit = () => {
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

  const finishEdit = async () => {
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

  const set = (key, value) => {
    if (!workRef.current) return
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

  // 当前实际类型：story 是 diary 的子类（author='story'）
  const curType = diary?.author === 'story' ? 'story' : 'diary'
  const moveTypes = ALL_MOVE_TYPES.filter(([k]) => k !== curType)

  const toggleLock = async () => {
    setMenu('')
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

  const doMove = async (to, label) => {
    setMenu('')
    if (!diary) return
    if (diary.locked) {
      showToast('请先解锁')
      return
    }
    try {
      await memoryMove(diary.id, curType, to)
      showToast('已移动到 ' + label)
      navigate(-1)
    } catch (e) {
      showToast(e?.message || '移动失败')
    }
  }

  const doDelete = async () => {
    setMenu('')
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
    diary.author === 'weekly'
      ? '周记'
      : diary.author === 'monthly'
        ? '月记'
        : diary.author === 'story'
          ? '故事'
          : '日记'
  const headerTitle = editing ? SAVE_TEXT[saveState] || titleLabel : titleLabel

  // 编辑态用的透明输入框样式（看起来跟正文一样）
  const transparentInput = {
    width: '100%',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    padding: 0,
    margin: 0,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'inherit',
    color: 'inherit',
    lineHeight: 'inherit',
  }

  return (
    <div className="page detail">
      <header className="detail-header">
        <button className="detail-back" onClick={() => navigate(-1)} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <span className="detail-title">{headerTitle}</span>
        <div className="detail-header__right">
          {diary.locked && <Lock size={16} className="faint" />}
          {!editing && !diary.locked && (
            <button className="detail-edit-btn" onClick={startEdit} aria-label="编辑">
              <Pencil size={15} /> 编辑
            </button>
          )}
          {editing && (
            <button className="detail-edit-btn" onClick={finishEdit} aria-label="完成">
              <Check size={15} /> 完成
            </button>
          )}
          <button
            className="detail-more"
            onClick={() => setMenu(menu ? '' : 'main')}
            aria-label="更多"
          >
            <MoreHorizontal size={20} />
          </button>
        </div>
      </header>

      {menu && (
        <>
          <div className="tl-scrim tl-scrim--clear" onClick={() => setMenu('')} />
          <div className="sort-menu card">
            {menu === 'main' ? (
              <>
                <button className="dm-opt" onClick={toggleLock} disabled={busy}>
                  <Lock size={14} /> {diary.locked ? '解锁' : '锁定'}
                </button>
                {!diary.locked && (
                  <button className="dm-opt" onClick={() => setMenu('move')}>
                    移动到… <span className="faint">›</span>
                  </button>
                )}
                <button className="dm-opt" onClick={doDelete}>
                  <Trash2 size={14} /> 删除
                </button>
              </>
            ) : (
              <>
                <button className="dm-opt dm-back" onClick={() => setMenu('main')}>
                  <ChevronLeft size={14} /> 移动到
                </button>
                {moveTypes.map(([k, label]) => (
                  <button key={k} className="dm-opt" onClick={() => doMove(k, label)}>
                    {label}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}

      {/* 标题 */}
      {editing ? (
        <input
          className="diary-read__title"
          placeholder="标题（可留空）"
          value={work.title}
          onChange={(e) => set('title', e.target.value)}
          style={{ ...transparentInput, margin: '6px 0 4px' }}
        />
      ) : (
        diary.title && <h1 className="diary-read__title">{diary.title}</h1>
      )}

      {/* meta：日期 + 周几（读态直接文字；编辑态也只显示文字，date input 隐去避免视觉散乱） */}
      <div className="faint diary-read__meta">
        {formatDateZh(diaryDate(diary))} {weekdayZh(diaryDate(diary))}
      </div>

      {/* 正文：读态纯文字流，编辑态自适应高度 textarea（无滚动） */}
      {editing ? (
        <textarea
          ref={textareaRef}
          className="detail-read-body"
          placeholder="写点什么…"
          value={work.content}
          onChange={(e) => {
            set('content', e.target.value)
            // 当帧立刻调高度（避免渲染抖动）
            requestAnimationFrame(adjustHeight)
          }}
          style={{
            ...transparentInput,
            resize: 'none',
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            display: 'block',
          }}
        />
      ) : (
        <div className="detail-read-body">{diary.content}</div>
      )}

      {/* author_label 底部署名 */}
      {editing ? (
        <div className="diary-read__author faint" style={{ marginTop: 16 }}>
          —{' '}
          <input
            value={work.author_label}
            onChange={(e) => set('author_label', e.target.value)}
            placeholder="作者署名（例：Emet · Claude Opus 4.6）"
            style={{ ...transparentInput, width: '80%' }}
          />
        </div>
      ) : (
        (diary.author_label || diary.author === 'weekly' || diary.author === 'monthly') && (
          <div className="diary-read__author faint" style={{ marginTop: 16 }}>
            — {diary.author_label || 'Emet · 自动生成'}
          </div>
        )
      )}
    </div>
  )
}
