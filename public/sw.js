// 最小 Service Worker：只为满足 PWA 可安装性，不做离线缓存。
// （离线策略等四期"三套光"一起规划，避免缓存陈旧数据。）
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
