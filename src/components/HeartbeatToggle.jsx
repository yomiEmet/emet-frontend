// 设置页：心跳系统开关（AI 主动找静怡）——规范单行版
// 见 docs/阶段4-心跳系统.md

import { useEffect, useState } from 'react'
import { heartbeatConfigGet, heartbeatConfigSet } from '../api.js'
import { showToast } from '../utils/toast.js'
import { SetRow, IosSwitch } from './SettingRow.jsx'

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

  return (
    <SetRow label="主动消息" desc="Emet 按时段概率主动找你">
      <IosSwitch ariaLabel="主动消息开关" on={!!enabled} disabled={busy || enabled === null} onChange={toggle} />
    </SetRow>
  )
}
