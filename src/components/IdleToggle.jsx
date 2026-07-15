// 设置页：独处时间开关（项目书 2-2）
// Emet 在 10/15/18/22 点窗口按概率独处一次（每日最多 3 次）：写手账 / 写感悟 / 发动态 / 发呆。
// 产出只进独处手账和动态流，绝不写记忆库。

import { useEffect, useState } from 'react'
import { Coffee, CircleOff } from 'lucide-react'
import { idleConfigGet, idleConfigSet } from '../api.js'
import { showToast } from '../utils/toast.js'

export default function IdleToggle() {
  const [enabled, setEnabled] = useState(null) // null = loading
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    idleConfigGet()
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
      await idleConfigSet({ enabled: next })
      setEnabled(next)
      showToast(next ? '独处时间已开启' : '独处时间已关闭')
    } catch (e) {
      showToast(e?.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const text = enabled === null ? '检测中…' : enabled ? '已开启' : '已关闭'

  return (
    <div className="card set-card">
      <Row label="独处时间">
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
              <CircleOff size={12} /> 关闭
            </>
          ) : (
            <>
              <Coffee size={12} /> 开启
            </>
          )}
        </button>
      </Row>
      <p className="set-hint faint" style={{ marginTop: 8, marginBottom: 0 }}>
        开启后 Emet 会在 10 / 15 / 18 / 22 点窗口按概率独处一次（每天最多 3 次）：写手账、翻旧对话写感悟、发条动态，或者只是发呆。产出见「独处手账」和留言板的动态流，不会写进记忆库。
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
