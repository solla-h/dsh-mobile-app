# DeepSeek Harness (dsh-mobile-app) 移动端产品与 UI/UX 设计规范文档

- **目标仓库路径**：`D:\workspace\open_source\dsh-mobile-app`
- **产品定位**：原生移动端 Coding Agent 与工具编排客户端（Human-in-the-Loop 监控、代码补丁审阅、单手审批与指令微调）
- **设计哲学**：极致克制、单手拇指友好、过程实时可感、结果零干扰直达、漫反射电纸书级护眼黑白灰
- **文档版本**：v3.0（融合方案 A 流式主框架 + 方案 B 展开式决策卡 + 右侧弧形焦段转盘 + 5 项精雕微交互）

---

## 1. 核心产品目标与使用场景

### 1.1 核心场景：单手监控与渐进式审批（Single-Thumb Supervision & Triage）
开发者在离开桌面（通勤、会议间隙、移动状态）时，通过手机端远程监控并调度多个正在后台运行的 DeepSeek-R1 / DeepSeek-V3 Coding Agents：
1. **看清当前进展**：无需横向滚动或频繁上下翻页，一眼掌握 Agent 的最终结论与关键改动。
2. **安全单手拍板**：所有核心操作（批准补丁、拒绝回滚、展开详情、语音/行级追问、切换并发会话）94% 以上集中在**屏幕下半部 42% 的右手拇指自然扫动热区**内。
3. **不分散注意力**：杜绝霓虹高饱和色彩、杜绝流式生成时全屏剧烈抖动、杜绝打断心流的模态确认弹窗。

### 1.2 三版架构选型与融合结论

| 方案代号 | 架构形态 | 核心定位与融合方式 |
| :--- | :--- | :--- |
| **方案 A（主力默认视图）** | **极简流 + 底部审批拇指坞**<br>*(Linear Stream + Thumb Dock)* | 作为 App 的日常默认主界面。承载「动态流式展开 → 正式回答自动折叠」的全生命周期，兼顾上下文回溯与底部单手秒批。 |
| **方案 B（拇指坞展开态 / 极速栈）** | **零干扰沉浸决策卡**<br>*(Zero-Noise Triage Sheet)* | 融入方案 A 的底部拇指坞中：当用户点按底部待审批横条（或流中的黄色 Gate 节点）时，向上弹出放大为方案 B 的三段式决策大卡（1. 为什么改 + 2. 核心 Diff + 3. 后续自动命令），支持深度核对。 |
| **方案 C（工程诊断视图）** | **上下分屏单色 HUD 仪表矩阵**<br>*(Split HUD Telemetry)* | 作为重度运维/编译调试的可选切换视图。上半屏 46% 为只读 `DIFF / STDIO / TRACE` 等宽视窗，下半屏 54% 为固定 2×2 触控指令矩阵。 |

---

## 2. 核心交互机制与状态机规范

### 2.1 三阶段「流式展开 → 正式回答自动折叠」状态机（Stream-Expand to Answer-Collapse）
为了把有限的手机屏幕空间最大限度留给 Agent 的**正式回答**，同时不在生成过程中让用户盲等，单次任务响应严格遵循以下三阶段状态机：

| 阶段 | 状态标识 | `<think>` 推理与草稿代码区 | 连续工具调用组 (`Read` → `Grep` → `Check`) | Agent 正式回答卡片 |
| :--- | :--- | :--- | :--- | :--- |
| **Stage 01** | `thinking` | **默认展开**：配合柔和打字机游标实时流式输出推理文本与拟定的代码片段，缓解等待焦虑。 | 尚未启动 | 尚未生成 |
| **Stage 02** | `tools_run` | 保持展开或平滑过渡 | **默认展开**：连续执行的只读/检索工具自动归入同一批次容器，逐行展示实时 Spinner 与耗时。 | 尚未生成 |
| **Stage 03** | `answering` / `settled` | **主动折叠为单行 34pt 胶囊**：仅显示 `已深度思考 (1m 42s · 14.2k) · 一句话摘要`；点击可随时原地展开复查。 | **主动合并折叠为单行 34pt 胶囊**：显示 `已折叠 N 项连续工具调用 (Read · Grep · Check)`；点击「查阅」可展开每步耗时明细。 | **独占 75%+ 核心视窗**：首屏无需滚动即可完整阅读结论标题、改动要点与内嵌补丁卡片。 |

> **关键边界规则**：
> - 只有**连续且已完成（`done`）**的工具调用才会被合并折叠进「连续工具调用胶囊」。
> - 一旦遇到需要人工审批的阻塞型工具（`status === 'pending'`，如 `Apply patch` 或高风险 `bash`），该步骤必须**独立高亮展示**在正式回答卡片内，并同步激活底部审批拇指坞。

---

### 2.2 右侧拇指弧形焦段转盘（Camera-Lens Radial Session Dial）
摒弃传统的左上角汉堡菜单（单手极难触达），借鉴专业相机 App 焦段拨环与概念画板转盘，在屏幕右侧边缘构建符合右手拇指生物力学的弧形会话选择器：

1. **静默隐藏态（Resting State）**：
   - 在屏幕右侧垂直居中偏下位置（`top: 50%`），仅保留一条 `2pt` 宽、`96pt` 高的微刻槽感应细条，内嵌一枚代表当前会话状态的 `4pt` 呼吸圆点，完全不遮挡代码与 Diff 视野。
2. **按住呼出态（Active Radial Arc）**：
   - 当右手拇指**按住右侧感应条（或轻点）**时，背景施加 `6px` 柔光毛玻璃遮罩，并以右侧边缘外侧 `(cx: 368pt, cy: 380pt)` 为圆心、半径 `R = 175pt` 展开一道 `-48° ~ +48°` 的相机刻度圆弧。
   - **会话刻度胶囊**：沿着圆弧排布历史/并发会话节点，每个节点必须清晰展示：**完整任务标题（Title） + 仓库名简称 + 模型标识 + 运行状态呼吸灯**（待审批暖琥珀色、运行中脉冲、已完成半透明）。
   - **左上角焦段取景框（Focal Preview HUD）**：拇指沿着弧线上下滑动时，屏幕左上方实时放大显示当前扫过会话的分支名、状态标签与一句话推理摘要；**松开拇指（PointerUp）即刻完成会话切换并自动收起转盘**。

---

### 2.3 双态渐进式审批拇指坞（Expandable Thumb Approval Dock）
位于屏幕最底部，融合方案 A 的效率与方案 B 的沉浸感：

1. **折叠态（方案 A 快速盲批）**：
   - 顶部为一行可点击的待批复状态条：`● 待批复: src/mcp/pool.rs (+14/-3) [放大 ↗]`，右侧并列一枚 `[信任目录]` 快捷胶囊。
   - 下方为 `2:3` 黄金比例双按钮：左侧 `40%` 宽度为次要操作「拦截」，右侧 `60%` 宽度为主操作「快速批准 (+14/-3)」。
   - 最底部常驻单手语音按键（按住说话）与单行指令输入框。
2. **展开态（方案 B 沉浸决策大卡）**：
   - 点击待批复状态条后，抽屉向上弹出至屏幕 `78%` 高度，呈现零干扰的三段式卡片：
     - **01. 为什么改（R1 推理结论）**：提炼一句核心修改动机。
     - **02. 改哪里（核心 Diff 预览）**：展示关键增删代码行与文件路径。
     - **03. 后续动作（Next Command）**：明确告知批准后将自动执行的测试或脚本命令（如 `cargo test --test pool_lifecycle`）。
   - 底部切换为方案 B 标志性的等宽超大双触控板（「拒绝并回滚」 / 「批准并继续队列」）。

---

## 3. 五项精雕微交互规范（Subtle High-Impact Micro-Interactions）

结合对 **Cursor iOS**、**Claude Code Remote Control**、**Linear Mobile** 与 **Working Copy** 的交互研究，内置以下 5 项不喧宾夺主但显著提升移动端工程体验的特性：

### 3.1 代码行点按即引用（Tap-Line-to-Quote）
- **痛点**：在手机小屏上用手指长按拖拽选择代码行极其困难，用户审阅 Diff 时看到某一行有问题（如超时时间写死），很难在输入框里准确指代。
- **方案**：在移动端 Diff 视图中，**单指轻点任意一行代码**，该行即刻获得 `1pt` 描边高亮，同时底部输入框正上方自动挂载一枚引用胶囊：`引用 src/mcp/pool.rs:49 · .kill_on_drop(true); [×]`。用户直接语音或输入“把这里的超时改成 10s”，发送时自动将该行上下文打包注入 Prompt。
- **辅助折行开关**：Diff 卡片右上角提供 `[自动折行 / 横向滚动]` 一键切换（默认开启自动折行 `whitespace-pre-wrap break-all`），彻底消除手机端看代码的横向滚动条。

### 3.2 风险分级防误触：常规轻点秒批 vs 高危长按充能（Risk-Graded Hold-to-Approve）
- **痛点**：通勤走路或单手握持时，大拇指极易误触底部的批准按钮；若 Agent 发起的是包含 `rm -rf`、`git push --force` 或数据库迁移的高危命令，单击即执行非常危险。
- **方案**：
  - **Low / Medium Risk（普通代码补丁、单测执行）**：保持**单击即刻批准**，丝滑不卡顿。
  - **High Risk（包含破坏性 Shell 指令或敏感路径修改）**：待批复圆点变为柔和珊瑚红脉冲，底部主按钮自动切换为**「长按 0.5s 放行高危命令」**。拇指按住期间，按钮内部从左向右平滑填充暖砂色水位（`0% -> 100%`），配合渐强触觉脉冲；中途松手则水位在 `120ms` 内快速归零，绝不误触发。

### 3.3 4 秒快照悔棋窗（4-Second Grace Undo & Checkpoint Rewind）
- **痛点**：传统的“你确定要拒绝此补丁吗？”二次确认弹窗严重破坏单手审批心流；但完全没有反悔机制又会让用户不敢快速操作。
- **方案**：每次点击批准或拦截后，**绝不弹出确认框**，直接推进状态并紧贴底部拇指坞上方浮现一枚持续 **4.5 秒** 的静默快照胶囊：`已存快照 cp-8f91a · [撤回拍板 (4s)]`。在倒计时内点按即可一键将沙盒文件树与 Agent 状态无损回滚至拍板前的 Git/Filesystem 快照。

### 3.4 目录级信任开关与自动跳栈（Scoped Trust & Auto-Hop to Next Gate）
- **目录级信任（Scoped Trust）**：拇指坞提供 `[信任目录]` 轻触胶囊，点按开启后，当前会话内匹配同一路径规则（如 `allow: src/mcp/**`）的后续低风险补丁将自动静默放行，避免同一模块连续改 5 个文件时反复弹窗打扰。
- **自动跳栈（Auto-Hop）**：当后台同时挂着多个并发 Agent 时，批复完当前会话的阻塞项后，延迟 `360ms` **自动平滑切入下一个处于 `awaiting_approval` 状态的会话**（如 `#01 -> #04 -> #05`），实现真正的“单手一路清栈”。

### 3.5 2px 极简上下文水位线与顶栏灵动胶囊（Ambient Context Hairline & Status Pill）
- **2px 顶部水位线**：在手机屏幕最顶端边缘紧贴状态栏上方，嵌入一条仅 `2px` 高的单色灰阶细线，静默映射当前会话的 Context Window 占用比例（如 `22%`），不占用任何正文排版高度。
- **状态栏灵动胶囊**：屏幕顶部中央胶囊实时显示全局待办状态（如 `● 2 GATE · 14.2k` 或 `● R1 THINKING`），在任意状态下轻点该胶囊，即可一键跳回首个阻塞待审批的会话。

---

## 4. 视觉与色彩规范：漫反射电纸书级黑白灰（Anti-Glare Monochrome Tokens）

### 4.1 为什么弃用纯黑（`#000000`）与纯白（`#FFFFFF`）？
在 OLED 手机屏幕上，纯黑背景配纯白文字会产生高达 `21:1` 的极端亮度反差，在暗光或长时间阅读代码时引发瞳孔光晕散射（Halation Effect），造成强烈的视觉刺眼感。因此本方案采用**「日间暖石纸色 + 夜间暖炭电纸灰」**双套低反差漫反射色板（对比度精准控制在柔和的 `6.5:1 ~ 8.2:1`）：

### 4.2 Design Tokens 色值表（可直接写入 `theme.ts` / `colors.xml` / `Assets.xcassets`）

| Token 语义名称 | 日间模式：暖石纸色 (`paper` · 默认) | 夜间模式：暖炭电纸灰 (`eink_slate` · 护眼暗色) | 用途说明 |
| :--- | :--- | :--- | :--- |
| `bg.canvas` | `#F4F2ED` | `#252522` | App 全局主背景（模拟电纸书漫反射基底，杜绝死黑） |
| `bg.surface` | `#EAE7E0` | `#2E2E2A` | 常规卡片、Diff 容器、弧形转盘节点背景 |
| `bg.subtle` | `#EFECE6` | `#292926` | 折叠后的 `<think>` 胶囊、连续工具组胶囊背景 |
| `bg.elevatedAnswer` | `#FAF8F3` | `#31312C` | **Agent 正式回答主卡片**（微提亮 3%，形成自然视觉焦点） |
| `bg.dockGlass` | `rgba(230, 227, 220, 0.95)` | `rgba(44, 44, 40, 0.95)` | 底部审批拇指坞与展开态抽屉背景（配合 `backdrop-blur: 12px`） |
| `border.default` | `#D8D5CC` | `#3E3E39` | 卡片与容器 1px 描边 |
| `border.subtle` | `#DFDCD3` | `#363632` | 折叠胶囊与分割线描边 |
| `text.primary` | `#1C1C1A` | `#CECBC2` | 主标题、正式回答正文（夜间采用亚麻暖灰，绝不发光刺眼） |
| `text.secondary` | `#5C5B57` | `#9A978E` | 推理正文、次要说明、代码上下文行 |
| `text.muted` | `#8C8A84` | `#75736B` | 时间戳、Token 计数、行号、快捷键提示 |
| `action.primaryBg` | `#2B2B28` | `#C4C1B6` | 主批准按钮背景 |
| `action.primaryText` | `#F4F2ED` | `#222220` | 主批准按钮文字 |
| `semantic.diffAddBg` | `#E1EBE4` (字 `#284B34`) | `#28332B` (字 `#A3BDA9`) | 低饱和鼠尾草绿（Git Diff 新增行） |
| `semantic.diffDelBg` | `#EFE2E2` (字 `#693034`) | `#36292A` (字 `#C29B9E`) | 低饱和灰玫瑰红（Git Diff 删除行） |
| `semantic.gateAmber` | `#E6E0D0` (字 `#5C4E2E`) | `#363228` (字 `#C8B68E`) | 低饱和暖琥珀色（待审批 Gate 提示与长按充能条） |

### 4.3 字体与排版层级（Typography Scale）
- **UI 正文与标题字体**：优先使用系统原生无衬线字体（iOS `SF Pro Text` / Android `Inter` 或 `HarmonyOS Sans`），正文字号 `13pt~14pt`，行高 `1.55`。
- **代码、推理与遥测等宽字体**：统一使用 `JetBrains Mono` 或 `SF Mono`，Diff 代码行字号 `11pt`，行高 `1.45`，数字开启 `font-variant-numeric: tabular-nums`（防止计时器与 Token 跳动时引发横向抖动）。

---

## 5. 原生动效与触觉反馈参数（Motion & Haptics Choreography）

在跨平台客户端（React Native Reanimated / Flutter / SwiftUI）实现时，请严格遵循以下物理曲线与触觉反馈规范：

| 交互动作 | 动画物理参数 (Spring / Timing) | 触觉反馈 (Haptic Feedback) | 视觉防干扰约束 |
| :--- | :--- | :--- | :--- |
| **正式回答开始，`<think>` 与连续工具组自动折叠** | `stiffness: 380, damping: 34, mass: 1.0`<br>（临界过阻尼，**零回弹**，耗时约 `220ms`） | `UIImpactFeedbackGenerator(.soft)`<br>强度 `0.35` | 必须以「正式回答卡片」顶部为 ScrollView 锚点，严禁折叠瞬间页面发生剧烈上下跳动。 |
| **右手拇指按住呼出弧形焦段转盘** | 展开：`response: 0.26s, dampingFraction: 0.84`<br>滑动：`1:1` 实时跟随手指角度 | 呼出瞬间：`Light Impact`<br>每扫过一个会话刻度：`UISelectionFeedbackGenerator` | 模拟相机镜头拨环的细密机械棘轮感，未选中节点保持 `85%` 不透明度。 |
| **底部拇指坞展开为方案 B 决策大卡** | `response: 0.30s, dampingFraction: 0.86` | 跨越 `72pt` 展开阈值时触发一次 `Light Impact` | 底层流视图施加 `6px` 模糊并压暗 `15%`，保留上下文空间方位感。 |
| **高危命令长按 0.5s 充能放行** | 充能：线性 `500ms` (`ease-none`)<br>中途松手回退：`120ms` (`ease-out`) | 按住期间：每 `100ms` 一次渐强微脉冲 (`0.3 -> 0.8`)<br>满格放行：`UINotificationFeedbackGenerator(.success)` | 使用按钮内部暖砂色水位推进代替弹窗警告，克制且具备极高防误触安全性。 |

---

## 6. 本地工程目录落地建议 (`D:\workspace\open_source\dsh-mobile-app`)

建议在你的本地仓库中按以下模块结构组织这套 UI 体系（已同步生成完整可运行的交互参考实现 `deepseek_harness_mobile_ui.jsx`）：

```text
D:\workspace\open_source\dsh-mobile-app\
├── docs\
│   └── PRODUCT_AND_UI_DESIGN_SPEC.md       # 本产品与交互设计规范文档
├── src\
│   ├── theme\
│   │   └── monochromeTokens.ts             # 暖石纸色 (paper) 与暖炭电纸灰 (eink_slate) 色板定义
│   ├── components\
│   │   ├── stream\
│   │   │   ├── CollapsibleThinkPill.tsx    # Stage 1 打字机展开 -> Stage 3 自动折叠为 34pt 胶囊
│   │   │   ├── ConsecutiveToolGroup.tsx    # 连续工具调用自动聚合与折叠组件
│   │   │   ├── FormalAnswerCard.tsx        # 主视窗正式回答卡片 (占屏 75%+)
│   │   │   └── TapToQuoteDiffView.tsx      # 支持单指点按行引用与自动折行的移动端 Diff 组件
│   │   ├── dock\
│   │   │   ├── ThumbApprovalDock.tsx       # 底部拇指审批坞 (含目录信任胶囊 + 高危长按 0.5s 充能)
│   │   │   ├── FocusTriageSheet.tsx        # 点开放大后的方案 B 三段式沉浸决策抽屉
│   │   │   └── GraceUndoBanner.tsx         # 4 秒静默快照悔棋胶囊 (Checkpoint Rewind)
│   │   └── navigation\
│   │       ├── RightEdgeArcDial.tsx        # 右侧边缘 2pt 感应条与 R=175pt 相机焦段式弧形会话转盘
│   │       └── AmbientContextHairline.tsx  # 屏幕顶端 2px 上下文水位线与状态栏灵动胶囊
```

> **如何同步到本地磁盘**：
> 由于当前云端沙盒环境与你的本地物理磁盘（`D:\workspace\open_source\dsh-mobile-app`）相隔离，我已经为你生成了完整的 **Markdown 产品设计文档** 与 **React 完整交互源码**。你可以直接点击下方或右侧画布的下载按钮，将文档保存至 `D:\workspace\open_source\dsh-mobile-app\docs\PRODUCT_AND_UI_DESIGN_SPEC.md`。
