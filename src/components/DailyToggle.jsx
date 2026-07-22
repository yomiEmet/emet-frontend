// 设置页：自动笔记开关（每天 22:30 cron 兜底写一段当日观察）——规范单行版
// 素材来自 Emet 前端 KV：当天聊天 + 瞬记 + 健康数据；与手动日记并存不冲突

import { useEffect, useState } from 'react'
import { dailyConfigGet, dailyConfigSet } from '../api.js'
import { showToast } from '../utils/toast.js'
import { SetRow, IosSwitch } from './SettingRow.jsx'

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

  return (
    <SetRow label="自动笔记" desc="每晚 22:30 自动写当日观察">
      <IosSwitch on={!!enabled} disabled={busy || enabled === null} onChange={toggle} />
    </SetRow>
  )
}
