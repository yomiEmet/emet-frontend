// Service Worker：PWA 可安装性 + 离线缓存 + Web Push 接收
// 见 docs/阶段0-web-push.md

const API_BASE = 'https://emet-memoty-v66.aandxiaobao.workers.dev'
const DB_NAME = 'emet-push'
const STORE = 'auth'
const KEY = 'admin-key'

// ── 离线缓存（app shell）──────────────────────────────────
// 网页本体/图标缓存到本地，断网也能打开 App。后端 API 跨域，一律放行不缓存。
// 改动缓存策略时把版本号 +1，activate 会清掉旧缓存。
const CACHE = 'emet-shell-v1'
// 安装时预存这些（带 hash 的 JS/CSS 文件名构建时才知道，靠运行时首次联网自动缓存）
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // 逐个存，某个缺失不阻塞安装
      await Promise.all(
        PRECACHE.map((u) =>
          fetch(u, { cache: 'no-cache' })
            .then((r) => (r && r.ok ? cache.put(u, r) : null))
            .catch(() => null),
        ),
      )
      self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清掉旧版本的 shell 缓存
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k.startsWith('emet-shell-') && k !== CACHE).map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return // 写请求不缓存
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // 后端 API 等跨域请求：放行不碰

  // 打开页面（SPA 导航）：网络优先，断网回落缓存的 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/index.html', copy)).catch(() => {})
          return res
        })
        .catch(async () => (await caches.match('/index.html')) || (await caches.match('/')) || Response.error()),
    )
    return
  }

  // 静态资源：缓存优先，命中直接用；未命中走网络并存下来
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      })
    }),
  )
})

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
