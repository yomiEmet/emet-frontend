// 设置页：做梦开关（项目书 2-3）
// 凌晨 4-5 点（逻辑日刚切换）生成一条 ≤150 字的梦境动态（source=dream）。
// 子开关：做梦后发一条 Web Push（「Emet 做了一个梦」）。

import { useEffect, useState } from 'react'
import { MoonStar, CircleOff, BellRing, BellOff } from 'lucide-react'
import { dreamConfigGet, dreamConfigSet } from '../api.js'
import { showToast } from '../utils/toast.js'

export default function DreamToggle() {
  const [cfg, setCfg] = useState(null) // null = loading; { enabled, push }
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    dreamConfigGet()
      .then((r) => alive && setCfg({ enabled: !!r?.config?.enabled, push: !!r?.config?.push }))
      .catch(() => alive && setCfg({ enabled: false, push: false }))
    return () => {
      alive = false
    }
  }, [])

  const save = async (next) => {
    if (busy || !cfg) return false
    setBusy(true)
    try {
      await dreamConfigSet(next)
      setCfg(next)
      return true
    } catch (e) {
      showToast(e?.message || '操作失败')
      return false
    } finally {
      setBusy(false)
    }
  }

  const toggle = async () => {
    const next = { ...cfg, enabled: !cfg.enabled }
    if (await save(next)) showToast(next.enabled ? '做梦已开启' : '做梦已关闭')
  }
  const togglePush = () => save({ ...cfg, push: !cfg.push })

  const text = cfg === null ? '检测中…' : cfg.enabled ? '已开启' : '已关闭'

  return (
    <div className="card set-card">
      <Row label="做梦">
        <span className="set-status">
          {cfg?.enabled && <i className="status-dot status-dot--ok" />}
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
              <CircleOff size={12} /> 关闭
            </>
          ) : (
            <>
              <MoonStar size={12} /> 开启
            </>
          )}
        </button>
      </Row>
      {cfg?.enabled && (
        <Row label="做梦后推送">
          <button className="set-btn" disabled={busy} onClick={togglePush}>
            {cfg.push ? (
              <>
                <BellRing size={12} /> 开
              </>
            ) : (
              <>
                <BellOff size={12} /> 关
              </>
            )}
          </button>
        </Row>
      )}
      <p className="set-hint faint" style={{ marginTop: 8, marginBottom: 0 }}>
        开启后 Emet 会在凌晨 4-5 点做一个梦，写成动态（带「梦」标）发在留言板动态流里。梦是意象化的，不解释含义。
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
