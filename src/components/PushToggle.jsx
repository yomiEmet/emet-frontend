// 设置页：Web Push 推送开关（规范单行：名称+说明+iOS开关；已开启时点行发测试推送）
// 见 docs/阶段0-web-push.md §5

import { useEffect, useState } from 'react'
import { getStatus, subscribe, unsubscribe } from '../utils/push.js'
import { pushSend } from '../api.js'
import { showToast } from '../utils/toast.js'
import { SetRow, IosSwitch } from './SettingRow.jsx'

// 一行版说明：正常态不啰嗦，被系统挡住时说清原因
const BLOCK_TEXT = {
  unsupported: '此浏览器不支持推送',
  'not-installed': '需先添加到主屏幕，从图标启动（iOS）',
  'not-permitted': '通知权限被拒，去系统设置里开启',
}

export default function PushToggle() {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    setStatus(await getStatus())
  }

  useEffect(() => {
    refresh()
    // PWA 从后台回到前台时刷新（用户可能去系统设置改了权限再回来）
    const onVisible = () => {
      if (!document.hidden) refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const doSubscribe = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await subscribe()
      if (r.ok) {
        showToast('推送已开启')
      } else if (r.reason === 'permission-denied') {
        showToast('未授予通知权限')
      } else if (r.reason === 'no-vapid-key') {
        showToast('后端未配置 VAPID 公钥')
      } else {
        showToast('开启失败')
      }
      await refresh()
    } catch (e) {
      showToast(e?.message || '开启失败')
    } finally {
      setBusy(false)
    }
  }

  const doUnsubscribe = async () => {
    if (busy) return
    setBusy(true)
    try {
      await unsubscribe()
      showToast('推送已关闭')
      await refresh()
    } catch (e) {
      showToast(e?.message || '关闭失败')
    } finally {
      setBusy(false)
    }
  }

  const doTest = async () => {
    if (busy) return
    setBusy(true)
    try {
      await pushSend({
        title: '测试',
        body: '如果你看到这条，说明推送通路打通了',
        source: 'test',
      })
      showToast('已触发测试推送，等一下系统通知…')
    } catch (e) {
      showToast(e?.message || '测试失败')
    } finally {
      setBusy(false)
    }
  }

  const blocked = status && BLOCK_TEXT[status]
  const on = status === 'subscribed'
  const desc = status === null ? '检测中…' : blocked || (on ? '点行发测试通知' : '聊天 / 做梦 / 守护的系统通知')

  return (
    <SetRow label="推送通知" desc={desc} onClick={on ? doTest : undefined}>
      <IosSwitch
        ariaLabel="推送通知开关"
        on={on}
        disabled={busy || status === null || !!blocked}
        onChange={on ? doUnsubscribe : doSubscribe}
      />
    </SetRow>
  )
}
