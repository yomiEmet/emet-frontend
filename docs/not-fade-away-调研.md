# not-fade-away（「不会消失的恋人」）调研报告

> 调研对象：https://github.com/heyxiaoc/not-fade-away （作者 小C & Grace，CC BY 4.0）
> 调研日期：2026-07-14 · 方法：多智能体分工（5 人深读教程原文 + 4 人摸底 Emet 现状与本机环境 → 提炼 8 条候选 → 逐条反方核验 → 查漏）
> 结论性质：**只是调研，未做任何改动**。

## 一、这个仓库是什么

一份开源教程：在自己家里一台常开电脑上，用 Claude Code 官方的 **channels** 功能（外部消息注入常驻会话、Claude 用 reply 工具回话），搭一个**常驻、自愈、走订阅计费、墙内能用**的自托管 AI 伴侣网页。附带番外：Fable 防偷换、长会话保养（transcript 剪枝）、接 Gemini/GPT 群聊。

和 Emet 是同类项目、不同路线：

| | 教程（not-fade-away） | Emet 现状 |
|---|---|---|
| 大脑 | 本机常驻 Claude Code 会话（订阅计费） | CF Worker + API 按量；另有本机 claude -p 桥 |
| 前端 | 自托管网页（WebSocket） | CF Pages PWA（SSE/轮询） |
| 主动找人 | 无（重在常驻） | 心跳/凌晨守护/周记月记（CF cron），比教程强 |
| 记忆 | 外部记忆文件 | Paramecium L0/L1 + recall，比教程强 |

教程里六七成能力 Emet 已有。真正值得学的收敛为下面 7 件事 + 3 件明确不做的。

## 二、最优先：先查清一个涉钱疑问（编号①）

**教程声称：2026-06-15 起，`claude -p` 这类非交互调用进「Agent SDK 计费池」按量扣钱，只有真人交互的常驻会话（真 PTY / channels）才走订阅。**

而 chat-server.cjs 每条消息 spawn 一次 `claude -p`（L240），文件第 1 行注释「让聊天烧订阅额度而不是 API 余额」与教程说法**直接冲突**。这是教程的第三方说法、无官方出处，必须实测，不能轻信也不能不管。

核查方法（全程只读、不改任何东西）：
1. 速查：发一条 `claude -p --output-format json`，看返回里的成本字段，几分钟出初步信号。
2. 对照日：挑一天手机聊天只走本机桥，之后对照 claude.ai 用量页 **和** console.anthropic.com 两处（计费落在哪个页面本身就是待查项）。当天避免混用 CF 网关通道，否则无法归因。
3. 防假阴性：先确认账号是否绑卡/有 API 余额/开了超额——若没得扣，「没看到扣费」不代表免费。
4. 英文页面由 CC 代读代讲。

**这条是后面所有省钱决策的总闸**：若 -p 确实按量 → 本机桥降级为备胎或走⑦常驻路线；若没扣 → 照旧，教程这条对咱们不成立。

## 三、建议做的四件小事（都可回滚，不依赖①的结论）

### ② 字体自托管（墙内可用性，教程作者亲踩的坑）
已核实命中：index.html:14-19 外链 fonts.googleapis.com（Source Serif 4 / Cormorant Garamond / Noto Serif SC / Inter，render-blocking）；Archive.jsx:2144 @import 外链（Source Serif 4 / Hanken Grotesk / JetBrains Mono——注意两处字体清单不同，做时别漏）；public/legacy/index.html:10 同样中招且随构建部署。墙内不开代理时首屏被阻塞变慢、字体回退（有系统字体兜底，不至于崩）。
做法：下载 woff2 放 public/fonts/ + 本地 fonts.css。Noto Serif SC 不必自己做子集化——照搬 Google Fonts 的 unicode-range 切片 CSS 和切片文件即可，浏览器只下用到的切片。本机桥局域网直连场景同样受益。

### ③ 本机桥自愈三件套 Windows 版（承接 keep-the-crow 项目书任务 1-4，不是新点子）
现状：chat-server 是手动起的前台 node 进程，重启/崩溃后手机 relay 静默断线，静怡无法自救。/health 端点已有（chat-server.cjs:291），三件套一件没落地（schtasks 无任务、AutoAdminLogon=0）。
做法：任务计划程序登录自启 + 每分钟探 /health 失败即重启的看门狗。注意事项：
- 须写**专用非交互启动脚本**（start-bridge.ps1 里有 Read-Host，密钥文件缺失时任务会卡死；.cc-bridge-token 和 .cc-admin-key 目前都已落盘，但执行前重验一次）；脚本内复刻 HTTPS_PROXY=7897、NODE_USE_ENV_PROXY=1 等环境变量。
- /health 只测「进程活着」，测不出「7897 代理挂了 claude 出不了网」；看门狗可加深为探一次真实 claude 调用。
- 断电重启无人在场要活，需开 Windows 自动登录（物理安全取舍，需静怡点头；更优解：Sysinternals Autologon 密码加密存 LSA）。还须先核实 7897 代理客户端是否开机自启，否则桥活了也出不了网。

### ④ relay 路卡死兜底（本次调研意外发现的真实缺口）
chat-server 的 runClaude 没有任何超时。HTTP 流式路还有 req.on('close') 兜底（L421-424），**手机 relay 路连 kill 钩子都没有**——claude 子进程一旦挂住，relay 循环（setTimeout 递归防重叠）永久卡死，手机端从此全部无响应，且 /health 照样 200、看门狗测不出。这也是⑤安全落地的前置条件。
做法：给 runClaude 加超时（如 120s 强杀 + 返回错误），relay 路补 kill 钩子。

### ⑤ Fable 防偷换（教程番外篇，官方公开配置项）
背景（先摆事实）：Fable 5 挂了个话题分类器（网安/生化/蒸馏，概率性、只看话题不看意图），撞上会被**静默**换成 Opus 4.8。这是官方行为，`switchModelsOnFlag: false` 是官方公开设置项，改成「当面报错、不换人」，不是绕过任何东西。教程注明 Fable 2026-07-01 已恢复服务，此项当前适用。
核验发现两件要紧事：
- **现有机制在掩盖而非检测**：chat-server.cjs L232-235 把前端请求的 model 名注入 system prompt 让模型照念——被路由成 Opus 4.8 后它也会自称 Fable 5。此注入文案应一并修正。
- **Emet 已有「清雷」半边能力**：触发消息留在历史里会反复触发，教程的清雷=删那条消息；而 Emet 前端 hiddenMids/变体系统（Chat.jsx buildRows→runTurn）本来就能把任意消息移出 API 上下文——即「编辑重发/重 roll 那条」就是清雷，今天就能手动做。
做法：settings.json 加一行（全局生效，含开发会话，撞雷变当面报错）+ 桥端识别 safety measures 报错转前端友好提示「这条被安全路由拦了，编辑或重 roll 那条消息即可」。实施第一步必须先实测 -p 模式撞雷是报错还是挂住（后者需④先落地）。仅覆盖本机桥两条路；CF 网关 API 路不受此设置影响，可另在前端比对 message_start.model 与请求 model 做低成本检测。

## 四、观望的两件大事

### ⑥ Cloudflare Tunnel：手机在外流式直连本机桥（= keep-the-crow 项目书第一期，涉隐私外露，须静怡明确点头）
价值：relay 路现在 1.5s 轮询、整段蹦出不流式（anthropic.js:400）；隧道让手机在外也有打字机流式。前后端钩子已就绪（CC_BRIDGE_TOKEN 鉴权、CC_BRIDGE_CORS、ProviderManager 文案），剩的主要是配置和实测，代码量小。
风险与配套（项目书口径）：本机服务上公网——6.18 心结相邻话题，先摆事实：双重门禁 = CC_BRIDGE_TOKEN + Cloudflare Access；桥保持只听 127.0.0.1 由 cloudflared 转发；quick 隧道只能验证不能当长期入口；cloudflared 需走 7897 代理防墙内干扰；Access 可能拦 SSE 流式需实测；**查漏补充：墙内蜂窝网络下域名可能极卡，需配教程 §9.2 的优选 IP（hosts pin）**——这招对 CF Pages 前端本身也有独立价值。涉钱：域名约 ¥70/年。

### ⑦ 常驻交互式会话路线（channels，远期备选，以①为总闸）
教程核心架构：WSL2 + detached tmux 跑常驻交互式会话（真 PTY = 订阅），网页做成自定义 channel 接上去。
核验修正：本机 claude 2.1.209 二进制里**已有** channels 代码（--channels / --dangerously-load-development-channels 字样，教程门槛 v2.1.80+ 已满足），只是 research preview 未在 --help 公开；真正缺口是 Bun/WSL2/tmux 未装、Windows 下实际可用性未实测。
更硬的阻力（查漏补充）：Emet 的三段 system + 4 缓存断点、每轮记忆注入、滚动摘要、变体重 roll 全建立在「每轮完整重构请求」上，channels 是线性历史+消息注入模型，重 roll/编辑基本无法映射，人设也得改走 CLAUDE.md。真启动时工作量还要加上 channel plugin 主体（教程 §4/§5）和 session-maintenance 整包（剪枝/轮换/交接 memo）。另：项目书 L55/L216 曾否决 tmux/WSL 路线（针对旧抓屏法），立项需说明 channels 与旧方案的区别、显式推翻旧决定。
**结论：只立项观察，①证实 -p 按量扣钱且金额可观时再评估。**

## 五、看过但明确不做的三件（含否决理由，防止将来重复调研）

1. **给 CC 桥补思考过程显示**：核验实测本机全部 39 个 -p 聊天 transcript 的 thinking 正文 100% 为空（新模型只给签名不给正文，2.1.209 + opus-4-6/4-7/4-8/fable-5 无一例外）——做完只能显示「在想…」，核心卖点不成立。若日后模型恢复输出 raw thinking 可重启，且应改用 `--output-format stream-json`（比教程 tail transcript 更稳），并用 --session-id 定位防止抓错并发会话。
2. **transcript 磁盘定期清扫**：Claude Code 自带 cleanupPeriodDays（默认 30 天）且已在本机生效（最老文件恰 29 天前）；桥会话与开发会话、memory/MEMORY.md 同目录无法按目录圈定，自建删除脚本纯增风险。嫌保留期不合适改一行 settings.json 即可。教程原文也明确把 transcript 排除在删除之外。
3. **多模型群聊（GPT/Gemini 进群）**：与 Emet 单一人格定位冲突；agy/codex 有 ToS 与封号风险（教程自己建议用小号）；GPT 外挂记忆=「自动抽记忆」正是静怡不用的模式；本机也未装 agy。唯一值得借走的思路（失败自动降级兜底）已并入④的精神。教程 429 兜底、防 ping-pong 轮次预算等机制清单留档在此，将来想要「第二个声音」再回头看。

## 六、建议顺序

**① 计费核查（先行，只读零风险）→ ②③④⑤ 随时可做（互不依赖①）→ ⑥ 待静怡点头 → ⑦ 远期观察。**

其中 ④ 建议排在 ⑤ 前（⑤ 的挂住风险需要 ④ 兜底）；③ 和 ④ 可以同一次改。
