# 阶段 0：Web Push 基础接入方案

> 红线声明：本方案只读代码产出，**未编辑 worker.js、未部署、未动前端**。所有改动由静怡审过本方案后再分 0-B / 0-C 落地。
> 参考：[Cheiineeey/Matt](https://github.com/Cheiineeey/Matt) 是 always-here 的前置篇，用 Python pywebpush 实现完整 RFC 8291；本方案借它"VAPID + SW + Push API"骨架，但**走无负载路线**避开 RFC 8291 加密。
> 关联：[Apple WebKit 官方 Web Push for Web Apps on iOS 16.4+](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)、[Cloudflare Agents push-notifications guide](https://developers.cloudflare.com/agents/guides/push-notifications/)。

---

## 1. 目标与范围

**目标**：让静怡 iPhone（已添加到主屏幕的 PWA）从 Emet 后端收到真正的系统级推送通知（锁屏横幅 / 通知中心 / 声音震动），打通后续阶段「AI 主动找你说话」的下行通道。

**本期（阶段 0）做**：
- VAPID 密钥对生成 + 存 KV
- iPhone 端订阅注册流程（PWA 模式 + 用户手势触发）
- Worker 端 4 条新路由
- 一条无负载推送 + SW fetch 回拉内容的最小回路
- 桌面 Chrome + iPhone 双端冒烟测试

**本期不做**：
- RFC 8291 payload 加密（留给阶段 1 提速时再上）
- 多设备订阅（当前单用户，单 subscription）
- 推送内容生成的 AI 调用（阶段 1）
- 推送频率/调度策略（阶段 1）

---

## 2. 架构数据流

### 流向 A：订阅（一次性）

```
iPhone PWA                        Worker                       KV
   │                                │                          │
   │  1. GET /api/push/vapid-public-key
   │  ─────────────────────────────▶│
   │  ◀────── { publicKey } ────────│  ← 从 KV 读 push:vapid
   │                                │
   │  2. pushManager.subscribe(publicKey)
   │  浏览器与 Apple Push Service 协商，
   │  返回 endpoint + keys{p256dh, auth}
   │                                │
   │  3. POST /api/push/subscribe   │
   │     X-Admin-Key + body=subscription
   │  ─────────────────────────────▶│
   │                                │  4. kvPut("push:subscription", sub)
   │  ◀────── { success: true } ────│
   │                                │
   │  5. 把 X-Admin-Key 写进 IndexedDB
   │     （后续 SW fetch 用，localStorage 在 SW 里不可见）
```

### 流向 B：服务端主动推送（每次触发）

```
Worker 业务逻辑               Push Service                  iPhone
（写日记/health 异常等）   （Apple/Mozilla autopush）       PWA
   │                              │                          │
   │  1. kvPut("push:notification:latest", { title, body, url, ts })
   │                              │                          │
   │  2. 取 push:subscription     │                          │
   │  3. 用 Web Crypto 现签 VAPID JWT (ES256)
   │  4. POST <subscription.endpoint>
   │     Authorization: vapid t=<JWT>, k=<publicKey base64url>
   │     TTL: 60, Urgency: normal
   │     Body: 空 (Content-Length: 0)
   │  ───────────────────────────▶│                          │
   │  ◀── 201 Created / 410 Gone ─│                          │
   │                              │                          │
   │  若 410 → 删 push:subscription，等用户重新订阅           │
   │                              │  5. Push Service 投递    │
   │                              │  ────────────────────────▶│
   │                              │                          │  6. SW push event
   │                              │                          │     event.data === null
   │                              │                          │  7. SW fetch GET
   │                              │                          │     /api/push/latest
   │                              │                          │     X-Admin-Key from IndexedDB
   │  ◀──────────────────────────────────────────────────────│
   │  返回 push:notification:latest 内容                       │
   │  ──────────────────────────────────────────────────────▶│
   │                              │                          │  8. showNotification(title, body)
   │                              │                          │  系统通知弹出 🎉
```

### 流向 C：用户点击通知

```
iPhone 锁屏 / 通知中心 → 点击 → SW notificationclick →
  matchAll({type:'window'}) → 找到 PWA window → focus
  或 clients.openWindow(notification.data.url) → 拉起 PWA
```

### 流向 D：用户关闭/撤销订阅

```
PWA 设置页 → 点"关闭通知" →
  reg.pushManager.getSubscription().unsubscribe() →
  DELETE /api/push/subscribe (清 KV) →
  IndexedDB 删 push-fetch-token
```

---

## 3. 关键技术决策

### 决策 1：走「无负载推送」而非 RFC 8291 加密

**做法**：POST 给 Push Service 的请求体为空，靠 SW 收到 push 事件后再 fetch 回 Worker 拿真实内容。

**理由**：
- VAPID JWT（ES256 签名）= Web Crypto API 一个 `subtle.sign` 调用，极简
- RFC 8291 payload 加密 = ECDH 协商 + HKDF + AES-128-GCM，Worker 上要手写一两百行 crypto 代码
- 多一次 fetch 的延迟（典型 100-300ms）静怡这个场景接受得起；用来换 100+ 行代码的复杂度划算
- 后续若延迟成瓶颈，再切换到 `@block65/webcrypto-web-push` 或 `pushforge`（两者都纯 Web Crypto、零依赖、CF Workers 兼容，迁移成本小）

**取舍记录**：[Cloudflare Agents 官方 guide](https://developers.cloudflare.com/agents/guides/push-notifications/) 推荐的是 `npm install web-push`——但那是 Durable Objects 启用 Node compat 的语境，**普通 Worker 用不了** node 版 web-push（`crypto.createECDH is not a function`）。

### 决策 2：VAPID JWT 自己用 Web Crypto API 签

**做法**：Worker 顶层加一个 `signVapidJWT(audience, privateJwk)` helper，约 40 行，输出 `vapid t=<JWT>, k=<publicKey>` 这个 Authorization 头格式。

**算法**：
- header: `{"typ":"JWT","alg":"ES256"}`
- payload: `{"aud":"<origin of endpoint>","exp":<now+12h>,"sub":"mailto:aandxiaobao@gmail.com"}`
- 签名：`crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"}, key, headerB64 + "." + payloadB64)`
- 输出：`headerB64.payloadB64.signatureB64`（全部 base64url 无填充）

**密钥来源**：方案 a（在 Worker 上一次性 `crypto.subtle.generateKey` + 存 KV）vs 方案 b（本地 openssl 生成、塞 wrangler secret）。建议 **a**——一切自包含，KV 已经被信任为唯一持久层。

### 决策 3：subscription 存 KV，单用户单条

**做法**：键 `push:subscription`，值 `{endpoint, keys:{p256dh,auth}, created_at, ua}`，**整库只有一条**——与 Matt 的 SQLite 单行模式同构、与现有 health/archive/settings KV 风格一致。

**多设备何时拓展**：若静怡之后想 iPad 也收，把键改成 `push:subscription:<deviceId>` + 加列表枚举接口。这次不做。

### 决策 4：SW fetch 用 IndexedDB 里的 admin key 鉴权

**做法**：订阅成功后，前端往 IndexedDB（数据库名 `emet-push`，store 名 `auth`，键 `admin-key`）写一份当前 X-Admin-Key 副本。SW 在 push 事件里 fetch `/api/push/latest` 时带上这个头。

**为什么不用 localStorage**：Service Worker 上下文里 `localStorage` 不可见，必须用 IndexedDB 或 Cache API。

**安全代价**：IndexedDB 里有一份 admin key 明文。本系统是单用户 PWA，admin key 已经在 localStorage 里也明文，新增风险面≈0。

### 决策 5：路由继续走 `checkMcpAuth` 双鉴权（X-Admin-Key 或 ?key=）

**做法**：跟 `/api/health` 一组挂法，在 `routeRequest` 里加 `if (path.startsWith("/api/push/"))` 分支，自鉴权后转 `handlePush(request, env)`。

**理由**：iOS Shortcuts 可能也会用 push 接口（之后阶段触发 `/api/push/send`），跟 health 一样需要 `?key=` 支持。

---

## 4. 后端路由清单（阶段 0-B 任务范围）

### 4.1 既有不动
- `/api/health*`、`/api/archive*`、`/api/settings*`、`/api/sessions*`、`/api/memory*`、`/api/diary*` 等所有 v2 路由：**一个字符不改**
- `/mcp`、`/sse` 响应头：**一个字符不改**
- `checkAuth` / `checkMcpAuth` / `jsonResponse` / `kvGet` / `kvPut` / `kvListByPrefix`：复用

### 4.2 新增路由（4 条 + 1 个 helper 函数 `signVapidJWT`）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/push/vapid-public-key` | 双鉴权 | 返回 `{ publicKey }` base64url 格式；前端订阅前调一次 |
| `POST` | `/api/push/subscribe` | 双鉴权 | body=PushSubscription JSON；upsert KV `push:subscription`；返回 `{ success, item }` |
| `DELETE` | `/api/push/subscribe` | 双鉴权 | 删 KV `push:subscription`；返回 `{ success }` |
| `POST` | `/api/push/send` | 双鉴权 | body=`{title, body, url?}`；写 KV `push:notification:latest`；签 JWT；POST 到 endpoint；按 endpoint 响应处理 410 | 
| `GET` | `/api/push/latest` | 双鉴权 | 读 KV `push:notification:latest`；返回 `{ notification }`；SW 在 push 事件里调 |

### 4.3 启动一次性脚本（不挂路由，wrangler 临时跑）

- **生成 VAPID 密钥对**：方案 a 的初始化。一段 8-10 行 PowerShell + node 脚本，调 `crypto.subtle.generateKey`，导出 JWK，base64url 编码公钥 → 通过 `wrangler kv key put` 写入 KV `push:vapid`。**只跑一次**，跑完密钥就在 KV 里安家。
- 备选方案：把这段也包成一个 `POST /api/push/vapid-init` 路由，只在 KV 没有 `push:vapid` 时才允许跑，跑完自禁用。更优雅但多一段代码，**0-B 先用 PowerShell 临时脚本**。

### 4.4 错误处理约定

| 上游响应 | Worker 行为 |
|---|---|
| 201/204 | success: true |
| 400 / 401 / 403 | 透传错误码 + body 给调用方；记一次 log；不动 KV |
| 404 / 410 Gone | 视为订阅过期：删 `push:subscription`，返回 `{ success: false, reason: "expired" }` |
| 413 Payload Too Large | 不可能（我们 body 是空）；若发生说明协议出错，500 |
| 429 Too Many Requests | 透传，加 `Retry-After` 头给调用方决策 |
| 5xx | 透传 |

---

## 5. 前端文件清单（阶段 0-C 任务范围）

### 5.1 新增

| 文件 | 作用 | 大小估算 |
|---|---|---|
| `public/sw.js` | Service Worker：监听 push 事件 → fetch /api/push/latest → showNotification；监听 notificationclick → 拉起 PWA | ~80 行（Matt 的 sw.js 45 行 + IndexedDB 取 token + fetch 逻辑） |
| `public/manifest.json` | PWA 清单：`display:"standalone"`、name、short_name、icons[192/512]、theme_color、start_url | ~25 行 |
| `public/icon-192.png` / `icon-512.png` | PWA 图标 | 二进制资源 |
| `src/utils/push.js` | 前端订阅流程：`getVapidPublicKey()` → `subscribePush()` → `unsubscribePush()`；包含 base64url ↔ Uint8Array 转换 | ~120 行 |
| `src/utils/indexedDb.js` | 极简 IndexedDB 封装：`writeAuthToken(key)` / `readAuthToken()` / `deleteAuthToken()`，给 SW 共用 | ~50 行 |
| `src/components/PushToggle.jsx` | 设置页里"开启/关闭通知"按钮组件；**点击事件**触发权限请求 + 订阅；展示当前状态 | ~80 行 |

### 5.2 改

| 文件 | 改动点 |
|---|---|
| `index.html` | head 里加 `<link rel="manifest" href="/manifest.json">` + Apple-specific meta（`apple-mobile-web-app-capable=yes` 等） |
| `src/pages/Settings.jsx`（如存在）或对应设置页 | 引入并挂载 `<PushToggle />` 组件 |
| `src/api.js` | 加 `pushVapidKey()` / `pushSubscribe(sub)` / `pushUnsubscribe()` / `pushLatest()`（虽然后两个 SW 直接 fetch，前端用于自检） |

### 5.3 不动

- `worker.js` 之外的后端：无
- 现有 Settings 页 / 主页 / 聊天页主体：除挂载新组件外不改

---

## 6. KV 存储结构

整个 push 模块在 KV 中占 **3 个 key**：

```
push:vapid                  →  { publicKey, privateKey, createdAt }
                               · publicKey: base64url string（前端用于 subscribe）
                               · privateKey: JWK object（worker 端 importKey 后用于签 JWT）
                               · createdAt: ISO 8601
                               · 一次性生成，永不变更

push:subscription           →  { endpoint, keys: { p256dh, auth }, ua, subscribedAt }
                               · endpoint: 完整 URL（Apple/FCM/Mozilla 域名）
                               · keys.p256dh: base64url
                               · keys.auth: base64url
                               · ua: 订阅时的 navigator.userAgent（调试用）
                               · subscribedAt: ISO 8601
                               · 410 Gone 时被 worker 删除

push:notification:latest    →  { title, body, url, createdAt, source? }
                               · title / body: 最新一条通知文案
                               · url: 点击通知时打开的 PWA 内路径，默认 "/"
                               · createdAt: ISO 8601
                               · source: 触发来源（"manual" / "health-alert" / "ai-wake" 等，可选）
                               · 每次 /api/push/send 时覆盖；SW fetch /api/push/latest 时读
```

不放 `push:notification:history`（历史列表）——这版本不需要，留给阶段 1。

---

## 7. iOS 三道门槛（汇总 + 强化 Matt 的踩坑）

### 门槛 1：HTTPS + PWA standalone

- Emet 域名走 Cloudflare Pages，HTTPS 自动 ✓
- `manifest.json` 的 `display` 必须是 `"standalone"` 或 `"fullscreen"`；**Matt 用的就是 standalone**，沿用即可
- iPhone 上**必须**通过 Safari「分享 → 添加到主屏幕」装一次，然后**从主屏幕图标**打开
- 从 Safari 地址栏直接访问？`window.PushManager === undefined`，前端直接 early return

### 门槛 2：iOS 16.4+

- 静怡 iPhone iOS 版本前期阶段我已经在用 Apple Watch 同步健康数据，可推断 ≥ 16.4。**0-C 上手前先口头确认**一下版本号
- 若是更老版本，先升级再做

### 门槛 3：权限请求必须在用户手势回调里

- `Notification.requestPermission()` 必须由 click/tap 触发，否则 iOS 静默拒绝（**完全没有弹窗**）
- 对策：`<PushToggle />` 的 onClick 里调 `subscribePush()`，整条链路（权限 + Push 订阅 + POST 后端）在同一个 click handler 里完成
- 不要在 useEffect / window.onload 里自动订阅——Matt README 第 85 行特别强调过

### 附：iOS 特有的 manifest 字段

```json
{
  "name": "Emet",
  "short_name": "Emet",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#000000",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

外加 `index.html` 的 head：

```html
<link rel="manifest" href="/manifest.json">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Emet">
<link rel="apple-touch-icon" href="/icon-192.png">
```

后两条 iOS 旧规范遗留，加上更稳。

---

## 8. 任务切分

### 阶段 0-B（今晚 9:30-10:30，后端）

- [ ] 写 `signVapidJWT(audience, privateJwk)` helper（Web Crypto + base64url）
- [ ] 写一段一次性 PS 脚本，生成 VAPID 密钥对，写 KV `push:vapid`
- [ ] 在 worker.js 加 `handlePush(request, env)` 函数 + 4 条路由
- [ ] 在 `routeRequest` 加 `if (path.startsWith("/api/push/"))` 分支
- [ ] node --check + 部署
- [ ] curl 自测：
  - `GET /api/push/vapid-public-key` 能返回 publicKey
  - `POST /api/push/subscribe` 假数据能存进 KV
  - `GET /api/push/latest` 能读到上一步写的
  - `DELETE /api/push/subscribe` 能清掉
  - `POST /api/push/send` 在 subscription 不存在时返回友好错误
- [ ] commit + push

### 阶段 0-C（明天，前端，需要在 iPhone 实操）

- [ ] 加 `public/manifest.json` + 两个 icon 图
- [ ] 加 `public/sw.js`（注意：放 public 根，不走 vite 打包）
- [ ] 加 `src/utils/indexedDb.js`
- [ ] 加 `src/utils/push.js`
- [ ] 加 `src/components/PushToggle.jsx`
- [ ] 改 `index.html` head
- [ ] 改 `src/api.js` 加 4 个新方法
- [ ] 改 Settings 页挂载 `<PushToggle />`
- [ ] 桌面 Chrome 冒烟：注册 SW → 订阅成功 → curl 触发 → 看到桌面通知
- [ ] iPhone 实操：Safari 打开 → 添加到主屏幕 → 主屏幕图标启动 → 点订阅按钮 → 同意权限 → curl 触发 → iPhone 系统通知弹出 🎉
- [ ] commit + push + 部署到 Cloudflare Pages

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Web Crypto API 在 Cloudflare Workers 上的 ECDSA 行为与浏览器有细节差异（签名长度、DER vs raw） | VAPID 签名验证失败，Apple Push Service 返回 401 | 写 helper 时用 raw 格式（64 字节，r∥s），多家教程都验证过；先在桌面 Chrome 跑通再上 iPhone |
| iOS 16.4 的 Web Push 偶发投递延迟（10s-几分钟） | 用户体感"没收到" | 文档化"延迟正常"；自测期间允许；阶段 1 接入 wake_up 心跳后用频率掩盖单次延迟 |
| Push Service endpoint 在不同设备/地区分布不同（Apple `web.push.apple.com`、Mozilla `updates.push.services.mozilla.com`、Chrome `fcm.googleapis.com`） | VAPID JWT 的 `aud` 字段每次都得按 endpoint 的 origin 重算 | helper 接受 endpoint 参数、内部解析 origin、签 JWT；多 endpoint 路由统一处理 |
| SW fetch /api/push/latest 时网络故障 | 通知没内容可显示，iOS 可能弹一个"该网站推送了一条消息"的占位 | SW 里 fallback：fetch 失败时 `showNotification("Emet", { body: "你有一条新消息" })`，保 userVisibleOnly 不被惩罚 |
| 浏览器要求 `userVisibleOnly:true` 严格执行 | 推送但不弹通知会被静默升级到惩罚静默期 | SW 100% 路径都调 showNotification（含 fallback 文案） |
| KV 最终一致性（push:subscription 写完立刻读可能拿不到） | 概率低，订阅刚成功立刻 send 可能失败一次 | 0-B 测试时手动间隔几秒；0-C 真实使用场景下用户订阅完不会立刻触发推送 |

---

## 10. 验收方案

### 0-B 验收（后端独立）

```bash
KEY="b30..."
BASE="https://emet-memoty-v66.aandxiaobao.workers.dev"

# 1. 拿公钥
curl "$BASE/api/push/vapid-public-key?key=$KEY"
# 期望：{ "publicKey": "BN..." }（base64url，≈87 字符）

# 2. 模拟订阅
curl -X POST "$BASE/api/push/subscribe?key=$KEY" \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"https://web.push.apple.com/fake","keys":{"p256dh":"BN_fake","auth":"fake_auth"}}'
# 期望：{ "success": true, "item": {...} }

# 3. 写一条通知内容
curl -X POST "$BASE/api/push/send?key=$KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"测试","body":"这是阶段 0-B 自测"}'
# 期望（用假 subscription）：{ "success": false, "reason": "..." } + KV push:notification:latest 已写入

# 4. SW 角度读最新内容
curl "$BASE/api/push/latest?key=$KEY"
# 期望：{ "notification": { "title": "测试", "body": "..." } }

# 5. 退订
curl -X DELETE "$BASE/api/push/subscribe?key=$KEY"
# 期望：{ "success": true }
```

### 0-C 验收（端到端）

1. 桌面 Chrome：装 PWA → 订阅 → 后端 curl `POST /api/push/send` → **桌面通知中心弹窗**
2. iPhone：Safari → 添加到主屏幕 → 主屏幕图标启动 → 设置页点订阅 → 后端 curl 触发 → **iPhone 锁屏 / 通知中心系统通知弹出**

---

## 11. 不在本期

- **多设备订阅枚举接口**：将来要 iPad + iPhone 都收时加 `GET /api/push/subscriptions` 返回列表
- **RFC 8291 payload 加密**：用 `@block65/webcrypto-web-push` 接掉 SW fetch 的中间一跳
- **推送内容模板化**：当前 send 接口接受任意 `{title, body, url}`；将来加 `template` 字段 + 服务端拼装
- **推送频率控制**：基于活跃度动态调度（always-here 的 wake_up 那套），属于阶段 1
- **失败重试与死信队列**：当前 410 直接删订阅，其它错误透传；将来要加 `push:dead-letter` KV 队列
- **VAPID 密钥轮换**：当前一次生成永不变；将来要加 `push:vapid:next` 双版本平滑切换
- **Web Push for Android / 微信内置浏览器**：跨平台留给后期

---

*方案版本：v1 · 2026-06-16 · 静怡审过后再分阶段实施*
