// Web Push 前端订阅工具
// 见 docs/阶段0-web-push.md §5 / §7

import { getAdminKey } from '../api/client.js'
import { pushVapidKey, pushSubscribe, pushUnsubscribe } from '../api.js'
import { setAuthToken, deleteAuthToken } from './indexedDb.js'

// VAPID 公钥 base64url 字符串 → Uint8Array（pushManager.subscribe 的 applicationServerKey 要求）
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export function isIOS() {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandalone() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

// 状态机：unsupported / not-installed / not-permitted / not-subscribed / subscribed
export async function getStatus() {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return 'unsupported'
  }
  // iOS 必须 PWA standalone 模式才能用 Push API
  if (isIOS() && !isStandalone()) return 'not-installed'
  if (Notification.permission === 'denied') return 'not-permitted'

  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub ? 'subscribed' : 'not-subscribed'
  } catch {
    return 'not-subscribed'
  }
}

export async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported'
  return await Notification.requestPermission()
}

// 订阅流程：必须由用户手势触发（click/tap 回调里调）
export async function subscribe() {
  const permission = await requestPermission()
  if (permission !== 'granted') {
    return { ok: false, reason: 'permission-denied' }
  }

  const reg = await navigator.serviceWorker.ready

  // 已订阅时复用（幂等）
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    const { publicKey } = await pushVapidKey()
    if (!publicKey) return { ok: false, reason: 'no-vapid-key' }
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }

  const subJSON = sub.toJSON()
  // 后端注册订阅
  await pushSubscribe({
    endpoint: subJSON.endpoint,
    keys: { p256dh: subJSON.keys.p256dh, auth: subJSON.keys.auth },
  })

  // 当前 admin-key 同步到 IndexedDB，给 SW push event 用
  const adminKey = getAdminKey()
  if (adminKey) await setAuthToken(adminKey)

  return { ok: true, subscription: subJSON }
}

export async function unsubscribe() {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) await sub.unsubscribe()
  } catch {
    // 本地 unsubscribe 失败也继续清后端
  }
  await pushUnsubscribe().catch(() => {})
  await deleteAuthToken().catch(() => {})
  return { ok: true }
}
