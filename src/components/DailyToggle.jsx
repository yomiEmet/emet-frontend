// 设置页：自动笔记开关（每天 22:30 cron 兜底写一段当日观察）
// 素材来自 Emet 前端 KV：当天聊天 + 瞬记 + 健康数据
// 不与 chat 那边手动写的日记冲突——两套并存，author 字段区分

import { useEffect, useState } from 'react'
import { NotebookPen, Notebook } from 'lucide-react'
import { dailyConfigGet, dailyConfigSet } from '../api.js'
import { showToast } from '../utils/toast.js'

export default function DailyToggle() {
  const [enabled, setEnabled] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    dailyConfigGet()
      .then((r) => alive && setEnabled(!!r?.config?.enabled))
      .catch(() => alive && setEnabled(false))
    return () => {
      alive = false
    }
  }, [])

  const toggle = async () => {
    if (busy || enabled === null) return
    setBusy(true)
    try {
      const next = !enabled
      await dailyConfigSet({ enabled: next })
      setEnabled(next)
      showToast(next ? '自动笔记已开启' : '自动笔记已关闭')
    } catch (e) {
      showToast(e?.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const text = enabled === null ? '检测中…' : enabled ? '已开启' : '已关闭'

  return (
    <div className="card set-card">
      <Row label="自动笔记">
        <span className="set-status">
          {enabled === true && <i className="status-dot status-dot--ok" />}
          {text}
        </span>
      </Row>
      <Row label="操作">
        <button
          className={`set-btn ${enabled ? '' : 'set-btn--accent'}`}
          disabled={busy || enabled === null}
          onClick={toggle}
        >
          {enabled ? (
            <>
              <Notebook size={12} /> 关闭
            </>
          ) : (
            <>
              <NotebookPen size={12} /> 开启
            </>
          )}
        </button>
      </Row>
      <p className="set-hint faint" style={{ marginTop: 8, marginBottom: 0 }}>
        开启后每天 22:30 自动写一段当日观察，素材来自 Emet 这边的聊天、瞬记、健康数据。
        和 chat 那边手动写的日记并存，不冲突。素材太少会自动跳过。
      </p>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="set-row">
      <span className="set-row__label">{label}</span>
      <span className="set-row__val">{children}</span>
    </div>
  )
}
