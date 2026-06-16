# iOS 快捷指令「健康上报」睡眠采集配置

> 关联：`docs/sleep-patch.md`（服务端 worker.js 接收逻辑）。
> 前提：「健康上报」Shortcut 已配好 steps / heart_rate / hrv / resting_heart_rate / active_calories 五个简单聚合字段（参考会话历史里的 6 步流程）。本文档**只描述新增的睡眠采集那段**，以及它如何拼进既有 POST。
> 设备：iOS 16+ / Shortcuts 「快捷指令」app。下面的 UI 文案给出中英两版（取决于系统语言）。

---

## 0. 数据流总览

```
查找健康数据样本 (Sleep Analysis, 最近 2 天)
        │
        │ 一堆样本（含 Start / Duration / Value）
        ▼
设定变量 samples_list = ""        ← 占位，下面会被改成列表
        │
        ▼
重复，对每一项（输入：上面那堆样本）
        │
        │ 对每一条样本：
        │   ① Format Date Start → ISO 8601 → start_iso
        │   ② Duration (秒) ÷ 60 → 四舍五入 → dur_min
        │   ③ Value (文字) → stage
        │   ④ 字典 {Start: start_iso, Duration: dur_min, Value: stage}
        │   ⑤ 把这条字典追加到 samples_list
        │
        ▼
samples_list 现在是一个数组
        │
        ▼
POST 主字典里加字段：sleep_samples (Array) = samples_list
```

---

## 1. 步骤 1：查找睡眠样本

**搜索关键词**：在动作搜索框里输入 `Find` / `查找`。

**选择**：`Find Health Samples` / `查找健康数据样本`

**配置**（点动作上的各个下拉/输入位）：

| UI 位置 | 设置 |
|---|---|
| `All Health Samples` / `所有健康数据样本` 这个下拉 | 改成 `Sleep Analysis` / `睡眠分析` |
| 点 `Add Filter` / `添加筛选条件` 加一行 | `Start Date` / `开始日期` ▸ `is in the last` / `是最近` ▸ 数字框填 `2` ▸ 单位选 `Days` / `天` |
| `Sort by` / `排序方式` | `Start Date` / `开始日期` |
| `Order` / `顺序` | `Earliest First` / `最早优先` |
| `Limit` / `限制` | 关掉（保持默认"无限制"） |

> 为什么是"最近 2 天"而不是"今天"？因为睡眠窗口是"昨天 12:00 → 今天 12:00"，必须把昨晚的样本一起拉回来。worker 端会在窗口内筛掉多余的。

**这一步的输出**自动成为 Magic Variable，名字默认是 `Health Samples` / `健康数据样本`——下面会用到。

---

## 2. 步骤 2：初始化空列表

**搜索关键词**：`Set Variable` / `设定变量`。

**选择**：`Set Variable` / `设定变量`

**配置**：

| UI 位置 | 设置 |
|---|---|
| `Variable Name` / `变量名` | 输入 `samples_list` |
| `Input` / `输入` | **留空白**（点 X 清掉占位的 Magic Variable）→ 这样初始值是空字符串，后续 `Add to Variable` 会自动把它变成列表 |

> 不要用"List" action 显式建空列表——`Add to Variable` 第一次追加时会自己升级类型。Shortcuts 这点很反直觉，但是惯用法。

---

## 3. 步骤 3：循环处理每条睡眠样本

**搜索关键词**：`Repeat` / `重复`。

**选择**：`Repeat with Each` / `重复，对每一项`

**配置**：

| UI 位置 | 设置 |
|---|---|
| `Input` / `输入` | 点上去 → `Select Magic Variable` / `选取魔术变量` → 选步骤 1 的输出（`Health Samples` / `健康数据样本`） |

接下来的 5 个子动作**全部要拖到 `Repeat with Each` 和 `End Repeat` 之间**——也就是循环体内。循环内部会有一个隐式变量 `Repeat Item` / `重复项`，代表"当前这条样本"。

---

### 3.1 子动作 ①：取 Start 时间并格式化成 ISO 8601

**第 1 个：取 Start Date 详情**

**搜索关键词**：`Get Details` / `获取详细信息`

**选择**：`Get Details of Health Samples` / `获取健康样本详细信息`

**配置**：

| UI 位置 | 设置 |
|---|---|
| `Health Samples` / `健康数据样本` 这个输入 | 默认会自动填成 `Repeat Item` / `重复项`——保持默认。如果没自动填，手动点上去选 `Repeat Item` |
| `Detail` / `详细信息` 下拉 | `Start Date` / `开始日期` |

**第 2 个：把日期格式化成 ISO 8601**

**搜索关键词**：`Format Date` / `设定格式`

**选择**：`Format Date` / `设定日期格式`

**配置**：

| UI 位置 | 设置 |
|---|---|
| `Date` / `日期` 输入 | 自动填上一步的输出（`Start Date`）——保持默认 |
| `Date Format` / `日期格式` 下拉 | 选 `ISO 8601` |
| 下面新出现的 `Include Time` / `包含时间` | **开启** |
| `Type` / `类型` | `Internet` —— 这是带 `+08:00` 时区偏移的标准格式，worker 那边 `new Date(...)` 一吃就对 |

**第 3 个：把这个 ISO 字符串存进具名变量**

**搜索关键词**：`Set Variable` / `设定变量`

**选择**：`Set Variable` / `设定变量`

**配置**：

| UI 位置 | 设置 |
|---|---|
| `Variable Name` / `变量名` | 输入 `start_iso` |
| `Input` / `输入` | 自动填上一步的输出（`Formatted Date`）——保持默认 |

> 为什么要专门塞进具名变量？因为后面字典里要引用三次（如果直接用 Magic Variable，跨步骤引用容易引到错误的动作输出）。具名变量更稳。

---

### 3.2 子动作 ②：取 Duration 并换算成分钟

**第 1 个：取 Duration 详情**

**搜索关键词**：`Get Details` / `获取详细信息`

**选择**：再加一个 `Get Details of Health Samples` / `获取健康样本详细信息`

**配置**：

| UI 位置 | 设置 |
|---|---|
| `Health Samples` / `健康数据样本` 输入 | 保持自动填的 `Repeat Item` |
| `Detail` / `详细信息` 下拉 | `Duration` / `持续时间` —— **这个值的单位是秒**，下一步要除以 60 |

**第 2 个：除以 60 得到分钟**

**搜索关键词**：`Calculate` / `计算`

**选择**：`Calculate` / `计算`（注意：不是"Calculate Statistics"那个，是基础的"数学计算"动作；图标是 = 号）

**配置**：

| UI 位置 | 设置 |
|---|---|
| `Number` / `数字` 输入 | 自动填上一步的 `Duration` —— 保持默认 |
| `Operation` / `运算` | `÷` |
| `Operand` / `操作数` | 输入 `60` |

**第 3 个：四舍五入到整数**

**搜索关键词**：`Round` / `舍入`

**选择**：`Round Number` / `舍入数字`

**配置**：

| UI 位置 | 设置 |
|---|---|
| `Number` / `数字` 输入 | 自动填上一步的输出 —— 保持默认 |
| `Round to` / `舍入到` | `Ones Place` / `个位`（即整数） |
| `Mode` / `模式` | `Normal` / `正常`（四舍五入） |

**第 4 个：存进具名变量**

**选择**：`Set Variable` / `设定变量`

**配置**：

| UI 位置 | 设置 |
|---|---|
| `Variable Name` / `变量名` | 输入 `dur_min` |
| `Input` / `输入` | 自动填上一步的舍入结果 —— 保持默认 |

---

### 3.3 子动作 ③：取 Value（睡眠阶段标签）

**第 1 个：取 Value 详情**

**选择**：再加一个 `Get Details of Health Samples` / `获取健康样本详细信息`

**配置**：

| UI 位置 | 设置 |
|---|---|
| `Health Samples` / `健康数据样本` 输入 | 保持自动填的 `Repeat Item` |
| `Detail` / `详细信息` 下拉 | `Value` / `值` —— 对于 Sleep Analysis，返回的是文字（"Asleep Core" / "Asleep Deep" / "Asleep REM" / "Awake" / "In Bed"），worker 那边 `SLEEP_LABELS` 已经全包含 |

**第 2 个：存进具名变量**

**选择**：`Set Variable` / `设定变量`

**配置**：

| UI 位置 | 设置 |
|---|---|
| `Variable Name` / `变量名` | 输入 `stage` |
| `Input` / `输入` | 自动填上一步的 `Value` —— 保持默认 |

---

### 3.4 子动作 ④：组装一条字典

**搜索关键词**：`Dictionary` / `字典`

**选择**：`Dictionary` / `字典`

**配置**：点 `Add new item` / `添加新项目` 加 3 个字段：

| Type / 类型 | Key / 键 | Value / 值 |
|---|---|---|
| **Text** / 文本 | `Start` | 点上去 → `Select Variable` / `选取变量` → 选 `start_iso` |
| **Number** / 数字 | `Duration` | 点上去 → `Select Variable` → 选 `dur_min` |
| **Text** / 文本 | `Value` | 点上去 → `Select Variable` → 选 `stage` |

> 三个字段的"类型"列必须按上表分别选（不是全 Text，也不是全 Number）。Number 类型保证 JSON 输出是 `42` 而不是 `"42"`；Text 类型保证 ISO 字符串原样保留。

---

### 3.5 子动作 ⑤：追加到 samples_list

**搜索关键词**：`Add to Variable` / `添加到变量`

**选择**：`Add to Variable` / `添加到变量`

**配置**：

| UI 位置 | 设置 |
|---|---|
| `Variable Name` / `变量名` | 输入 `samples_list`（必须和步骤 2 同名） |
| `Input` / `输入` | 自动填上一步的 `Dictionary` —— 保持默认 |

到这里循环体写完。Shortcuts 会自动在最下面加一行 `End Repeat` / `结束重复`，不用手动加。

---

## 4. 步骤 4：把 samples_list 加进主 POST 字典

现在循环结束了，回到主 Shortcut 流程。找到既有的"获取 URL 内容 / Get Contents of URL"那个动作，它下面挂着一个 Request Body 的字典（你已经设过 `steps` / `heart_rate` / `hrv` 这些字段）。

**操作**：点该字典上的 `Add new item` / `添加新项目`，加这一条：

| Type / 类型 | Key / 键 | Value / 值 |
|---|---|---|
| **Array** / 数组 | `sleep_samples` | 点上去 → `Select Variable` → 选 `samples_list` |

> 注意类型必须是 **Array**——这是关键。如果选 Text，会被 stringify 成 `"[{...}]"` 字符串；选 Number 会直接报错。Array 类型才会让 JSON 输出 `[{...}, {...}]`。

不要传 `sleep_duration_min` / `sleep_deep_min` / `sleep_rem_min` 这三个字段——交给 worker 从 `sleep_samples` 算。

---

## 5. 完整 POST body 应该长这样

跑完整个 Shortcut 一次，最终发出去的 JSON 应该是：

```json
{
  "date": "2026-06-16",
  "heart_rate": 75.37,
  "resting_heart_rate": 58.2,
  "hrv": 49.59,
  "steps": 1509,
  "active_calories": 412,
  "sleep_samples": [
    {"Start": "2026-06-15T23:42:00+08:00", "Duration": 47, "Value": "Asleep Core"},
    {"Start": "2026-06-16T00:29:00+08:00", "Duration": 23, "Value": "Asleep Deep"},
    {"Start": "2026-06-16T00:52:00+08:00", "Duration": 38, "Value": "Asleep REM"},
    {"Start": "2026-06-16T01:30:00+08:00", "Duration": 12, "Value": "Awake"},
    {"Start": "2026-06-16T01:42:00+08:00", "Duration": 55, "Value": "Asleep Core"}
  ]
}
```

服务端响应（worker patch 部署后）应该是：

```json
{
  "success": true,
  "item": {
    "date": "2026-06-16",
    "heart_rate": 75.37,
    "resting_heart_rate": 58.2,
    "hrv": 49.59,
    "steps": 1509,
    "active_calories": 412,
    "sleep_duration_min": 420,
    "sleep_deep_min": 23,
    "sleep_rem_min": 38,
    "updated_at": "2026-06-16T..."
  }
}
```

---

## 6. 调试技巧（强烈建议做一遍）

直接改主 Shortcut 然后看服务端返回，万一对不上不知道是 Shortcut 错了还是 worker 错了。所以**先建一个测试 Shortcut**，只做 §1-§3 五段，最后**不发 POST，而是用 `Show Result` 动作展示 samples_list**：

1. 复制一份「健康上报」，命名为「睡眠样本预览」
2. 删掉所有非睡眠相关的动作（保留步骤 1-3 那块）
3. 在 `End Repeat` 后面加一个 `Show Result` / `显示结果`，输入选 `samples_list`
4. 跑一次，肉眼看输出是否长得像 §5 那个 `sleep_samples` 数组的样子

**人工检查清单**：
- [ ] `Start` 是 `2026-06-15T23:42:00+08:00` 这样的 ISO 字符串，不是 `Jun 15, 2026 at 11:42 PM` 之类的本地格式
- [ ] `Duration` 是合理的分钟数（10-90 之间居多，不会出现 2820 这种秒数）
- [ ] `Value` 是 `Asleep Core` / `Asleep Deep` / `Asleep REM` / `Awake` 中之一，不是数字 `0/1/2/3`，也不是中文
- [ ] 数组里的样本数大致和你昨晚 Apple Health 里看到的睡眠分段数一致（通常 10-30 条）
- [ ] 时间跨度合理（最早一条 Start ≈ 你入睡时间，最晚一条 Start + Duration ≈ 你起床时间）

四个都对了，再把这段拼进主 Shortcut + 部署 worker patch。

---

## 7. 常见踩坑

| 症状 | 原因 | 修复 |
|---|---|---|
| `sleep_samples` 是空数组 `[]` | 步骤 1 的"最近 2 天"窗口跨过 0 点写成了"今天" | 改回 `is in the last 2 days` |
| `Duration` 全是 `2820` 这种大数 | §3.2 漏了除以 60 那步 | 在 Get Details Duration 后插 `Calculate ÷ 60` + `Round Number` |
| `Value` 是数字 `0/1/2/3/4/5` | iOS 版本太老，`Get Details → Value` 返回原始枚举 | 把 worker 端 `SLEEP_LABELS` 加上 `'0':'Awake','1':'Core','2':'Awake','3':'Core','4':'Deep','5':'REM'`（按 HKCategoryValueSleepAnalysis 枚举值映射） |
| `Start` 是 `Jun 15, 2026 at 11:42 PM` | §3.1 的 Format Date 选了 `Long` / `Short` 而不是 `ISO 8601 / Internet` | 改成 `ISO 8601 / Internet`；或者扩展 worker 端 parseSleepSamples 用正则解析这种格式（不推荐） |
| 服务端返回 `sleep_duration_min: null` 或者三个 sleep 字段没变化 | `sleep_samples` 类型在主字典里选成 Text 了 | 改成 `Array` 类型；同时确认 `samples_list` 至少有 1 条且 Value 在已知标签里 |
| 整个 Shortcut 在第二个 `Get Details of Health Samples` 那里报错 | 第二/第三个 Get Details 的 Health Samples 输入没指向 `Repeat Item`，错指到了步骤 1 的整个集合 | 点那个输入框 → 选 `Repeat Item` / `重复项` |

---

## 8. 与服务端的契约（对照 docs/sleep-patch.md）

| 字段 | Shortcut 输出 | worker 端要求 |
|---|---|---|
| `Start` | ISO 8601 带时区，例如 `2026-06-15T23:42:00+08:00` | `new Date(s.Start)` 能解析（任何 ISO 8601 都行） |
| `Duration` | 整数分钟，例如 `47` | `Number(s.Duration)` 是正有限数；上限 14*60=840（防秒/分混淆） |
| `Value` | 文字标签 `Asleep Core` / `Asleep Deep` / `Asleep REM` / `Awake` / `In Bed` | 必须能在 `SLEEP_LABELS` 表里查到，否则丢弃 |

如果将来 iOS 升级导致 Value 文案变化，先改 `SLEEP_LABELS` 加映射（worker.js 块 A），不用动 Shortcut。
