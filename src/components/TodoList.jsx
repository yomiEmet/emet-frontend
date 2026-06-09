import { useState } from 'react'
import { Plus, Check } from 'lucide-react'
import { useLocalStorage } from '../utils/useLocalStorage.js'

// 待办清单 —— 本地存储。可打勾、可新增、可删除。
// id 用递增计数器（避免 Math.random / Date.now 依赖），存进 localStorage。
export default function TodoList() {
  const [state, setState] = useLocalStorage('emet.todos', { seq: 0, items: [] })
  const [draft, setDraft] = useState('')

  const add = () => {
    const text = draft.trim()
    if (!text) return
    setState((s) => ({
      seq: s.seq + 1,
      items: [...s.items, { id: s.seq + 1, text, done: false }],
    }))
    setDraft('')
  }

  const toggle = (id) =>
    setState((s) => ({
      ...s,
      items: s.items.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    }))

  const remove = (id) =>
    setState((s) => ({ ...s, items: s.items.filter((t) => t.id !== id) }))

  return (
    <div className="card todo">
      <div className="todo__head">
        <span className="section-label" style={{ margin: 0 }}>
          待办
        </span>
      </div>

      <ul className="todo__list">
        {state.items.length === 0 && (
          <li className="todo__empty faint">还没有待办，加一条吧</li>
        )}
        {state.items.map((t) => (
          <li key={t.id} className={'todo__item' + (t.done ? ' is-done' : '')}>
            <button
              className="todo__check"
              onClick={() => toggle(t.id)}
              aria-label={t.done ? '标记未完成' : '标记完成'}
            >
              {t.done && <Check size={13} strokeWidth={3} />}
            </button>
            <span className="todo__text" onClick={() => toggle(t.id)}>
              {t.text}
            </span>
            <button
              className="todo__del faint"
              onClick={() => remove(t.id)}
              aria-label="删除"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div className="todo__add">
        <input
          className="todo__input"
          value={draft}
          placeholder="新增待办…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="todo__add-btn" onClick={add} aria-label="新增">
          <Plus size={18} />
        </button>
      </div>
    </div>
  )
}
