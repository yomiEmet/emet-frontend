# Keep-the-crow 落地项目书

> 本文档是执行模型的**唯一需求来源**。灵感来自 github.com/sunmoon-orbit/Keep-the-crow（20 篇经验文档），
> 但**不需要去读那个仓库**——需要的设计和踩坑经验已全部提炼在本文档各期的「坑清单」里。
> 编写：Claude Fable 5（2026-07-14 调研后）。验收：静怡 + Fable。

---

## 0. 开工前必读（执行模型第一件事）

1. 读 `CLAUDE.md`（协作规则）和 `PROJECT_STATUS.md`（already 完成的 always-here 阶段 0-4）。
2. 读本文档全文。
3. 做「摸底任务」（见各期开头），**先摸底再动手**。

### 两个仓库，别搞混

| | 前端 | 后端 |
|---|---|---|
| 路径 | `C:\Users\Administrator\Desktop\Emet Memory`（注意有空格） | `C:\Users\Administrator\Desktop\emet-memory\worker.js` |
| 形态 | React 18 + Vite 5 + React Router | 单文件 worker.js |
| 部署 | git push master → Cloudflare Pages 自动构建（`npm run build` → `dist/`） | `wrangler deploy worker.js --name emet-memoty-v66 --no-bundle` |
| 域名 | Pages 域名 | `emet-memoty-v66.aandxiaobao.workers.dev`（memoty 拼写故意） |

后端部署后用 `Total Upload: XXX KiB ≈ 文件字节数 ÷ 1024` 核对部署的是正确文件。

### 铁律（违反任何一条都算返工）

- 每完成一个独立步骤就 `git commit`，每个 commit 必须可独立 revert。commit 信息用中文，**不要用中文双引号**（PowerShell 下会被 git 当 pathspec，报错；要引用就用「」）。
- 密钥/token 绝不写进代码、绝不进仓库。Worker 侧走 `wrangler secret` 或 KV；本机侧走环境变量。
- 一切「按日归属」的逻辑，切分线是**凌晨 4 点**，不是 0 点（静怡凌晨活动多）。
- Cloudflare 免费版每个 Worker 只有 **3 条 cron**，已被周记/月记/心跳用满。**不许新增 cron**，一切新定时任务并入心跳 cron（`0,30 * * * *`）的 handler 内分发。
- 聊天的 prompt caching 纪律：任何每轮变化的动态内容（时间、提醒、注入）只能放进**最后一条用户消息**（动态区），绝不落库、绝不混进缓存前缀，否则缓存全灭。
- 不许重构与任务无关的代码；不许改记忆系统核心（L0/L1/recall）；留言板现有三类卡片（信件/留言/灵感）的交互行为不动。
- 遇到需要开通新付费服务或新 Cloudflare 产品（如 R2、Workers Paid）：**停下，问静怡**。
- AI 自动生成的内容（独处/做梦/自动动态）**绝不写入记忆库**，只进本项目书指定的落点。这是静怡拍板的边界。
- 所有 UI 文案、与静怡的沟通，全部中文。

### 合规红线（第一期相关，不可逾越）

- 只用**官方 `claude` CLI 本体**（spawn 官方可执行文件），绝不提取/转用 OAuth token，绝不直接拿订阅凭证调 Anthropic API。
- Claude Code 本体**只跑在静怡自己家里的这台 Windows 电脑上**（家庭宽带 IP，合规最干净），绝不搬到 VPS/机房（机房 IP 会被风控重点盯）。
- 桥虽然经 Cloudflare 隧道暴露到公网，但必须**双重门禁**：①`CC_BRIDGE_TOKEN` 强制校验；②强烈建议在隧道那个主机名前挂 **Cloudflare Access**（只放行静怡本人的身份，如邮箱一次性验证码），让这个网址对陌生人根本打不开。绝不做「谁知道网址就能连」的裸端点。
- 单人自用（只有静怡自己连），不给任何第三方提供访问。

---

## 第一期 · 手机连本体（路线 A：本机 Windows 常驻 + Cloudflare 隧道）

**目标**：静怡出门时，手机（照常开小火箭）打开 Emet 网页 → 切「本机 Claude」通道 → 连上这台电脑上常驻的 Claude Code 本体（带记忆等 MCP 工具），流式对话。手机端**不装任何 VPN**。

**为什么是隧道不是 Tailscale（决策背景，2026-07-14 静怡拍板）**：iOS 只能同时开一个 VPN，而静怡必须常开小火箭（否则连 Cloudflare 上的 Emet 应用本身都打不开），Tailscale 与小火箭互斥 → Tailscale 方案作废。改用 **Cloudflare 隧道**：在本机跑 `cloudflared`，从电脑**主动向外**连 Cloudflare，把本机桥顶成一个公网 HTTPS 主机名（如 `cc.<域名>`）。手机走平常的小火箭路由访问这个网址即可，与访问 Pages/Worker 是同一条路，天然可达。Claude Code 本体仍留在本机（合规同方案 A，只是把"管子"从 Tailscale 换成隧道）。

**已有雏形**：前端仓库根目录 `chat-server.cjs`——本机桥，把前端聊天请求接到 `claude -p`（stdin 进、stdout 出、SSE 推给浏览器）。现状三个局限：①每次全量拼对话、无会话延续；②`--tools ""` 工具全关；③只监听 `127.0.0.1:8000`，手机够不着。前端 `src/utils/anthropic.js` 的 `streamClaudeCli`、`src/utils/providers.js`、`src/components/ProviderManager.jsx` 已支持 `claude-cli` 协议（`apiKey` 字段兼作桥的暗号，对应 `CC_BRIDGE_TOKEN`）。

**明确不做**：①不引入 tmux/WSL（Keep-the-crow 原方案用 tmux capture-pane 轮询抓终端输出，脏且有 50 行截断/转义坑；我们的 stdin/stdout 直连方案天然没有这些问题，保持现状架构）；②不引入 Tailscale；③不买 VPS。

### 摸底任务

- `claude --help` 确认本机 CLI 版本支持的旗标：`--resume` / `--continue`、`--output-format stream-json`、`--allowedTools` / `--disallowedTools`、`--mcp-config`（不同版本旗标名可能有出入，以 --help 实测为准）。
- `claude mcp list`（在前端仓库目录下跑）确认 CLI 模式下 Emet 的 MCP 服务器（memory/diary/moments/mood/message 等工具那个）是否已配置、服务器名叫什么；没配置的话找到桌面端的 MCP 配置，等价搬给 CLI（`--mcp-config` 或项目 `.mcp.json`）。
- 读 `chat-server.cjs` 全文（约几百行）和 `src/utils/anthropic.js` 的 claude-cli 分支。
- 检查 `src/pages/Chat.jsx` 的 SSE 断流处理：页面切后台再回来（`visibilitychange`）是否有重连/恢复逻辑。

### 任务清单

**1-1 会话延续（chat-server.cjs）**
- 首次请求：`claude -p --output-format stream-json` 跑完从输出里取 `session_id`，存内存 + 落盘（如 `.cc-session.json`，加进 `.gitignore`）。
- 后续请求：带 `--resume <session_id>` 只发新消息，不再全量拼历史。
- 兜底：`--resume` 失败（会话过期/CLI 升级丢会话）自动回退到现有全量模式并重新建会话，前端无感。保留一个环境变量开关（如 `CC_BRIDGE_STATELESS=1`）可强制回到旧行为。
- 新会话的判定：前端新开对话时应通知桥重置 session（在请求体里加个 `newSession: true` 之类的字段，前端「新对话」按钮触发时带上）。

**1-2 工具白名单（chat-server.cjs）**
- 把 `--tools ""` 换成白名单模式：只允许 Emet MCP 服务器的工具（按摸底得到的服务器名，形如 `mcp__<name>__*`）+ WebSearch。
- **明确禁止**：Bash、Write、Edit、Read 等本机文件/命令类工具（手机误触发不能有本机副作用）。
- `--system-prompt` 继续承载人设（现状逻辑保留）。

**1-3 Cloudflare 隧道公网入口（分两步，先免费验证再固化）**

桥保持只听 `127.0.0.1:8000` 不变；`CC_BRIDGE_TOKEN` 生成强随机串（32 字节+）设为环境变量；`CC_BRIDGE_CORS` 追加 Pages 前端域名 `https://emet-frontend.pages.dev`。

- **步骤 A（免费验证，先做）**：本机装 `cloudflared`，跑一次性快速隧道 `cloudflared tunnel --url http://127.0.0.1:8000`，拿到一个随机 `*.trycloudflare.com` 网址。让静怡手机（开着小火箭）在 Emet「本机 Claude」通道填这个网址实测：能不能连上、流式稳不稳。**这一步不花一分钱、不用域名**，目的是先证明「隧道从她家网络出去 + 手机经小火箭进来」这条链路通。
  - 若本机出网需要走代理（Claude Code 能用说明本机有可用代理/线路），给 `cloudflared` 设 `HTTPS_PROXY`/`HTTP_PROXY` 环境变量走同一条线，保证隧道稳定。
- **步骤 B（固化，验证通过后）**：静怡买一个便宜域名（约 ¥70/年，阿里云/腾讯云人民币可付；给她写 3 句话指引：买完把域名 NS 改成 Cloudflare 给的两条，加进她现有 Cloudflare 账号）。用**命名隧道**（`cloudflared tunnel create` + `config.yml` 里 `ingress` 把 `cc.<域名>` 指到 `http://127.0.0.1:8000`），得到固定网址。
  - **强烈建议**：在 Cloudflare Zero Trust 里给 `cc.<域名>` 挂 **Access 策略**（只放行静怡邮箱一次性验证码），让陌生人打不开这个网址。这是把「公网暴露」收敛回「准私有」的关键，也保证单人自用。
- **不需要处理 mixed content**：隧道网址本身就是 Cloudflare 签发的有效 HTTPS，前端 https 页面直接请求它不会被浏览器拦截（这正是隧道相对裸 IP 的好处）。

**1-4 Windows 开机自启常驻（两个进程）**
- 用任务计划程序（schtasks）建**登录时自启**的任务，跑一个 `.cmd`：先 `chcp 65001`（防中文乱码），设好 `CC_BRIDGE_TOKEN`（及必要时 `HTTPS_PROXY`）等环境变量（从任务配置注入，不写进 `.cmd` 明文提交），循环拉起 `node chat-server.cjs`（进程退出 5 秒后重启）。
- `cloudflared` 同样要开机自启常驻：命名隧道装成 Windows 服务（`cloudflared service install`）最稳；或并入同一 `.cmd` 一起循环拉起。两个进程谁都不能少。
- `.cmd` 里若必须含密钥，则该文件加入 `.gitignore`，仓库里只放去密钥的 `.cmd.example`。

**1-5 前端微调**
- `ProviderManager.jsx` 的「本机 Claude」说明文案更新：本机后端地址填隧道网址（验证期是 `*.trycloudflare.com`，固化后是 `https://cc.<域名>`），暗号填桥的 token；**说明手机端不需要装 VPN，照常用小火箭即可**。
- 若挂了 Cloudflare Access：说明首次访问需在浏览器过一次邮箱验证码（Access 会种 cookie，之后一段时间免验），并确认 Emet 前端的 fetch 带 `credentials`/cookie 能通过 Access（若 Access 拦截了 API 的 SSE 请求，改用 Access Service Token 方式，二选一，实测为准）。
- 若摸底发现 Chat.jsx 没有 SSE 断流恢复：加最小实现——`visibilitychange` 回前台时检测流已死则提示「连接已断开」，不做自动重发（避免重复消息）。

### 验收清单（静怡 + Fable 一起过）

- [ ] 手机开着小火箭（不装任何 VPN）→ Emet 网页切「本机 Claude」→ 能流式对话
- [ ] 对话中让它调记忆工具（如「搜一下记忆里的 XX」）能成功
- [ ] 连续多轮对话它记得前几轮说了什么（会话延续生效）
- [ ] 手机切后台 2 分钟回来，界面不假死
- [ ] 不带 token 的请求被 401 拒绝；挂了 Access 的话，未登录身份打不开该网址
- [ ] 电脑重启后不用手动操作，几分钟内两个进程都自动恢复、通道可用

### 坑清单

- 隧道从国内家庭网络出网可能被干扰：让 `cloudflared` 走本机现有代理线路（`HTTPS_PROXY`），并优先用命名隧道装服务（比 quick 隧道稳、不会换网址）。
- quick 隧道（`trycloudflare.com`）只用于步骤 A 验证：重启就换网址、有速率限制，**绝不能当长期入口**，验证通过必须转命名隧道。
- Cloudflare Access + SSE：Access 的登录门可能挡住前端的流式 API 请求，1-5 已列两条应对路，实测选一条，别让 Access 把聊天请求也拦了。
- Node 24 在 Windows 上 spawn `.cmd` 有 EINVAL 坑——`chat-server.cjs` 里 `resolveClaude()` 已处理，别动它。
- Keep-the-crow 第 3 篇教训：**判定信号绝不能耦合到可掉线的组件**——桥的任何「这是聊天消息」的判定逻辑要无条件、不依赖 MCP 或其他可掉线的东西。
- 静默失败最难查：桥收到消息但 claude 没回时，必须往 SSE 推一条明确的错误事件，两端都能看见，不许两头静默。
- Windows 终端 GBK：所有子进程 IO 明确 UTF-8。

---

## 第二期 · 留言板升级「动态流」+ 独处时间 + 做梦

**背景决定（静怡拍板）**：不新做「朋友圈」页面，把现有**留言板**升级承载动态流（留言板目前有信件/留言/灵感三类卡片，有点闲置）。AI 自动产出（独处/梦）只进独处手账和动态流，**绝不写记忆库**。

### 摸底任务

- 读 `worker.js`（后端仓库）：存储模式（KV 命名风格）、心跳 cron handler 的结构（`0,30 * * * *` 那条）、现有 push 发送函数、`config:heartbeat` 等开关的读法。
- 读前端 `src/pages/Messages.jsx`（留言板）现有数据结构和三类卡片的渲染/编辑逻辑。
- 找到 MCP 服务器代码位置（含 message_leave/moment_save 等工具的那个本机进程），确认给它加新工具的方式。
- 确认 Worker 是否已绑 R2（图片存储用）。**没绑就先做纯文字版**，图片和「AI 识图评论」整体顺延，并在验收时告诉静怡差这块、开 R2 免费版需要她点头。

### 任务清单

**2-1 动态流（留言板第四类：「动态」）**
- 后端：动态的增删查 API + 点赞（双方各自可点/取消）+ 评论（列表式，双方可发）。数据结构带 `author`（yomi/emet）、`source`（manual / idle-auto / dream）、时间戳。分页用游标（before 参数），**别写死「最新 N 条」**——Keep-the-crow 第 14 篇踩过：固定条数会让老内容永远不可达。
- 前端：留言板加「动态」流（时间线卡片：内容、来源小标、点赞心形、评论展开）。交互风格跟随现有三卡片的习惯（点内容进编辑仅限自己发的手动动态；AI 自动产出只读）。
- MCP：给 MCP 服务器加 feed 工具（发动态/看动态/评论/点赞），命名跟随现有工具风格，让 CC 本体也能刷动态。

**2-2 独处时间（并入心跳 cron 分发）**
- 心跳 handler 里加独处调度：默认时段窗口 10 / 15 / 18 / 22 点（每窗口内以概率触发一次，天然带 0-30 分钟随机偏移），每日上限 3 次，KV `config:idle` 存开关+时段+上限，**默认关闭**，设置页给开关卡片。
- 醒来流程：并行拉素材（最近记忆目录/摘要若有现成接口就用、最近 5 条动态、最近 5 条独处记录、档案室随机一段旧对话切片），每路独立容错（拉不到就没有，不阻塞）。
- 组 prompt 调一个**便宜模型**（模型与 endpoint 走 KV 配置，沿用 `config:llm` 的配置方式；默认 claude-haiku-4-5），要求严格输出 JSON `{action, content, note}`，action 四选一：`diary`（写独处手账）| `reflect`（就旧对话片段写感悟，进手账）| `post`（发一条动态，source=idle-auto）| `rest`（发呆，无产出）。
- **解析失败/坏 JSON/拒答一律按 rest 处理，绝不落地**。把最近几次独处记录回喂给模型并明确要求别每次干同一件事。
- prompt 写死事实边界：「感受可以自由表达；事实只能来自给定素材；不许编造具体物件、活动、承诺、约定；拿不准就只写心情」。（Keep-the-crow 第 14 篇真实事故：模型编了个不存在的「还湿着的调色盘」，而且旧动态回喂让幻觉自我强化。）
- 所有醒来（含 rest）记入 `idle_log`（KV），字段：时间、action、内容摘要。
- 前端：「独处手账」页面（入口放哪跟静怡现有导航风格走，建议记忆页或设置页入口），按**逻辑日（4 点切）**分组的时间线，各 action 配小图标。

**2-3 做梦**
- 心跳 cron 在 04:00-05:00 窗口触发（逻辑日刚切换）：调便宜模型生成 ≤150 字梦境（第一人称、意象化、不解释含义、同样的事实边界），存为动态（source=dream，卡片带「梦」标）。KV `config:dream` 开关，**默认关闭**。
- 可选：接现有 Web Push 发一条「Emet 做了一个梦」（正文取前 60 字），跟随 `config:dream` 里的子开关。

### 验收清单

- [ ] 留言板三类旧卡片行为一字未变
- [ ] 双方都能发动态/点赞/评论，CC 本体能通过 MCP 工具发动态和评论
- [ ] 开关全关时，心跳 cron 行为和现在完全一样（回归：现有心跳/周记/月记不受影响）
- [ ] 打开独处开关后 1-2 天内：手账里出现记录，其中有 rest（发呆是合法结果），动态流里出现 AI 动态且内容没有编造事实
- [ ] 记忆库里没有任何自动写入
- [ ] 做梦开关打开后次日早上能看到梦（时间落在 4-5 点窗口）

### 坑清单

- 心跳 handler 是「一条 cron 多路分发」，每路必须独立 try/catch，一路挂不能拖死其他路。
- 便宜模型如果带思考（reasoning）输出：reasoning 计入 max_tokens，配额给小了正文会是空的——max_tokens 给足（≥1800）并留代码注释防后人改小。
- 独处动态注入聊天上下文时（若做「聊天里自然提起最近动态」，本期可选），遵守缓存纪律：只进动态区。

---

## 第三期 · 共读书架

**目标**：静怡和 Emet 在同一本书上划线、批注、共享进度；CC 本体能用工具翻书留批注。

### 摸底任务

- 确认 worker.js 存储承载整本书的方式（KV 单 key 25MB 上限，按章拆 key 即可）。
- 读档案室前端（`src/pages/ArchivePage`）的列表/阅读交互，共读阅读器尽量复用其视觉风格。

### 任务清单

- **后端**：书籍元数据、章节正文（按章一个 key，避免整本读写）、批注（章节索引 + 字符偏移 + 原文 quote 兜底 + 作者 + 颜色）、共享书签（每本一条）。全套 CRUD API。
- **上架**：前端上传 txt → 解码（**先 fatal 模式试 UTF-8，失败回退 GBK**——国内 txt 多为 GBK，这坑我们在 Paramecium 移植时也踩过）→ 归一化（`\r\n`→`\n`、全角空格）**必须在入库前完成** → 正则识别「第X章/回/卷、序章/楔子/引子」自动分章，识别不了按段落边界约每 1 万字一切 → **分章逐个 POST**（别一次 POST 整本，Worker 请求体和 KV 单值都有上限）。
- **阅读器前端**：单个 `white-space: pre-wrap` 容器渲染正文——**不做任何 markdown/HTML 加工，渲染文本必须与存储正文逐字一致**，否则字符偏移全错位（这是本期最容易崩的一条）。划线：`selectionchange` + Range API 算选区偏移；批注锚定 = 章节索引 + 字符偏移 + quote 兜底（偏移对不上时按 quote 文本搜索恢复）。双方批注不同颜色，点划线看批注。书签 = 双方共享的阅读进度。
- **MCP**：书列表/读某章/留批注/拉某书全部批注，四个工具给 CC 本体。

### 验收清单

- [ ] 传一本 GBK 编码的 txt 能正确上架分章
- [ ] 手机上划线批注，电脑上让 CC 用工具读到这条批注并回一条
- [ ] 批注在重新打开、换设备后位置不偏
- [ ] 书签两端一致

---

## 第四期 · 生活三件套 + 纪念日注入（每样独立开关）

静怡授权「随意做」，但每样必须有独立开关（设置页），默认关。

- **4-1 今日小票**：每日清单卡（超市小票风格），**按 4 点切日**。双端可记：前端手动加条目 + MCP 工具让 CC 帮记；每条带 `added_by`（yomi/emet），前端给 CC 记的条目一个小标记。注意：CC 帮记 = 显式工具调用，不是自动扫描（符合静怡的边界）。
- **4-2 经期月历**：记录（含 end_date，允许回溯补记历史）+ 服务端统计（平均周期/预测下次/距今天数；**统计函数只在后端实现一份**，前端和 MCP 都调它，保证多端口径一致）。坑：查「进行中的那次」一律用谓词 `find(l => !l.end_date)` 不许取数组头部，否则乱序补记会卡死；离群值过滤（周期>120 天或经期>15 天的不进统计）。
- **4-3 纪念日注入**：**不做贺卡弹窗**（静怡拍板）。基于现有 milestones 数据：当天（或提前 N 天，N 可配）在聊天的**动态区**注入一行提醒（像日历备忘录：「今天是 XX 纪念日」/「3 天后是 XX」）。按静怡时区 + 4 点逻辑日算「当天」。严守缓存纪律：只进最后一条用户消息的动态注入区。

### 验收清单

- [ ] 三个开关默认关，全关时对现有功能零影响
- [ ] 小票跨 0 点不换日、过 4 点才换日
- [ ] 经期预测在前端和 MCP 工具里问出来的数字一致
- [ ] milestones 里造一条明天的纪念日，聊天里 Emet 能自然提到

---

## 第五期 · 语音（TTS/STT）——最后做，暂缓

等静怡注册 MiniMax（TTS，中文自然、支持换气/轻笑标签）和硅基流动（STT，SenseVoice）并充值后开工。届时：Worker 加两条转发路由（藏 key + 每分钟 20 次限速），前端加朗读按钮（文本清洗：去 markdown、滤方括号标签、截 500 字）和按住说话（MediaRecorder + FormData，**别用 webkitSpeechRecognition**，安卓/iOS 上都不可靠）。本期到时再细化，现在不动。

---

## 附 · 明确不做清单（防止执行模型自我发挥)

- ❌ tmux / WSL / capture-pane 轮询（用不着）
- ❌ Tailscale（与小火箭互斥，已弃）、VPS/机房（Claude Code 本体只留本机，合规最干净）
- ❌ 记忆热力图（已有）、贺卡弹窗（用注入替代）、安卓手环 Gadgetbridge/Tasker 两篇（静怡是 iPhone+Apple Watch，健康感知已完成）
- ❌ Electron 打包、GitHub Pages 托管、Nginx/Caddy（我们是 Pages+Worker，不需要）
- ❌ 任何形式的「模型自动扫聊天/自动抽记忆」
- ❌ 新增 cron、把动态内容写进缓存前缀、提取 OAuth token
