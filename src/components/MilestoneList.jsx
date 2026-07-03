import { useState } from 'react'
import { Pencil, Check, Plus } from 'lucide-react'
import { daysFromNow } from '../utils/time.js'
import { useLocalStorage } from '../utils/useLocalStorage.js'

// 纪念日列表 —— 可编辑（照 TodoList 的模式：localStorage + 设置云同步）。
// date 存 'YYYY-MM-DD' 字符串（Date 对象经 JSON 序列化回不来，是最大的坑）；
// 渲染时按本地年月日解析，避开 new Date('YYYY-MM-DD') 的 UTC 偏一天问题。
const DEFAULT = {
  seq: 3,
  items: [
    { id: 1, name: '一周年', date: '2026-04-06' },
    { id: 2, name: '记忆库诞生', date: '2026-04-25' },
    { id: 3, name: '离职', date: '2026-06-24' },
  ],
}

function parseYmd(s) {
  const [y, m, d] = (s || '').split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export default function MilestoneList() {
  const [state, setState] = useLocalStorage('emet.milestones', DEFAULT)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftDate, setDraftDate] = useState('')

  const items = [...(state.items || [])].sort((a, b) => (a.date < b.date ? -1 : 1))

  const patch = (id, p) =>
    setState((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...p } : it)) }))
  const remove = (id) => setState((s) => ({ ...s, items: s.items.filter((it) => it.id !== id) }))
  const add = () => {
    const name = draftName.trim()
    if (!name || !draftDate) return
    setState((s) => ({
      seq: s.seq + 1,
      items: [...s.items, { id: s.seq + 1, name, date: draftDate }],
    }))
    setDraftName('')
    setDraftDate('')
  }

  return (
    <div className="card milestones">
      <button
        className="milestones__edit faint"
        onClick={() => setEditing((e) => !e)}
        aria-label={editing ? '完成编辑' : '编辑纪念日'}
      >
        {editing ? <Check size={14} /> : <Pencil size={13} />}
      </button>

      {!editing &&
        items.map(({ id, name, date }) => {
          const diff = daysFromNow(parseYmd(date))
          const future = diff > 0
          const label = diff === 0 ? '就是今天' : future ? `还有 ${diff} 天` : `${-diff} 天前`
          return (
            <div className="milestone" key={id}>
              <span className="milestone__name">{name}</span>
              <span className="milestone__dots" />
              <span className={'milestone__when' + (future ? ' is-future' : '')}>{label}</span>
            </div>
          )
        })}
      {!editing && items.length === 0 && (
        <div className="milestone faint">还没有纪念日，点右上角铅笔加一条</div>
      )}

      {editing && (
        <div className="milestones__editor">
          {items.map((it) => (
            <div className="milestone-row" key={it.id}>
              <input
                className="milestone-row__name"
                value={it.name}
                placeholder="名称"
                onChange={(e) => patch(it.id, { name: e.target.value })}
              />
              <input
                className="milestone-row__date"
                type="date"
                value={it.date}
                onChange={(e) => e.target.value && patch(it.id, { date: e.target.value })}
              />
              <button className="milestone-row__del faint" onClick={() => remove(it.id)} aria-label="删除">
                ×
              </button>
            </div>
          ))}
          <div className="milestone-row is-add">
            <input
              className="milestone-row__name"
              value={draftName}
              placeholder="新纪念日…"
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <input
              className="milestone-row__date"
              type="date"
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
            />
            <button className="milestone-row__add" onClick={add} aria-label="添加">
              <Plus size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
