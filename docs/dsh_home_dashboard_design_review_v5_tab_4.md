# DeepSeek Harness (dsh-mobile-app) 移动端四大 Tab 全景 UI/UX 规范 (v6.2 · 汲取 woaiys3 实战精华)

- **面向读者**：DeepSeek Coding Agent（负责 `App.tsx` 与 `src/ui/home/` 工程落地）
- **目标设备基准**：`436dp × 970dp`（1200×2670 @2.75，Android 旗舰屏宽）
- **核心设计哲学（v6.2 完整版）**：
  1. **Tab 1「聚焦（Focus）」**：上半屏（64%）用 `2×2` 双列卡片只聚焦「待审批 + 进行中」会话（剔除定时任务），支持**轻点进入、按住卡片直接语音回复（“继续/可以/yes”）**；下半屏（36% 黄金分割区）放置一枚**呼吸语音动画球**，按住说话即刻在默认 `mobile` 工作区新建会话。
  2. **Tab 2「全部会话（Workspaces）」**：彻底剥离圆角阴影胶囊背景，采用类似纸质书目录的 **左导轨竖线 (`1dp`) + 纯排版行**；吸收 `woaiys3/deepseek-harness-android-app` 的核心实战经验，加入**`mobile` 区一键迁出**、**坏附件无损降级自愈（不删上下文）**与**底部折叠回收站（软删除可随时原位恢复）**。
  3. **Tab 3「定时任务（Schedules）」**：定位为「静默巡航账本（Silent Autopilot Ledger）」。以等宽 Cron 标签 + 最近一次执行摘要的纯文字行呈现；点击可原地展开最近 3 次 `[PASS / WARN]` 耗时账本与 `[立即跑一次]`；右上角提供 **`[🎤 语音设任务]`**（说一句“每天凌晨三点跑一次依赖审计”自动转 Cron）。
  4. **Tab 4「插件（Plugins）」**：参考 `woaiys3` 的架构，打造无框分组式「能力与桥接矩阵」——分为**远程网关 MCP 插件**（如 `:browser` 独立进程 AI 语义浏览器，点开可看活跃页签 `browser_tabs` 并支持一键重置浏览器进程而不中断引擎）与**本机协同桥接**（无障碍读屏 / Shizuku 虚拟屏状态），顶栏右侧配有一键 **`[🩺 内核自检]`**。

---

## 零、 他山之石：从 `github.com/woaiys3/deepseek-harness-android-app` 汲取什么、摒弃什么？

我们调研了 `woaiys3/deepseek-harness-android-app`（v1.20.1，678 Stars）。该仓库走的是「把完整 Node.js 引擎塞进 APK + 本地 Shizuku/无障碍操控手机」路线，而我们的 `dsh-mobile-app` 是通过 `dsh-mobile-v1` 协议连接远程开发机的纯正 React Native 客户端。两者的取舍原则如下：

| `woaiys3` 的特性模块 | 对我们的价值评估 | 转化为我们「漫反射电纸书极简语言」的具体设计 |
| :--- | :--- | :--- |
| **1. 会话管理 + 坏附件自愈 + 回收站**<br>*(v1.19.3 / v1.19.4)* | **极高价值（必采纳）**：移动端误删会话或因某条损坏的图片/大文件附件导致整条会话打不开是高频痛点。`woaiys3` 提出铁律：**「删除 = 先进回收站（随时一键原位恢复），任何修复绝不靠删掉整条会话解决」**。 | 在 Tab 2「全部会话」的无框列表中：<br>• 每行右侧配轻量 `⋯` 触发器，点开原地浮现一行纯文字动作条：`[🩺 仅降级坏附件 (保留上下文)]` 与 `[移入回收站]`；<br>• 列表最底部常驻一行安静的折叠栏：`回收站 (N) · 展开恢复 ⌄`，点开即可 `[原位恢复]` 或二次确认 `[彻底清除]`。 |
| **2. AI 语义浏览器 (`:browser` 独立进程 + `browser_tabs`)**<br>*(v1.19.6 / v1.20.1)* | **极高价值（必采纳）**：DSH 的 AI 浏览器靠 DOM 语义快照（稳定 `ref` 指纹 + `fromGeneration` 差分）操作网页，且支持多页签与独立进程重置。 | 在 Tab 4「插件」页中：<br>• 点击展开 `@dsh/plugin-browser` 行，原地展示当前活跃的浏览器页签列表（`title + domain`）与工具芯片（`snapshot{includeText}`, `browser_tabs` 等）；<br>• 提供 `[重置 :browser 进程]` 纯文字按钮，当远程无头浏览器卡死时一键丢弃重启，不伤及主引擎与会话。 |
| **3. 内核自检与自愈账本 (`heal-ledger`)**<br>*(v1.19.1)* | **中高价值（轻量化采纳）**：用户遇到连接或工具异常时，需要一个不神秘的“一键体检”入口。 | 在 Tab 4「插件」页顶栏右侧放置一枚克制的等宽胶囊 `[🩺 内核自检]`，点击后 1 秒内校验网关连接、协议版本、工作区挂载与令牌状态，完成后显示 `✓ 账本完好`。 |
| **4. 控制台照片背景 / 视差模糊 / 50+ 文案键自定义** | **果断摒弃**：花哨的照片背景和毛玻璃违背了我们「漫反射电纸书（暖石纸 `#F4F2ED` / 暖炭灰 `#252522`）、零注意力分散」的初衷。 | 坚持 100% 纯粹单色灰阶与排版秩序，绝不引入花哨壁纸或重度圆角卡片嵌套。 |

---

## 一、 四大 Tab 页面 436dp × 970dp 像素级结构图

### 1.1 Tab 1：「聚焦首页（Focus Home）」—— 2×2 双列直回 + 36% 黄金比例语音球

```text
+-------------------------------------------------------------------+  0dp (SafeArea Top)
| [1] 极简顶栏 (48dp)                                               |
|  DSH  tokyo-gateway ●                                  [⌕ 搜索]   |
+-------------------------------------------------------------------+  48dp
| [2] 上半屏 62%：双列实时聚焦网格 (2×2 Focus Grid · 最多 4 张)     |
|  ACTIVE FOCUS · 待审批与进行中          点按进入 · 长按直接语音回  |
|  +-----------------------------+   +-----------------------------+|
|  | ● core              [待审批]|   | ● mobile-ios        进行中 || <- 宽 197dp × 高 138dp
|  | 重构 MCP 连接池并修复超时   |   | 优化底部审批抽屉阻尼反馈   ||
|  | 已完成根因定位并生成防泄漏… |   | 已将抽屉展开阈值锁定 72pt… ||
|  | #01 · 1m42s     🎤 按住直回 |   | #02 · 38s       🎤 按住直回 ||
|  +-----------------------------+   +-----------------------------+|
|  +-----------------------------+   +-----------------------------+|
|  | ● router            [待审批]|   | ● sandbox           [待审批]||
|  | 流式 XML <think> 零拷贝解析 |   | 收紧 Linux Landlock 白名单 ||
|  | 内存分配下降 82%，待审批…   |   | 含高危清理命令需长按确认…   ||
|  | #04 · 54s       🎤 按住直回 |   | #05 · 1m15s     🎤 按住直回 ||
|  +-----------------------------+   +-----------------------------+|
+-------------------------------------------------------------------+  ~600dp (0.618 黄金分割线)
| [3] 下半屏 38%：黄金比例语音动画球 (Voice Orb Stage · 高 ~296dp)  |
|                  默认归属工作区: mobile                           |
|                        ( ( (  🎤  ) ) )                           | <- 80dp 核心球 + 双层同心呼吸环
|                 按住说话 · 在 mobile 区新建会话                   |
|                 无需先选目录，后续可随时移入其他项目               |
+-------------------------------------------------------------------+  914dp
| [4] 底部四格 Tab 栏 (56dp · 进入会话页后自动隐藏)                 |
|      [ 聚焦 4 ]       全部会话        定时任务         插件       |
|         ━━━                                                       |
+-------------------------------------------------------------------+  970dp
```

### 1.2 Tab 2：「全部会话（All Workspaces）」—— 无框左导轨目录 + 坏附件自愈 + 回收站

彻底去掉圆角卡片背景与阴影，仅靠 **字重对比 + 左侧 `1dp` 缩进导轨线 + 极细底部分割线** 组织层级：

```text
+-------------------------------------------------------------------+
| 全部工作区与会话目录                                       5 活跃 |
| 纯排版左导轨列表 · 含坏附件无损自愈与回收站保护                   |
| ----------------------------------------------------------------- |
| ▾ mobile  [手机语音默认区]                                     1  | <- 置顶默认工作区
|   │ 排查网关 WebSocket 心跳重连抖动            移至工作区 ›   ⋯  |
|   │ #06 · 0m04s · DeepSeek-R1                                     |
|   │ [归入工作区:  core   router   cli ]                           | <- 点「移至工作区 ›」原地展开
|                                                                   |
| ▾ deepseek-harness/core                                        1  |
|   │ ● 重构 MCP 连接池并修复偶发超时                    1m42s  ⋯  |
|                                                                   |
| ▸ deepseek-harness/router                           [● 待审批] 1  | <- 折叠组若有阻塞项显示穿透徽章
|                                                                   |
| ▾ deepseek-harness/cli                                         1  |
|   │ ○ 生成 v0.4.2 变更日志与二进制签名     [可自愈修复] 2m10s ⋯  |
|   │   🩺 仅降级坏附件 (保留完整正文与账本)            移入回收站  | <- 点 ⋯ 或自愈标签原地展开操作行
| ----------------------------------------------------------------- |
| 回收站 (1) · 任何修复绝不靠硬删会话解决                收起 ⌃     |
|   │ 历史调试草稿：验证 Bionic libc 管道回显   原位恢复  彻底清除  |
+-------------------------------------------------------------------+
```

### 1.3 Tab 3：「定时任务（Schedules）」—— 静默巡航账本 + 语音一句话设 Cron

定时任务本质是后台守护进程（Autopilot），不需要卡片堆砌，采用 **等宽 Cron 表头 + 执行摘要 + 可展开微账本**：

```text
+-------------------------------------------------------------------+
| 定时巡航账本 (Autopilot)                         [🎤 语音设任务]  |
| 静默规律运行 · 仅异常时唤醒你介入                                 |
| ----------------------------------------------------------------- |
| ● 0 03 * * * (每天 03:00)                          [ON · 巡航中]  |
| 每日凌晨 Cargo 依赖安全审计与 CVE 扫描                      core  |
| 扫描 184 个 crate，0 高危漏洞，rustls 已自动锁定补丁小版本。      |
| 上次: 今天 03:00 (42s) · 下次: 12小时后     立即跑一次  收起账本  |
|   │ [PASS] 今天 03:00  0 CVE · 产物哈希一致                  42s  | <- 原地展开最近 3 次执行账本
|   │ [PASS] 昨天 03:00  自动更新 Cargo.lock                   39s  |
| ----------------------------------------------------------------- |
| ● */30 * * * * (每 30 分钟)                        [ON · 巡航中]  |
| 网关孤儿进程与 /tmp 沙盒快照定期回收                     sandbox  |
| 回收 3 个超时 stdio 句柄，释放 412MB 临时快照空间。               |
| 上次: 16分钟前 (6s) · 下次: 14分钟后        立即跑一次  最近记录  |
+-------------------------------------------------------------------+
```

### 1.4 Tab 4：「插件（Plugins）」—— 远程网关 MCP 与本机桥接矩阵 + 一键自检

```text
+-------------------------------------------------------------------+
| 插件与移动端特权桥接                               [🩺 内核自检]  |
| 远端 MCP 工具链 · 本机无障碍/虚拟屏按需授权                       |
| ----------------------------------------------------------------- |
| 远程网关 MCP                                                      |
| ----------------------------------------------------------------- |
| ● AI 语义浏览器  [:browser 独立进程]                      [启用]  |
| 2 页签活跃 · DOM 差分快照                                         |
|   │ 基于稳定 ref 指纹与 fromGeneration 差分快照操作网页…          |
|   │ [open] [snapshot{includeText}] [click] [type] [browser_tabs]  |
|   │ 活跃页签 (browser_tabs)                     重置 :browser 进程|
|   │ · Rust tokio::process::Command Docs                  docs.rs  |
|   │ · GitHub PR #482 · MCP Pool Fix                   github.com  |
| ----------------------------------------------------------------- |
| ● Workspace 文件与 Shell 沙盒  [Landlock ABI v3]          [启用]  |
| 读写受控 · 高危命令需长按                                         |
| ----------------------------------------------------------------- |
| 本机协同桥接 (可选扩展)                                           |
| ----------------------------------------------------------------- |
| ● 安卓无障碍屏幕助手  [免 Root · A11y]                    [启用]  |
| 已就绪 · 可读控件树 + scroll.atEdge 边界感知                      |
| ○ Shizuku 特权与虚拟屏 vscreen  [Shizuku / Shell]         [停用]  |
| 未激活 · 按需开启后台虚拟屏                                       |
+-------------------------------------------------------------------+
```

---

## 二、 四大 Tab 像素与 Token 规格表（`src/theme/tokens.ts`）

所有四个 Tab 页面共享顶栏（`48dp`）与底栏（`56dp`），中间主内容区净高约 `866dp`，左右统一内边距 `paddingHorizontal: 20`（内容净宽 `396dp`）：

| 页面与组件 | 布局与尺寸参数 | 颜色与边框 Token（零卡片套娃） | 交互与触觉反馈 (`haptics.ts`) |
| :--- | :--- | :--- | :--- |
| **Tab 1 双列聚焦卡**<br>`FocusGridCard` | `width: '48.5%'`<br>`height: 138`<br>`padding: 12`<br>`borderRadius: 16` | • 待审批：`bg: t.bg.elevatedAnswer, border: 1dp t.semantic.gateAmberText`<br>• 进行中：`bg: t.bg.surface, border: hairline t.border.default`<br>• 按住说话态：`bg: t.action.primaryBg` | • 轻点 (`<220ms`)：`tapFeedback()` → 进入会话<br>• 按住 (`>=220ms`)：`tickFeedback()` → 卡片反色并激活声波直回，松手发送并触发 `successFeedback()` |
| **Tab 1 底部语音球**<br>`VoiceOrbStage` | 占下半屏 `36%`（高 `230dp~260dp`），核心球 `80×80dp`，外圈双层同心环 `104dp / 128dp` | • 常态：`bg: t.bg.elevatedAnswer, border: 1.5dp t.border.activeOrigin`<br>• 聆听态：`bg: t.action.primaryBg, color: t.action.primaryText` | 按下触发 `tickFeedback()`，松手在 `mobile` 工作区创建会话并触发 `successFeedback()` |
| **Tab 2 全部会话行**<br>`WorkspaceCleanRow` | 组头 `paddingV: 8`<br>会话行 `paddingV: 10`<br>左导轨 `marginLeft: 10, paddingLeft: 14` | • **严禁给会话行设置 `backgroundColor` 或圆角边框**<br>• 左导轨：`borderLeftWidth: 1, borderLeftColor: t.border.default`<br>• 行分割：`borderBottomWidth: hairlineWidth, borderBottomColor: t.border.subtle` | • 展开/折叠工作区：`LayoutAnimation.easeInEaseOut` + `tapFeedback()`<br>• 点 `移至工作区 ›` 或 `⋯`：原地展开单行操作抽屉 + `softFeedback()` |
| **Tab 3 定时任务行**<br>`ScheduleLedgerRow` | 每条 `paddingVertical: 12`<br>账本子行 `marginLeft: 8, paddingLeft: 12` | • 行间分割：`borderBottomWidth: hairlineWidth, borderBottomColor: t.border.default`<br>• 开关胶囊：启用为 `bg: t.action.primaryBg`，暂停为 `bg: t.bg.subtle` | • 切换 `ON/OFF`：`tapFeedback()`，发送 `{ type: 'schedule-toggle', id }`（未接通协议前本地持久化）<br>• 点击 `[立即跑一次]`：`successFeedback()` |
| **Tab 4 插件矩阵行**<br>`PluginMatrixRow` | 每条 `paddingVertical: 12`<br>工具芯片 `paddingH: 6, paddingV: 2, borderRadius: 4` | • 工具芯片：`bg: t.bg.subtle, borderWidth: hairlineWidth, borderColor: t.border.default, fontFamily: MONO, fontSize: 10` | • 点击插件标题原地展开工具芯片与 `:browser` 页签列表：`LayoutAnimation.easeInEaseOut` + `softFeedback()`<br>• 点击 `[🩺 内核自检]`：600ms 后触发 `successFeedback()` |

---

## 三、 给 DeepSeek 的分步实现路线图（Implementation Roadmap）

为了让 DeepSeek 稳步落地且不破坏现有会话流代码，建议按以下 **4 个模块** 推进：

1. **Step 1：数据与分组纯函数层（`src/protocol/home-grouping.ts`）**
   - `selectFocusGridSessions(sessions, pending)`：过滤掉定时任务（`origin === 'schedule'`），仅保留 `pending > 0` 或 `running === true` 的会话（最多 4 条），提取最新助手回复摘要。
   - `groupAllWorkspaces(sessions, workspaces, mobileMap, trashedIds)`：置顶 `mobile` 默认工作区，支持软删除过滤（`trashedIds`）与工作区迁移映射。
2. **Step 2：Tab 1「聚焦首页」组件（`src/ui/home/FocusHomeView.tsx`）**
   - 实现上半屏 `2×2` 卡片网格（内置 `220ms` 长按直接在卡片内语音回复该会话）+ 下半屏黄金比例 `VoiceOrb`（按住说话直接在 `mobile` 工作区新建会话）。
3. **Step 3：Tab 2「全部会话」无框目录组件（`src/ui/home/AllWorkspacesView.tsx`）**
   - 实现左导轨纯排版树、`mobile` 区一键迁出选择器、单行展开的 `[🩺 仅降级坏附件]` 自愈入口，以及底部的折叠回收站（原位恢复 / 彻底清除）。
4. **Step 4：Tab 3「定时任务」与 Tab 4「插件」组件（`src/ui/home/SchedulesView.tsx` & `PluginsView.tsx`）**
   - 先使用协议兼容的结构化状态渲染静默巡航账本与插件矩阵（含 `:browser` 页签展示与 `🩺 内核自检`），待网关 `schedule-*` 与插件管理帧接通后直接注入数据源。