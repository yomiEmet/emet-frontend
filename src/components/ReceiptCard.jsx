// 今日小票（四期 4-1）：超市小票风格的每日清单卡，按 4 点逻辑日切。
// 双端可记：静怡前端手动加；Emet 经 receipt_add 工具帮记（带小标记）。
// 自我门禁：emet.receipt.enabled 关闭时不渲染。

import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { receiptList, receiptAdd, receiptDelete } from '../api.js'
import { showToast } from '../utils/toast.js'
import { useLocalStorage } from '../utils/useLocalStorage.js'
import { nowLogical, dayKey } from '../utils/time.js'

export default function ReceiptCard() {
  const [cfg] = useLocalStorage('emet.receipt', { enabled: false })
  const [items, setItems] = useState(null)
  const [day, setDay] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!cfg?.enabled) return
    let alive = true
    receiptList()
      .then((r) => {
        if (!alive) return
        setItems(r.items || [])
        setDay(r.day || dayKey(nowLogical()))
      })
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [cfg?.enabled])

  if (!cfg?.enabled) return null

  const add = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      const r = await receiptAdd(t)
      setText('')
      setDay(r.day)
      setItems((prev) => [...(prev || []), r.item])
    } catch (e) {
      showToast(e?.message || '记录失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    if (busy) return
    setBusy(true)
    try {
      await receiptDelete(day, id)
      setItems((prev) => (prev || []).filter((i) => i.id !== id))
    } catch (e) {
      showToast(e?.message || '删除失败')
    } finally {
      setBusy(false)
    }
  }

  const dateLabel = day ? day.slice(5).replace('-', '.') : ''

  return (
    <section>
      <div className="section-label">今日小票</div>
      <div className="card receipt">
        <div className="receipt__head">
          <span className="receipt__title">EMET MART</span>
          <span className="receipt__date">{dateLabel}</span>
        </div>
        <div className="receipt__rule" />
        {items === null ? (
          <p className="faint receipt__empty">加载中…</p>
        ) : items.length === 0 ? (
          <p className="faint receipt__empty">今天还没有记录</p>
        ) : (
          <ul className="receipt__list">
            {items.map((it) => (
              <li key={it.id} className="receipt__item">
                <span className="receipt__dot">·</span>
                <span className="receipt__text">{it.text}</span>
                {it.added_by === 'emet' && <span className="receipt__by">Emet</span>}
                <button
                  className="receipt__del faint"
                  onClick={() => remove(it.id)}
                  aria-label="删除"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="receipt__rule" />
        <div className="receipt__add">
          <input
            value={text}
            placeholder="记一笔…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) add()
            }}
          />
          <button className="receipt__add-btn" disabled={!text.trim() || busy} onClick={add} aria-label="添加">
            <Plus size={16} />
          </button>
        </div>
      </div>
    </section>
  )
}
