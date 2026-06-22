// 设置页：凌晨守护开关（iOS app 事件触发，凌晨时段催睡）
// 后端 POST 要求 5 字段齐，所以 toggle 时先拿完整 config，只翻转 enabled

import { useEffect, useState } from 'react'
import { Moon, MoonStar } from 'lucide-react'
import { nightGuardConfigGet, nightGuardConfigSet } from '../api.js'
import { showToast } from '../utils/toast.js'

export default function NightGuardToggle() {
  const [cfg, setCfg] = useState(null) // null = loading
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    nightGuardConfigGet()
      .then((r) => alive && setCfg(r?.config || null))
      .catch(() => alive && setCfg(null))
    return () => {
      alive = false
    }
  }, [])

  const toggle = async () => {
    if (busy || !cfg) return
    setBusy(true)
    try {
      const next = { ...cfg, enabled: !cfg.enabled }
      await nightGuardConfigSet(next)
      setCfg(next)
      showToast(next.enabled ? '凌晨守护已开启' : '凌晨守护已关闭')
    } catch (e) {
      showToast(e?.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const text = cfg === null ? '检测中…' : cfg.enabled ? '已开启' : '已关闭'

  return (
    <div className="card set-card">
      <Row label="凌晨守护">
        <span className="set-status">
          {cfg?.enabled === true && <i className="status-dot status-dot--ok" />}
          {text}
        </span>
      </Row>
      <Row label="操作">
        <button
          className={`set-btn ${cfg?.enabled ? '' : 'set-btn--accent'}`}
          disabled={busy || cfg === null}
          onClick={toggle}
        >
          {cfg?.enabled ? (
            <>
              <Moon size={12} /> 关闭
            </>
          ) : (
            <>
              <MoonStar size={12} /> 开启
            </>
          )}
        </button>
      </Row>
      <p className="set-hint faint" style={{ marginTop: 8, marginBottom: 0 }}>
        开启后 iOS 在凌晨时段（默认 23:30-03:00）打开监控 app 会触发 Emet 催睡推送。
        监控应用、时段、冷却时间在后端 config:night-guard 调整。
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
