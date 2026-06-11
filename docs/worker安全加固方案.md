# worker.js 安全加固方案

> 任务红线：本方案只读代码产出，未编辑 worker.js、未部署。所有改动由静怡人工审查应用。
> 基线：emet-memory/worker.js v6.8.2（5287 行），git 仓库 main 分支。
> /mcp 与 /sse 路由及其响应头：一个字符未动。

## a. 修改点逐条说明

| # | 位置（行号） | 改什么 | 为什么 |
|---|---|---|---|
| 1 | L6 | 删除 `const ADMIN_KEY = "0374";` | 硬编码短数字密钥，仓库里明文可见 |
| 2 | L1242-1244 `checkAuth` | 改签名为 `checkAuth(request, env)`，与 `env.ADMIN_KEY` 比对；secret 未配置时一律返回 false（fail-closed） | 密钥换 Cloudflare Secret；防止忘配 secret 时裸奔 |
| 3 | L1473-1476（handleAPIv2 内 /api/auth）与 L1252-1255（死代码 handleAPI 内同款） | `body.key === ADMIN_KEY` → `env.ADMIN_KEY && body.key === env.ADMIN_KEY` | 验密接口本身改读 secret；死代码同步修，防止未来误启用回退成无鉴权 |
| 4 | L1508 与 L1289（死代码同款） | `checkAuth(request)` → `checkAuth(request, env)` | 配合 #2 签名变化；原写操作鉴权逻辑保留不变 |
| 5 | L5260-5287 fetch 主入口 | 重组为 `routeRequest()` + 出口包装 `withCors()`；在 /mcp、/sse 分发之后、六个旁路维护路由之前插入**统一鉴权闸门**：`/api/*` 一律要求 X-Admin-Key（仅豁免 /api/auth——它本身就是验密接口） | ①六个旁路路由（/api/migrate-vectors、/api/wake、/api/archive-sweep、/api/retag、/api/weave-backfill、/api/viz-data）在 L5276-5281 **先于** handleAPIv2 分发，handleAPIv2 内部加闸拦不到它们，必须在入口拦；②一个闸门覆盖全部 /api/* GET+写，不必逐路由改 |
| 6 | L5264-5273 OPTIONS 预检 | 原全开 `*` 改为只回 204，CORS 头交给 withCors 按白名单补 | 收紧预检；Allow-Headers 明确列出 Content-Type 与 X-Admin-Key |
| 7 | 新增 `withCors(response, request)` + `ALLOWED_ORIGINS` | 出口统一删除处理器自带的 `*` CORS 头；Origin 命中白名单（emet-frontend.pages.dev / localhost:5173）才回显该 Origin 并补 Allow-Methods/Headers，否则不下发任何 CORS 头 | 单一收口点：jsonResponse 在全文件被调用上百次且写死 `*`（L1230-1240），逐个改调用点不现实；出口重写零遗漏。**/mcp 与 /sse 的响应在入口处原样放行，不经过 withCors**，响应头逐字节不变 |
| 8 | L1501-1506 handleAPIv2 内 /play/:id（及 L1281-1286 死代码同款） | 校验 `?key=` 查询参数与 env.ADMIN_KEY，不符返回 401 | 浏览器直开页面带不了自定义请求头；/play 不在 /api/* 闸门内（路径不匹配），单独校验 |
| 9 | /health（L1485）、/icon.png（L1478） | 不动，保持公开 | /health 留作存活探测（按要求）；icon.png 只是图标，且新前端不用它 |
| 10 | L3150（renderFrontend 内嵌旧前端的 `callAPI`） | `if ((opts.method \|\| 'GET') !== 'GET' && ADMIN_KEY)` → `if (ADMIN_KEY)` | 这是浏览器端 JS 的同名变量（密码门输入后存 localStorage），与 secret 无关。旧前端原本只在写请求带头；GET 加鉴权后，根路径旧前端的读全挂。此一行让它 GET 也带头，密码门流程照旧可用 |

**明确不改的**：/mcp、/sse 全部代码与响应头；handleMCP/executeTool；死代码 handleAPI 除 #3#4#8 的密钥同步外不动；jsonResponse 本体不动（`*` 头由出口统一重写）。

**已知残留风险（按红线不处理，记录在案）**：/mcp 路由本身无鉴权——claude.ai 连接依赖现状，本次不动；MCP 为服务端直连不受 CORS 影响。

## b. 精确 diff（共 7 处，可逐块对照应用）

### ① L6 删除硬编码密钥

```diff
-const ADMIN_KEY = "0374";
+// ADMIN_KEY 已迁移至 Cloudflare Secret（wrangler secret put ADMIN_KEY），代码内经 env.ADMIN_KEY 读取
 const APP_ICON_BASE64 = "";
 const ANNIVERSARY = "2025-04-06";
```

### ② L1242-1244 checkAuth 改读 env，fail-closed

```diff
-function checkAuth(request) {
-return request.headers.get("X-Admin-Key") === ADMIN_KEY;
-}
+function checkAuth(request, env) {
+// secret 未配置时一律拒绝（fail-closed），防止误部署成无鉴权
+if (!env || !env.ADMIN_KEY) return false;
+return request.headers.get("X-Admin-Key") === env.ADMIN_KEY;
+}
```

### ③ 两处 /api/auth 改读 env（L1254 死代码 + L1475 生效代码，改法相同）

```diff
 if (path === "/api/auth" && method === "POST") {
 const body = await request.json();
-if (body.key === ADMIN_KEY) return jsonResponse({ success: true });
+if (env.ADMIN_KEY && body.key === env.ADMIN_KEY) return jsonResponse({ success: true });
 return jsonResponse({ error: "wrong" }, 401);
 }
```

### ④ 两处写操作闸门补 env 参数（L1289 死代码 + L1508 生效代码，改法相同）

```diff
-if (method !== "GET" && !checkAuth(request)) return jsonResponse({ error: "Unauthorized" }, 401);
+if (method !== "GET" && !checkAuth(request, env)) return jsonResponse({ error: "Unauthorized" }, 401);
```

### ⑤ 两处 /play/:id 加 ?key= 校验（L1281-1286 死代码 + L1501-1506 生效代码，改法相同）

```diff
 const playMatch = path.match(/^\/play\/([^\/]+)$/);
 if (playMatch && method === "GET") {
+if (!env.ADMIN_KEY || url.searchParams.get("key") !== env.ADMIN_KEY) {
+return new Response("Unauthorized", { status: 401 });
+}
 const g = await kvGet(env, `game:${playMatch[1]}`);
 if (!g || !g.html) return new Response("Game not found", { status: 404 });
 return new Response(g.html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
 }
```

### ⑥ L3150 内嵌旧前端 callAPI：GET 也带头

```diff
 async function callAPI(path, opts) {
   opts = opts || {};
   opts.headers = opts.headers || {};
-  if ((opts.method || 'GET') !== 'GET' && ADMIN_KEY) {
+  if (ADMIN_KEY) {
     opts.headers['X-Admin-Key'] = ADMIN_KEY;
   }
```

### ⑦ L5259-5287 主入口重组：统一鉴权闸门 + CORS 白名单收口

```diff
 // ─── 主入口 ───
+const ALLOWED_ORIGINS = [
+"https://emet-frontend.pages.dev",
+"http://localhost:5173"
+];
+
+// 出口统一处理 CORS：剥掉处理器自带的 * 头；Origin 命中白名单才回显并补齐
+function withCors(response, request) {
+const origin = request.headers.get("Origin");
+const h = new Headers(response.headers);
+["Access-Control-Allow-Origin", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers", "Access-Control-Max-Age"].forEach(k => h.delete(k));
+if (origin && ALLOWED_ORIGINS.includes(origin)) {
+h.set("Access-Control-Allow-Origin", origin);
+h.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
+h.set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
+h.set("Access-Control-Max-Age", "86400");
+h.append("Vary", "Origin");
+}
+return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
+}
+
 export default {
 async fetch(request, env, ctx) {
+const res = await routeRequest(request, env, ctx);
+// 红线：/mcp 与 /sse 的响应原样返回，不经 withCors，响应头逐字节不变
+const p = new URL(request.url).pathname;
+if (p === "/mcp" || p === "/sse") return res;
+return withCors(res, request);
+}
+};
+
+async function routeRequest(request, env, ctx) {
 const url = new URL(request.url);
 const path = url.pathname;
 if (request.method === "OPTIONS") {
-return new Response(null, {
-headers: {
-"Access-Control-Allow-Origin": "*",
-"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
-"Access-Control-Allow-Headers": "*",
-"Access-Control-Max-Age": "86400"
-}
-});
+// 预检只回 204，CORS 头由出口 withCors 按白名单决定下发与否
+return new Response(null, { status: 204 });
 }
 if (path === "/mcp" && request.method === "POST") return handleMCP(request, env);
 if (path === "/sse") return handleSSE(request, env);
+// ── 统一鉴权闸门：/api/* 全部要求 X-Admin-Key ──
+// 仅豁免 /api/auth（验密接口本身）；/health、/play/、/icon.png 路径不匹配，不受影响
+// 注意必须放在下面六个旁路维护路由之前，否则它们绕过鉴权
+if (path.startsWith("/api/") && path !== "/api/auth" && !checkAuth(request, env)) {
+return jsonResponse({ error: "Unauthorized" }, 401);
+}
 if (path === "/api/migrate-vectors") return handleMigrateVectors(request, env);
 if (path === "/api/wake") return handleWake(request, env);
 if (path === "/api/archive-sweep") return handleArchiveSweep(request, env);
 if (path === "/api/retag") return handleRetag(request, env);
 if (path === "/api/weave-backfill") return handleWeaveBackfill(request, env);
 if (path === "/api/viz-data") return handleVizData(request, env);
 if (path.startsWith("/api/") || path === "/health" || path.startsWith("/play/") || path === "/icon.png") return handleAPIv2(request, env);
 if (path === "/" || path === "") {
 return new Response(renderFrontend(), { headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "no-cache" } });
 }
 return jsonResponse({ error: "Not found" }, 404);
 }
-}
```

> 注：原文件末尾的 `}` `}`（fetch 与 export default 的闭合）被上面的重组替代——`export default` 块在 wrapper 处闭合，原 fetch 函数体变成 `routeRequest`，结尾只留一个 `}`。

## c. 静怡的操作清单

1. **生成长随机密钥**（任选其一）：
   ```bash
   openssl rand -base64 32          # git-bash 里可用
   ```
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
2. **设置 Cloudflare Secret**（二选一）：
   - 命令行（在 emet-memory 目录，无 wrangler.toml 所以必须带 --name）：
     ```bash
     npx wrangler secret put ADMIN_KEY --name emet-memoty-v66
     # 提示输入时粘贴上一步生成的 key
     ```
   - Dashboard：dash.cloudflare.com → Workers & Pages → emet-memoty-v66 →
     Settings → Variables and Secrets → Add → Type 选 **Secret** →
     Name 填 `ADMIN_KEY` → Value 粘贴 key → Deploy
3. **应用 diff 后部署**：
   ```bash
   npx wrangler deploy worker.js --no-bundle --name emet-memoty-v66
   ```
4. **改完后的配套动作**：
   - 新前端浏览器里 localStorage 的 `emet.adminKey` 改成新 key（设置页先「锁定」清掉，下次写操作弹框输新的）
   - 如果有外部定时器在调 /api/wake 之类的维护路由，给它们加上 `X-Admin-Key` 头
   - 旧 key `0374` 从此作废

## d. 测试清单

| # | 测试 | 预期 |
|---|---|---|
| 1 | `curl https://emet-memoty-v66.aandxiaobao.workers.dev/api/data`（不带 key） | 401 `{"error":"Unauthorized"}` |
| 2 | `curl -H "X-Admin-Key: <新key>" .../api/data` | 200 + 数据 |
| 3 | 同样验证 /api/stats、/api/backup、/api/memory/:id、/api/viz-data 不带 key 全部 401 | 401 |
| 4 | 浏览器直接打开 `.../play/<游戏id>?key=<新key>` | 游戏正常显示；不带 ?key 或 key 错 → 401 |
| 5 | `curl .../health` | 200，无需 key（存活探测保留） |
| 6 | 从 emet-frontend.pages.dev 发起的跨域请求 | 正常（响应头 Access-Control-Allow-Origin 回显该域名） |
| 7 | 从其他来源（如随便一个网页的 fetch）发起跨域 | 浏览器报 CORS 拒绝（响应无 CORS 头） |
| 8 | OPTIONS 预检（带 Origin: https://emet-frontend.pages.dev，请求头声明 X-Admin-Key） | 204 + Allow-Headers 含 Content-Type, X-Admin-Key |
| 9 | claude.ai 的 MCP 连接 | **静怡在 claude.ai 手动验证**：列工具、调一次 breath/current_status 正常 |
| 10 | worker 根路径旧前端：密码门输入新 key 后能正常读数据 | 列表正常加载（diff ⑥ 的效果） |

## 附：本次未做、需要排期的前端配套

- 新前端 api.js 的 `getJSON` 已会自动附带存储的 key，但**首次访问/清空存储后所有读请求会 401**——需要给读路径加「401 时弹密码框重试」（现在只有写路径有这个逻辑）。这是加固部署后前端的第一个配套改动。
- 本地开发若 5173 被占用 vite 会换 5174，会被 CORS 白名单拒——建议 vite.config.js 加 `server: { strictPort: true }`，或在白名单追加 5174（需要你拍板）。
