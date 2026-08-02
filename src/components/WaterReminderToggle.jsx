// 设置页：喝水提醒开关（worker cron 每 30 分钟检查：白天时段 + 落后进度 + 距上次超间隔才推送）
// 详细设置（间隔）在 /water 详情页里。

import { useEffect, useState } from 'react'
import { waterReminderConfigGet, waterReminderConfigSet } from '../api.js'
import { showToast } from '../utils/toast.js'
import { SetRow, IosSwitch } from './SettingRow.jsx'

export default function WaterReminderToggle() {
  const [cfg, setCfg] = useState(null) // null = loading
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    waterReminderConfigGet()
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
      const r = await waterReminderConfigSet({ enabled: !cfg.enabled })
      setCfg(r?.config || { ...cfg, enabled: !cfg.enabled })
      showToast(!cfg.enabled ? '喝水提醒已开启' : '喝水提醒已关闭')
    } catch (e) {
      showToast(e?.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const desc = cfg
    ? `${cfg.start_hour}:00–${cfg.end_hour}:00 落后进度才推送`
    : '检测中…'

  return (
    <SetRow label="喝水提醒" desc={desc}>
      <IosSwitch ariaLabel="喝水提醒开关" on={!!cfg?.enabled} disabled={busy || cfg === null} onChange={toggle} />
    </SetRow>
  )
}
