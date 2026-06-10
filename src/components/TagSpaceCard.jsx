import { useState } from 'react'
import { X, Plus, Check } from 'lucide-react'

// 标签空间 card 模式（旧版 C1）：当前这条记忆的标签管理面板。
// 重命名/删除/添加都通过 onChange(tags) 交给父级落库。
export default function TagSpaceCard({ tags, onChange, onClose, onOpenTag, onOpenAll }) {
  const [editIdx, setEditIdx] = useState(-1)
  const [editVal, setEditVal] = useState('')
  const [addVal, setAddVal] = useState('')

  const startRename = (i) => {
    setEditIdx(i)
    setEditVal(tags[i])
  }

  const commitRename = () => {
    const v = editVal.trim().replace(/^#/, '')
    if (v && v !== tags[editIdx] && !tags.includes(v)) {
      const next = [...tags]
      next[editIdx] = v
      onChange(next)
    }
    setEditIdx(-1)
    setEditVal('')
  }

  const remove = (i) => {
    if (editIdx === i) setEditIdx(-1)
    onChange(tags.filter((_, x) => x !== i))
  }

  const add = () => {
    const v = addVal.trim().replace(/^#/, '')
    setAddVal('')
    if (!v || tags.includes(v)) return
    onChange([...tags, v])
  }

  return (
    <>
      <div className="ts-scrim" onClick={onClose} />
      <div className="ts-panel card">
        <div className="ts-head">
          <span className="ts-title">标签</span>
          <button className="ts-goall" onClick={onOpenAll}>全部 ›</button>
          <button className="ts-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </div>

        <div className="ts-card-list">
          {tags.length === 0 ? (
            <p className="faint ts-empty">还没有标签</p>
          ) : (
            tags.map((t, i) => (
              <div key={t} className="tsc-item">
                {editIdx === i ? (
                  <span className="tsc-rename">
                    <input
                      autoFocus
                      value={editVal}
                      onChange={(e) => setEditVal(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && commitRename()}
                      onBlur={commitRename}
                    />
                    <button onClick={commitRename} aria-label="确认"><Check size={14} /></button>
                  </span>
                ) : (
                  <>
                    <span className="tsc-name" onClick={() => onOpenTag(t)}>#{t}</span>
                    <span className="tsc-actions">
                      <button className="tsc-edit" onClick={() => startRename(i)}>编辑</button>
                      <button className="tsc-del" onClick={() => remove(i)} aria-label="删除"><X size={14} /></button>
                    </span>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        <div className="ts-add">
          <input
            value={addVal}
            placeholder="#添加标签"
            onChange={(e) => setAddVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button onClick={add} aria-label="添加"><Plus size={15} /></button>
        </div>
      </div>
    </>
  )
}
