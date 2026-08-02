// 设置页：独处时间开关（项目书 2-2）——规范单行版
// Emet 在 10/15/18/22 点窗口按概率独处一次（每日最多 3 次）：写手账 / 写感悟 / 发动态 / 发呆。
// 产出只进独处手账和动态流，绝不写记忆库。

import { useEffect, useState } from 'react'
import { idleConfigGet, idleConfigSet } from '../api.js'
import { showToast } from '../utils/toast.js'
import { SetRow, IosSwitch } from './SettingRow.jsx'

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

  return (
    <SetRow label="独处时间" desc="白天窗口独处：写手账 / 发动态">
      <IosSwitch ariaLabel="独处时间开关" on={!!enabled} disabled={busy || enabled === null} onChange={toggle} />
    </SetRow>
  )
}
