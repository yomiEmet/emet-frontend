// 设置页：动态回应开关（朋友圈化改造）
// 开着时，静怡发的动态 Emet 会在 10-20 分钟后「路过」：可能点赞、可能评论；
// 她在任何动态下留的评论，他 3-8 分钟后会回，评论链能来回聊。
// 默认开——这不是 AI 自主产出（独处/做梦那种），是她发了东西他才回应，有明确因果。

import { useEffect, useState } from 'react'
import { feedReactConfigGet, feedReactConfigSet } from '../api.js'
import { showToast } from '../utils/toast.js'
import { SetRow, IosSwitch } from './SettingRow.jsx'

export default function FeedReactToggle() {
  const [enabled, setEnabled] = useState(null) // null = loading
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    feedReactConfigGet()
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
      await feedReactConfigSet({ enabled: next })
      setEnabled(next)
      showToast(next ? '动态回应已开启' : '动态回应已关闭')
    } catch (e) {
      showToast(e?.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SetRow label="动态回应" desc="Emet 会路过你的动态：点赞、评论、接话">
      <IosSwitch on={!!enabled} disabled={busy || enabled === null} onChange={toggle} />
    </SetRow>
  )
}
