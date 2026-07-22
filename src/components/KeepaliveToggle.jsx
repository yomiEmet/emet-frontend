// 设置页：缓存保活开关（worker 定时重放请求快照，续期聊天的 prompt cache）——规范单行版
// 说明行动态显示今天的次数/读写量；熔断暂停时显示原因。
// 判读口诀：读 > 0 = 在省钱；写 ≈ 0 = 没在烧；连续写入会自动熔断暂停。

import { useEffect, useState } from 'react'
import { keepaliveConfigGet, keepaliveConfigSet, keepaliveStatusGet } from '../api.js'
import { showToast } from '../utils/toast.js'
import { SetRow, IosSwitch } from './SettingRow.jsx'

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

  const today = status?.today
  const desc =
    enabled === null ? '检测中…'
    : status?.paused ? status.paused
    : enabled && today ? `今天 ${today.beats} 次 · 读 ${k(today.read)} / 写 ${k(today.write)}${today.errors ? ` · 失败 ${today.errors}` : ''}`
    : '定时热聊天缓存，回来第一句就省钱'

  return (
    <SetRow label="缓存保活" desc={desc}>
      <IosSwitch on={!!enabled} disabled={busy || enabled === null} onChange={toggle} />
    </SetRow>
  )
}
