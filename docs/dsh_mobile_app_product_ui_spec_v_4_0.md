# DeepSeek Harness (dsh-mobile-app) 移动端产品与 UI/UX 设计规范文档 (v4.0 · AI 代码生成零偏差蓝本)

- **目标仓库路径**：`D:\workspace\open_source\dsh-mobile-app`
- **技术栈**：Expo SDK 58 + React Native 0.88（纯 `StyleSheet.create` + 原生 `Animated` / `LayoutAnimation`，无第三方 UI 库依赖）
- **文档定位**：本文档不仅定义产品与交互规范，还针对 **DeepSeek 在实现 React Native 代码时最容易出现的 9 个视觉与状态机降级点** 提供了可直接复制替换的工程级代码蓝本（Golden Implementation）。

---

## 0. 诊断：为什么之前交给 DeepSeek 实现总是复刻不出设计效果？

通过对 `dsh-mobile-app` 现有源码的逐文件审查，我们定位出 DeepSeek 在转化设计规范时出现的 **9 个关键失真根因**（已在本次升级中全部修复）：

| 编号 | 所在文件 | DeepSeek 先前实现的失真原因 | 本次修复方案（v4.0 已直接写入源码） |
| :--- | :--- | :--- | :--- |
| **01** | `App.tsx` | 会话列表卡片背景写成了 `t.bg.canvas`（与页面底色完全相同）且无描边，导致在暖石纸色下卡片隐形、毫无层次。 | 改为 `backgroundColor: t.bg.surface` + `borderWidth: StyleSheet.hairlineWidth, borderColor: t.border.default`。 |
| **02** | `src/protocol/chat.ts` | `mapHistory` 只提取了 `type: 'text'`，完全漏掉了历史消息中的 `thinking` 块、`data.reasoning` 以及内嵌 `<think>...</think>` 标签，导致进入历史会话完全看不到 `<think>` 折叠胶囊。 | 新增 `splitThinkTags()` 与 `reasoningOfBlocks()`，无论是流式 chunk、内嵌 `<think>` 标签还是历史快照，均能 100% 还原推理胶囊。 |
| **03** | `src/ui/stream/ThinkPill.tsx` | 折叠条件写成了 `open = manual ?? Boolean(streaming)`，导致**正式回答已经开始吐字时，只要整轮流没结束，`<think>` 就一直霸占上半屏**；且缺少打字机光标 `▍` 与平滑折叠动画。 | 引入 `answerStarted={Boolean(message.text.trim())}`，一旦正式回答吐出第一个字，立即触发 `LayoutAnimation` + `softFeedback()` 自动折叠为 `34pt` 胶囊。 |
| **04** | `src/ui/stream/ToolGroup.tsx` | 工具行只渲染纯文本，没有把 `edit / write / patch` 工具的参数渲染成 `DiffView`，也没有对当前阻塞待审批的 `callId` 做琥珀色 Gate 高亮。 | 新增 `extractToolDiff()`（支持自动将 `{old_string, new_string}` 合成为标准 `+/-` Diff），在工具组内嵌 `DiffView`，并对待审批 Gate 独立高亮、点击直接呼出方案 B 大卡。 |
| **05** | `src/ui/stream/AnswerCard.tsx` | 仅包了一层空 `View`，缺少设计稿标志性的 `DEEPSEEK 正式回答 · FORMAL RESPONSE` 与 `[主视窗聚焦]` 题头栏。 | 补齐微型等宽题头栏与底部分割线，强化 Stage 03 正式回答卡片的主视窗视觉重心。 |
| **06** | `src/ui/Markdown.tsx` | 普通代码块只有「整块引用」，不支持单指点按某一行代码引用；且 Markdown 里的 `diff/patch` 代码块没有路由给 `DiffView`。 | `diff/patch` 围栏代码块自动交由 `DiffView` 渲染；所有普通代码块新增行号列、自动折行开关与**单指点按任意行即引用**。 |
| **07** | `src/ui/nav/ArcDial.tsx` | 1. 仅在 `sessions.length >= 2` 时才渲染，单会话时右侧感应条直接消失；<br>2. 只支持按住拖拽，轻点一下会瞬间闪退；<br>3. 缺少 `R=175pt` 镜头刻度环、状态呼吸灯与机械棘轮震动。 | 1. 始终展示右侧微刻槽感应条（带 3 枚镜头刻度点）；<br>2. 同时支持「按住上下滑动松手即切」与「轻点展开后点选」；<br>3. 严格按 `R=175pt (-44°~+44°)` 三角函数排布节点与 17 道镜头刻度线，每扫过一格触发 `tickFeedback()`。 |
| **08** | `src/ui/dock/ApprovalDock.tsx` | 高危长按充能进度条颜色写成了 `t.semantic.gateAmberBg`（浅米色盖在深色主按钮上对比度过奇），且没有实时显示 `长按确认中 XX%` 与 100ms 脉冲震动。 | 充能条改为 `t.semantic.gateAmberText (opacity: 0.45)`，监听动画值实时渲染 `长按确认中 ${pct}%`（开启 `tabular-nums` 防抖），每 100ms 触发脉冲震动。 |
| **09** | `src/ui/dock/GraceUndo.tsx` & `SessionScreen.tsx` | `GraceUndo` 使用了 `position: 'absolute', bottom: 8`，直接盖住了底部的消息输入框；且倒计时结束后没有实现自动跳往下一个待审批会话（Auto-Hop）。 | 改为在 Composer 正上方独立流式占位，显示 `已批准 · 快照 cp-xxxxx [撤回拍板 (4.0s)]`；倒计时结束触发 `MOTION.autoHopMs (360ms)` 自动跳栈。 |

---

## 1. 视觉与色彩规范：漫反射电纸书级黑白灰（`src/theme/tokens.ts`）

### 1.1 双套低反差漫反射色板（对比度 6.5:1 ~ 8.2:1，杜绝 OLED 死黑与刺眼纯白）

| Token 路径 | 日间：暖石纸色 (`PAPER`) | 夜间：暖炭电纸灰 (`EINK_SLATE`) | 严禁替代的错误写法 |
| :--- | :--- | :--- | :--- |
| `bg.canvas` | `#F4F2ED` | `#252522` | 严禁用 `#FFFFFF` 或 `#000000` / `#111113` |
| `bg.surface` | `#EAE7E0` | `#2E2E2A` | 列表卡片、Diff 容器必须用 `surface`，严禁与 `canvas` 同色 |
| `bg.subtle` | `#EFECE6` | `#292926` | 折叠后的 `<think>` 胶囊、连续工具组胶囊专用 |
| `bg.elevatedAnswer` | `#FAF8F3` | `#31312C` | Stage 03 正式回答主卡片专用（微提亮 3%） |
| `bg.dockGlass` | `rgba(230, 227, 220, 0.95)` | `rgba(44, 44, 40, 0.95)` | 底部审批拇指坞与 4s 悔棋胶囊专用 |
| `border.default` | `#D8D5CC` | `#3E3E39` | 卡片外框 `StyleSheet.hairlineWidth` |
| `border.subtle` | `#DFDCD3` | `#363632` | 内部行分割线、顶部 2px 水位线底槽 |
| `text.primary` | `#1C1C1A` | `#CECBC2` | 夜间主文字必须是亚麻暖灰 `#CECBC2` |
| `text.secondary` | `#5C5B57` | `#9A978E` | 推理正文、次要标签 |
| `text.muted` | `#8C8A84` | `#75736B` | 行号、时间戳、Token 统计 |
| `action.primaryBg` | `#2B2B28` | `#C4C1B6` | 主操作按钮背景 |
| `action.primaryText` | `#F4F2ED` | `#222220` | 主操作按钮文字 |
| `semantic.diffAddBg / Text` | `#E1EBE4` / `#284B34` | `#28332B` / `#A3BDA9` | 低饱和鼠尾草绿 |
| `semantic.diffDelBg / Text` | `#EFE2E2` / `#693034` | `#36292A` / `#C29B9E` | 低饱和灰玫瑰红 |
| `semantic.gateAmberBg / Text` | `#E6E0D0` / `#5C4E2E` | `#363228` / `#C8B68E` | 待审批 Gate 胶囊与长按充能进度条 |

---

## 2. 核心组件 React Native 实现约束（防走样 Checklist）

当让 DeepSeek 或其他 Coding Agent 继续迭代 `dsh-mobile-app` 时，可以在 Prompt 中直接附带以下硬性约束：

1. **三阶段折叠触发时机（`ThinkPill.tsx` & `ToolGroup.tsx`）**：
   - `ThinkPill` 的自动展开条件必须写为 `const activelyThinking = Boolean(streaming && !answerStarted)`，其中 `answerStarted = Boolean(message.text && message.text.trim().length > 0)`。
   - 状态翻转瞬间必须调用 `LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)` 与 `softFeedback()`。
2. **右侧弧形焦段转盘几何公式（`ArcDial.tsx`）**：
   - 圆心锚点固定在屏幕右侧外缘：`pivotX = width + 18`，`centerY = height * 0.48`，半径 `ARC_RADIUS = 175`。
   - 第 `i` 个会话节点的角度为 `deg = -44 + (i / Math.max(1, list.length - 1)) * 88`，弧线锚点坐标为：
     - `anchorX = pivotX - Math.cos(rad) * ARC_RADIUS`
     - `anchorY = centerY + Math.sin(rad) * ARC_RADIUS`
   - 必须同时响应「按住滑动松手即切」与「轻点耗时 `< 260ms` 保持展开供点选」两种手势。
3. **移动端 Diff 与代码块行级引用（`DiffView.tsx` & `Markdown.tsx`）**：
   - 严禁只做整块复制。每一行代码都必须包裹 `Pressable`，点击后触发 `onQuote({ file, lineNo, text })`，在底部输入框上方挂载带文件与行号的引用条。
4. **高危审批长按充能与 4.5s 快照悔棋（`ApprovalDock.tsx` & `GraceUndo.tsx`）**：
   - 命中 `approvalRisk(approval).level === 'high'` 时，底部批准按钮切换为 `onPressIn` 线性充能 `500ms` + 每 `100ms` 触发一次 `tickFeedback()` + 实时百分比文字 `长按确认中 ${pct}%`。
   - 拍板后先进入 `4500ms` 的 `GraceUndo` 倒计时，倒计时归零后再向网关发送 `approval-response`，并在存在其他阻塞会话时延迟 `360ms` 自动跳栈（Auto-Hop）。
