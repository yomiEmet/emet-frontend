# worker.js 睡眠样本接收方案（sleep_samples）

> 红线声明：本方案只读代码产出，**未编辑 worker.js、未部署**。所有改动由静怡人工审查后应用。
> 基线：`emet-memory/worker.js`（v6.8.2 / 5287 行）现有 `/api/health` POST 处理器，已能接 8 字段直传（heart_rate / resting_heart_rate / hrv / steps / sleep_duration_min / sleep_deep_min / sleep_rem_min / active_calories）。
> 关联：`docs/sleep-shortcut.md`（前端 Shortcut 配置）。

---

## 1. 目标

让 iOS Shortcut 上报 Apple Health 的"睡眠分析（Sleep Analysis）"原始样本数组，由 worker 端按"昨天中午 → 今天中午"窗口拼装成三个数字字段写入 `health_daily` 表。

**改动边界**：
- 表结构 `health_daily`：**不动**（8 个字段沿用）
- COALESCE UPSERT 逻辑：**不动**
- `/api/health/latest`、`/api/health/context`：**不动**
- 鉴权（`?key=` / `X-Admin-Key`）：**不动**
- `/mcp`、`/sse` 路由及响应头：**一个字符不动**

**向后兼容**：
旧客户端继续直传 `sleep_duration_min` / `sleep_deep_min` / `sleep_rem_min`（不传 `sleep_samples`）→ 行为完全不变。
新客户端只传 `sleep_samples` 数组 → 服务端计算后写入三字段。
两者同时传 → 以 `sleep_samples` 计算结果为准（覆盖直传值）。

---

## 2. 改动概览（共两块）

| 块 | 位置 | 行为 |
|---|---|---|
| A | worker.js 顶部 helper 区域 | 新增 `SLEEP_LABELS` 常量 + `parseSleepSamples()` 函数 |
| B | `/api/health` POST 处理器内、`await request.json()` 之后 / 调用 UPSERT 之前 | 4 行注入：若 body 带 `sleep_samples` 数组，调用 `parseSleepSamples` 覆盖三字段，然后从 body 删掉 `sleep_samples`（不入库） |

---

## 3. 块 A —— 完整代码（直接整段贴入）

> 建议贴在 worker.js 顶层 helper 区域，例如 `checkAuth` 函数之后、任何 `/api/*` 路由处理器之前。两段（常量 + 函数）必须放在同一作用域，函数体内引用了 `SLEEP_LABELS` 常量。

```javascript
// ── Sleep Analysis 标签归一化 ────────────────────────────────
// 不同 iOS 版本 / 数据源 / locale 给出的标签字符串不一致；
// 全部映射到 4 个规范类别，未在表里的标签会被丢弃。
const SLEEP_LABELS = {
  // Core
  'Core': 'Core',
  'Asleep Core': 'Core',
  'AsleepCore': 'Core',
  'Asleep (Core)': 'Core',
  // Deep
  'Deep': 'Deep',
  'Asleep Deep': 'Deep',
  'AsleepDeep': 'Deep',
  'Asleep (Deep)': 'Deep',
  // REM
  'REM': 'REM',
  'Asleep REM': 'REM',
  'AsleepREM': 'REM',
  'Asleep (REM)': 'REM',
  // Awake / In Bed（统一并到 Awake，进入总时长但不算"睡着"）
  'Awake': 'Awake',
  'In Bed': 'Awake',
  'InBed': 'Awake',
};

/**
 * 把 iOS Shortcuts 上报的 sleep sample 数组拼成一晚的睡眠统计。
 *
 * 输入示例：
 *   samples = [
 *     {Start: "2026-06-15T23:42:00+08:00", Duration: 47, Value: "Core"},
 *     {Start: "2026-06-16T00:29:00+08:00", Duration: 23, Value: "Deep"},
 *     ...
 *   ]
 *   dateStr = "2026-06-16"   // 目标"睡醒日期"
 *
 * 算法（对齐 README §3 的 parse_sleep_samples）：
 *   1. 按 (Start, Value, Duration) 三元组去重
 *   2. 解析 ISO 8601 时间，归一化 Value 标签，过滤异常 Duration
 *   3. 用 "昨天 12:00 → 今天 12:00"（+08:00 锚定）窗口筛选样本
 *   4. 总时长 = 窗口内最早 sample 起 → 最晚 sample 终（含 Awake）
 *   5. 按阶段累加 Core / Deep / REM / Awake，加上 sleep_start / sleep_end，共 7 字段
 *
 * @param {Array<{Start: string, Duration: number, Value: string}>} samples
 * @param {string} dateStr - "YYYY-MM-DD"
 * @returns {null | {sleep_start: string, sleep_end: string, sleep_duration_min: number, sleep_core_min: number, sleep_deep_min: number, sleep_rem_min: number, sleep_awake_min: number}}
 */
function parseSleepSamples(samples, dateStr) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;

  // 1. 去重
  const seen = new Set();
  const unique = [];
  for (const s of samples) {
    if (!s || typeof s.Start !== 'string') continue;
    const key = `${s.Start}|${s.Value}|${s.Duration}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(s);
    }
  }

  // 2. 解析时间 / 归一化标签 / 校验 Duration
  const parsed = [];
  for (const s of unique) {
    const dt = new Date(s.Start);
    if (isNaN(dt.getTime())) continue;

    const dur = Number(s.Duration);
    if (!Number.isFinite(dur) || dur <= 0) continue;
    // 单条 sample 超过 14 小时大概率是单位错误（秒被当成分钟），直接丢弃
    if (dur > 14 * 60) continue;

    const val = SLEEP_LABELS[s.Value];
    if (!val) continue; // 未知标签丢弃

    parsed.push({ dt, dur, val });
  }
  parsed.sort((a, b) => a.dt - b.dt);
  if (parsed.length === 0) return null;

  // 3. 窗口筛选：昨天 12:00 → 今天 12:00（+08:00 锚定）
  //    Shortcut 上报的 Start 是带 offset 的 ISO 8601；
  //    new Date() 解析后内部统一是 UTC 毫秒，比较时不受 worker 时区影响。
  const noonToday = new Date(`${dateStr}T12:00:00+08:00`);
  if (isNaN(noonToday.getTime())) return null;
  const noonYesterday = new Date(noonToday.getTime() - 24 * 3600 * 1000);
  const night = parsed.filter((s) => s.dt >= noonYesterday && s.dt < noonToday);
  if (night.length === 0) return null;

  // 4. 总时长 = 最早 sample 起 → 最晚 sample 终
  const sleepStart = night[0].dt;
  const last = night[night.length - 1];
  const sleepEnd = new Date(last.dt.getTime() + last.dur * 60_000);
  const totalMin = Math.max(0, Math.round((sleepEnd - sleepStart) / 60000));

  // 5. 按阶段累加（4 个标签全部出字段：与 worker.js HEALTH_FIELDS 的 7 个 sleep_* 一一对应）
  const stages = { Core: 0, Deep: 0, REM: 0, Awake: 0 };
  for (const s of night) {
    stages[s.val] += s.dur;
  }

  // HH:MM 用东八区表示（worker 默认 UTC，+8h 后取 ISO 的 HH:mm 段）
  const fmt = (d) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16);

  return {
    sleep_start: fmt(sleepStart),
    sleep_end: fmt(sleepEnd),
    sleep_duration_min: totalMin,
    sleep_core_min: stages.Core,
    sleep_deep_min: stages.Deep,
    sleep_rem_min: stages.REM,
    sleep_awake_min: stages.Awake,
  };
}
```

---

## 4. 块 B —— 注入点和完整代码

### 4.1 精确定位注入点

在 `/api/health` 的 POST 处理器内部，找到这样的代码结构（伪代码示意，行号以实际 worker.js 为准）：

```javascript
// 既有大致结构（示意，请按实际 worker.js 对位）
if (path === '/api/health' && method === 'POST') {
  // ① 鉴权
  if (!checkAuth(request, env)) return new Response('unauthorized', { status: 401 });

  // ② 解析 body
  const body = await request.json();

  // ③ 校验 date 等字段
  const date = body.date;
  if (!date) return new Response('missing date', { status: 400 });

  // ④ ◀────── [新增注入点在这里，③ 之后、⑤ 之前] ──────▶

  // ⑤ UPSERT 到 health_daily
  await env.DB.prepare(`
    INSERT INTO health_daily (date, heart_rate, resting_heart_rate, hrv, steps,
      sleep_duration_min, sleep_deep_min, sleep_rem_min, active_calories)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      heart_rate         = COALESCE(excluded.heart_rate,         heart_rate),
      resting_heart_rate = COALESCE(excluded.resting_heart_rate, resting_heart_rate),
      hrv                = COALESCE(excluded.hrv,                hrv),
      steps              = COALESCE(excluded.steps,              steps),
      sleep_duration_min = COALESCE(excluded.sleep_duration_min, sleep_duration_min),
      sleep_deep_min     = COALESCE(excluded.sleep_deep_min,     sleep_deep_min),
      sleep_rem_min      = COALESCE(excluded.sleep_rem_min,      sleep_rem_min),
      active_calories    = COALESCE(excluded.active_calories,    active_calories)
  `).bind(date, body.heart_rate, body.resting_heart_rate, body.hrv, body.steps,
          body.sleep_duration_min, body.sleep_deep_min, body.sleep_rem_min,
          body.active_calories).run();

  // ⑥ 返回 success
  return Response.json({ success: true, item: ... });
}
```

### 4.2 注入代码（贴入"④"位置）

```javascript
// 若客户端传了原始 sleep_samples，则用它计算覆盖 7 个 sleep 字段。
// 直传的 sleep_*（任意子集）仍生效（向后兼容）；
// 两者并存时以 sleep_samples 计算结果为准。
// Object.assign 一次性把 parseSleepSamples 返回的 7 字段全部塞进 body，
// 下面的 COALESCE 循环按 HEALTH_FIELDS 自动捡走，免去重复写 7 行赋值。
if (Array.isArray(body.sleep_samples)) {
  const parsed = parseSleepSamples(body.sleep_samples, date);
  if (parsed) Object.assign(body, parsed);
  // 不写库，只用一次；防止误入未来新增的列
  delete body.sleep_samples;
}
```

### 4.3 注入后的完整 POST 处理器骨架（对照确认）

```javascript
if (path === '/api/health' && method === 'POST') {
  if (!checkAuth(request, env)) return new Response('unauthorized', { status: 401 });

  const body = await request.json();
  const date = body.date;
  if (!date) return new Response('missing date', { status: 400 });

  // ▼▼▼ 新增：sleep_samples → 7 个 sleep_* ▼▼▼
  if (Array.isArray(body.sleep_samples)) {
    const parsed = parseSleepSamples(body.sleep_samples, date);
    if (parsed) Object.assign(body, parsed);
    delete body.sleep_samples;
  }
  // ▲▲▲ 新增结束 ▲▲▲

  await env.DB.prepare(`INSERT INTO health_daily ... ON CONFLICT ... `).bind(
    date,
    body.heart_rate,
    body.resting_heart_rate,
    body.hrv,
    body.steps,
    body.sleep_duration_min,
    body.sleep_deep_min,
    body.sleep_rem_min,
    body.active_calories,
  ).run();

  return Response.json({ success: true, item: ... });
}
```

---

## 5. 验收用例（部署后照表跑一遍）

| # | 用例 | 请求 body 关键字段 | 期望结果 |
|---|---|---|---|
| 1 | 旧客户端直传（向后兼容） | `{date:"2026-06-16", sleep_duration_min:420, sleep_deep_min:80, sleep_rem_min:90}` | 三字段按传入值写入；行为与改动前一致 |
| 2 | 新客户端样本数组 | `{date:"2026-06-16", sleep_samples:[4 条样本]}` | 三字段由 `parseSleepSamples` 计算后写入；返回值里能看到合理数字 |
| 3 | 空数组 | `{date:"2026-06-16", sleep_samples:[]}` | parsed = null → 不覆盖；三字段保持上次值（COALESCE） |
| 4 | 数组非法（字符串/对象） | `{date:"2026-06-16", sleep_samples:"x"}` | `Array.isArray` 为 false → 跳过整个分支；不影响其它字段写入 |
| 5 | 全是未知标签 | `{date:..., sleep_samples:[{Start:"...",Duration:30,Value:"Foo"}]}` | parsed.length=0 → null → 不覆盖 |
| 6 | 跨午夜样本 | 23:42 Core + 00:29 Deep + 00:52 REM + 01:30 Awake + 01:42 Core | 都进 noon-to-noon 窗口，total ≈ 各 dur 累加 |
| 7 | 完全在窗口外 | 全是当天下午的午睡样本（13:00-14:00） | 不进窗口 → null → 不覆盖夜间睡眠 |
| 8 | Duration 单位错误（用了秒） | 一条 `Duration: 2820`（= 47 分钟的秒数） | > 14×60 阈值过滤掉，避免把秒当分钟累加成天文数字 |
| 9 | date 格式错误 | `{date:"06/16/2026", sleep_samples:[...]}` | 正则不匹配 → 返回 null → 不覆盖；同时上游 date 校验应该已经先拒绝 |
| 10 | 同一段 sample 重复两次（多设备同步） | 两条完全相同的 `{Start, Value, Duration}` | 去重后只算一次 |

---

## 6. 部署命令（沿用既有规矩）

```bash
# 在 emet-memory/ 仓库里
npx wrangler deploy worker.js --no-bundle --name emet-memoty-v66
```

部署后建议立刻 `curl` 跑用例 1 + 用例 2 各一次确认（用例 1 验证未破坏旧行为，用例 2 验证新路径生效）：

```bash
# 用例 1：旧客户端直传（应该 success: true，sleep_duration_min=420）
curl -X POST "https://emet-memoty-v66.aandxiaobao.workers.dev/api/health?key=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-06-16","sleep_duration_min":420,"sleep_deep_min":80,"sleep_rem_min":90}'

# 用例 2：新客户端样本数组（应该 success: true，三字段为计算值）
curl -X POST "https://emet-memoty-v66.aandxiaobao.workers.dev/api/health?key=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "date":"2026-06-16",
    "sleep_samples":[
      {"Start":"2026-06-15T23:42:00+08:00","Duration":47,"Value":"Core"},
      {"Start":"2026-06-16T00:29:00+08:00","Duration":23,"Value":"Deep"},
      {"Start":"2026-06-16T00:52:00+08:00","Duration":38,"Value":"REM"},
      {"Start":"2026-06-16T01:30:00+08:00","Duration":12,"Value":"Awake"},
      {"Start":"2026-06-16T01:42:00+08:00","Duration":55,"Value":"Core"}
    ]
  }'

# 验收：拉一次 latest 确认结果落库
curl "https://emet-memoty-v66.aandxiaobao.workers.dev/api/health/latest?key=YOUR_KEY"
```

---

## 7. 回滚方案

如果上线后发现问题，**两步回滚**：

1. **应急（不重新部署）**：客户端 Shortcut 临时停传 `sleep_samples` 字段；服务端 `if (Array.isArray(body.sleep_samples))` 分支自然不会进入，行为退回旧版。
2. **彻底**：从 worker.js 中删除块 A 的两段（`SLEEP_LABELS` + `parseSleepSamples`）、删除块 B 的注入代码，重新 `npx wrangler deploy`。表结构没动，无须迁移。

---

## 8. 不在本方案范围

- **多时区支持**：当前 noon-to-noon 窗口硬编码 `+08:00`（北京/Apple Watch 上报时区）。如果将来要支持多时区，需要把时区改成入参（body 里加 `tz` 字段，或从请求头解析）。
- **Core / Awake 字段化**：表里没有这两列；若将来想在前端显示"Core 时长"或"清醒次数"，需要先做表迁移再扩 parseSleepSamples 的返回结构。
- **白天小睡**：当前算法只算"昨天中午 → 今天中午"窗口内的所有 sample，午睡也会被吞掉。如果想区分夜间睡眠和小睡，需要换更复杂的"主睡眠段检测"算法（找最长连续 sample 串），不在本期。
