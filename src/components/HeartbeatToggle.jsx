// 设置页：心跳系统开关（AI 主动找静怡）
// 见 docs/阶段4-心跳系统.md

import { useEffect, useState } from 'react'
import { Heart, HeartOff } from 'lucide-react'
import { heartbeatConfigGet, heartbeatConfigSet } from '../api.js'
import { showToast } from '../utils/toast.js'

export default function HeartbeatToggle() {
  const [enabled, setEnabled] = useState(null) // null = loading
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    heartbeatConfigGet()
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
      await heartbeatConfigSet({ enabled: next })
      setEnabled(next)
      showToast(next ? '主动消息已开启' : '主动消息已关闭')
    } catch (e) {
      showToast(e?.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const text = enabled === null ? '检测中…' : enabled ? '已开启' : '已关闭'

  return (
    <div className="card set-card">
      <Row label="主动消息">
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
              <HeartOff size={12} /> 关闭
            </>
          ) : (
            <>
              <Heart size={12} /> 开启
            </>
          )}
        </button>
      </Row>
      <p className="set-hint faint" style={{ marginTop: 8, marginBottom: 0 }}>
        开启后 Emet 会按时段概率（早安 / 午休 / 下班 / 晚上 / 夜猫子 / 周末白天）主动给你发消息，距上次至少 2 小时。凌晨 1-7 点静默。
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
