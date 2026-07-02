// 设置页：缓存保活开关（worker 定时重放请求快照，续期聊天的 prompt cache）
// 判读口诀：读 > 0 = 在省钱；写 ≈ 0 = 没在烧；连续写入会自动熔断暂停。

import { useEffect, useState } from 'react'
import { Flame, FlameKindling } from 'lucide-react'
import { keepaliveConfigGet, keepaliveConfigSet, keepaliveStatusGet } from '../api.js'
import { showToast } from '../utils/toast.js'

// "14:30" 式东八区时刻
function hhmm(iso) {
  if (!iso) return ''
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000)
  return d.toISOString().slice(11, 16)
}
// token 数简写：11400 → 11.4k
function k(n) {
  if (n == null) return '—'
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)
}

export default function KeepaliveToggle() {
  const [enabled, setEnabled] = useState(null) // null = loading
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)

  const loadStatus = () => {
    keepaliveStatusGet()
      .then((s) => setStatus(s))
      .catch(() => {})
  }

  useEffect(() => {
    let alive = true
    keepaliveConfigGet()
      .then((r) => alive && setEnabled(!!r?.config?.enabled))
      .catch(() => alive && setEnabled(false))
    loadStatus()
    return () => {
      alive = false
    }
  }, [])

  const toggle = async () => {
    if (busy || enabled === null) return
    setBusy(true)
    try {
      const next = !enabled
      await keepaliveConfigSet({ enabled: next })
      setEnabled(next)
      showToast(next ? '缓存保活已开启' : '缓存保活已关闭')
      loadStatus()
    } catch (e) {
      showToast(e?.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const text = enabled === null ? '检测中…' : enabled ? '已开启' : '已关闭'
  const last = status?.recent?.[0]
  const today = status?.today

  return (
    <div className="card set-card">
      <Row label="缓存保活">
        <span className="set-status">
          {enabled === true && <i className="status-dot status-dot--ok" />}
          {text}
        </span>
      </Row>
      {status?.paused && (
        <Row label="状态">
          <span style={{ color: '#c0392b', fontSize: 12 }}>{status.paused}</span>
        </Row>
      )}
      {enabled && last && (
        <Row label="上次">
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {hhmm(last.ts)} 读 {k(last.read)} / 写 {k(last.write)} {last.ok && (last.write || 0) < 1000 ? '✓' : '⚠'}
          </span>
        </Row>
      )}
      {enabled && today && (
        <Row label="今天">
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {today.beats} 次 · 读 {k(today.read)} / 写 {k(today.write)}
            {today.errors ? ` · 失败 ${today.errors}` : ''}
          </span>
        </Row>
      )}
      <Row label="操作">
        <button className={`set-btn ${enabled ? '' : 'set-btn--accent'}`} disabled={busy || enabled === null} onClick={toggle}>
          {enabled ? (
            <>
              <FlameKindling size={12} /> 关闭
            </>
          ) : (
            <>
              <Flame size={12} /> 开启
            </>
          )}
        </button>
      </Row>
      <p className="set-hint faint" style={{ marginTop: 8, marginBottom: 0 }}>
        开启后，白天（8:00–22:30）每隔约 30 分钟自动"热一下"聊天缓存，让你随时回来第一句都命中省钱。每次约花普通一句话 1/10
        的钱；距上次聊天超 5 小时自动停。判读：读 &gt; 0 = 在省钱；写 ≈ 0 = 没在烧；连续异常会自动暂停。开启后第一天请对照中转站消费明细核一次。
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
