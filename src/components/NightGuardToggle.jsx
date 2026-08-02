// 设置页：凌晨守护开关（iOS app 事件触发，凌晨时段催睡）——规范单行版
// 后端 POST 要求 5 字段齐，所以 toggle 时先拿完整 config，只翻转 enabled

import { useEffect, useState } from 'react'
import { nightGuardConfigGet, nightGuardConfigSet } from '../api.js'
import { showToast } from '../utils/toast.js'
import { SetRow, IosSwitch } from './SettingRow.jsx'

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

  return (
    <SetRow label="凌晨守护" desc="23:30–03:00 催睡提醒">
      <IosSwitch ariaLabel="凌晨守护开关" on={!!cfg?.enabled} disabled={busy || cfg === null} onChange={toggle} />
    </SetRow>
  )
}
