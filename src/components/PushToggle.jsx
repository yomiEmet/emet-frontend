// 设置页：Web Push 推送开关
// 见 docs/阶段0-web-push.md §5

import { useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { getStatus, subscribe, unsubscribe } from '../utils/push.js'
import { pushSend } from '../api.js'
import { showToast } from '../utils/toast.js'

const STATUS_TEXT = {
  unsupported: '此浏览器不支持推送通知',
  'not-installed': '需要先把网站添加到主屏幕，从图标启动后才能开启推送（iOS 限制）',
  'not-permitted': '通知权限被拒绝过。去 设置 → 通知 → Emet 里手动开启',
  'not-subscribed': '未开启',
  subscribed: '已开启',
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

  const text = status ? STATUS_TEXT[status] : '检测中…'
  const showOk = status === 'subscribed'
  const showBad = status === 'unsupported' || status === 'not-permitted'

  return (
    <div className="card set-card">
      <Row label="状态">
        <span className="set-status">
          {showOk && <i className="status-dot status-dot--ok" />}
          {showBad && <i className="status-dot status-dot--bad" />}
          {text}
        </span>
      </Row>

      {status === 'not-subscribed' && (
        <Row label="操作">
          <button className="set-btn set-btn--accent" disabled={busy} onClick={doSubscribe}>
            <Bell size={12} /> 开启
          </button>
        </Row>
      )}

      {status === 'subscribed' && (
        <Row label="操作">
          <span className="set-inline" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="set-btn" disabled={busy} onClick={doTest}>
              测试
            </button>
            <button className="set-btn" disabled={busy} onClick={doUnsubscribe}>
              <BellOff size={12} /> 关闭
            </button>
          </span>
        </Row>
      )}
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
