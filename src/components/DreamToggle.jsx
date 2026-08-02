// 设置页：做梦开关（项目书 2-3）——规范单行版（做梦 + 条件显示的推送子行）
// 凌晨 4-5 点（逻辑日刚切换）生成一条 ≤150 字的梦境动态（source=dream）。

import { useEffect, useState } from 'react'
import { dreamConfigGet, dreamConfigSet } from '../api.js'
import { showToast } from '../utils/toast.js'
import { SetRow, IosSwitch } from './SettingRow.jsx'

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

  return (
    <>
      <SetRow label="做梦" desc="凌晨 4–5 点做一个梦，发在动态流">
        <IosSwitch ariaLabel="做梦开关" on={!!cfg?.enabled} disabled={busy || cfg === null} onChange={toggle} />
      </SetRow>
      {cfg?.enabled && (
        <SetRow label="做梦后推送" desc="「Emet 做了一个梦」系统通知">
          <IosSwitch ariaLabel="做梦后推送开关" on={!!cfg.push} disabled={busy} onChange={togglePush} />
        </SetRow>
      )}
    </>
  )
}
