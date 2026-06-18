# Emet Memory · 项目状态

> 教程主线「always-here 改造版」阶段进度总览。每个阶段做完，在此勾掉。

## 阶段进度

| 阶段 | 名称 | 状态 | 完成日 |
|---|---|---|---|
| 0 | Web Push 通路（VAPID + iOS PWA + SW + IndexedDB） | ✅ 完成 | 2026-06-15 |
| 1 | 健康感知（Apple Watch via iOS Shortcut → `/api/health/*`） | ✅ 完成 | 2026-06-16 |
| 2 | 凌晨守护（监控清单 App + LLM 催睡 + 30min 冷却） | ✅ 完成 | 2026-06-17 |
| 3 | 周记 / 月记自动生成（cron + opus 4.6） | ✅ 完成 | 2026-06-17 |
| 4 | 心跳系统（AI 主动找用户，cron 30min 按时段概率） | ✅ 完成 | 2026-06-18 |

---

## ⚠ Cloudflare Free Plan Cron 已装满

每个 Worker 最多 **3 条 cron triggers**。当前 `~/wrangler.toml` 已用满：

```toml
[triggers]
crons = [
  "0 15 * * sun",     # 周记（周日 23:00 CN）
  "30 15 28-31 * *",  # 月记（月末 23:30 CN，handler 内判断"明天是 1 号"才发）
  "0,30 * * * *",     # 心跳（每 30 分钟）
]
```

**再加 cron 必须先付费升级 Workers Paid（$5/月起）**。或者复用现有 30 分钟窗口在 handler 里再分发别的任务。

---

## 开关与默认状态

| 模块 | KV key | 默认 | 触发方式 |
|---|---|---|---|
| 凌晨守护 | `config:night-guard` | enabled=true / 监控 X·小红书·淘宝·Threads·哔哩哔哩 / 23:30-03:00 / 30min 冷却 | iOS Shortcut 后台自动化 → `/api/events` |
| 心跳系统（主动消息） | `config:heartbeat` | **enabled=false（默认关闭）** / 120min 冷却 | cron `0,30 * * * *` |
| Web Push 订阅 | `push:subscription` | 未订阅 | 设置 → 通知 → PushToggle |
| 周记 / 月记 | — | 自动 | cron 周日 23:00 / 月末 23:30 |

心跳系统默认关闭，开启入口：**设置页 → 通知 → 主动消息** 卡片。开启后按时段概率（早安 60% / 夜猫子 40% / 午休 30% / 下班 50% / 晚上 30% / 周末白天 25%）+ 2h 冷却判断是否真发。凌晨 1-7 点全静默。

---

## 心跳概率表（在 `worker.js` 顶部常量调）

| 时段 | 工作日 | 周末 | 备注 |
|---|---|---|---|
| 1-7 凌晨 | 静默 | 静默 | 完全不发 |
| 7-9 早安 | 60% | 60% | 全局规则 |
| 9-12 上午 | 0 | 25% | 工作日安静 |
| 12-13 午休 | 30% | 25% | |
| 13-17 下午 | 0 | 25% | 工作日安静 |
| 17-19 下班 | 50% | 25% | |
| 19-23 晚上 | 30% | 25% | |
| 23-1 夜猫子 | 40% | 40% | 全局规则，跨午夜 |

实际命中率被 2 小时冷却卡住，不会 spam。

---

## 重要约束

- `worker.js` 单文件部署，源在 `C:\Users\Administrator\Desktop\emet-memory\worker.js`（git `yomiEmet/emet-memory` main 分支）。`Desktop\Emet Memory\` 是**前端**仓库（git master）
- 后端域名：`emet-memoty-v66.aandxiaobao.workers.dev`（拼写 memoty 故意，不是 typo）
- 部署：`wrangler deploy worker.js --name emet-memoty-v66 --no-bundle`，用 `Total Upload: XXX KiB` ≈ 文件字节数 ÷ 1024 作为指纹确认部署的是正确文件
- 前端：Cloudflare Pages，推 master 自动构建（`npm run build` → `dist/`）
- 密钥不写代码、不进仓库；`ANTHROPIC_API_KEY` 走 `wrangler secret`，LLM endpoint/model 走 KV `config:llm`
