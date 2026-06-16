// Service Worker：PWA 可安装性 + Web Push 接收
// 见 docs/阶段0-web-push.md

const API_BASE = 'https://emet-memoty-v66.aandxiaobao.workers.dev'
const DB_NAME = 'emet-push'
const STORE = 'auth'
const KEY = 'admin-key'

// 仍保留可安装性所需的最小生命周期
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})

// 内联 IndexedDB 读取 admin-key（SW 上下文不能 import ES 模块）
function getAdminKey() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      req.onsuccess = () => {
        const db = req.result
        try {
          const tx = db.transaction(STORE, 'readonly')
          const getReq = tx.objectStore(STORE).get(KEY)
          getReq.onsuccess = () => {
            resolve(getReq.result || null)
            db.close()
          }
          getReq.onerror = () => {
            resolve(null)
            db.close()
          }
        } catch {
          resolve(null)
          db.close()
        }
      }
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

// push 事件：拉最新内容，弹通知。失败也必须 showNotification 一次（userVisibleOnly 要求）
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let title = 'Emet'
      let body = '你有一条新消息'
      let url = '/'

      try {
        const adminKey = await getAdminKey()
        if (adminKey) {
          const resp = await fetch(`${API_BASE}/api/push/latest`, {
            headers: { 'X-Admin-Key': adminKey },
          })
          if (resp.ok) {
            const data = await resp.json()
            const n = data?.notification
            if (n) {
              title = n.title || title
              body = n.body || body
              url = n.url || url
            }
          }
        }
      } catch {
        // 走 fallback 文案
      }

      await self.registration.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url },
        requireInteraction: false,
      })
    })(),
  )
})

// 通知点击：focus 现有 PWA 窗口或开新窗口
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/'

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of all) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          await client.focus()
          if ('navigate' in client && !client.url.endsWith(target)) {
            try {
              await client.navigate(target)
            } catch {
              /* 跨域或权限拒绝时忽略 */
            }
          }
          return
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target)
    })(),
  )
})
