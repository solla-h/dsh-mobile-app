# DeepSeek Harness (dsh-mobile-app) 移动端首页与全局导航重构规范 (v6.0 · 极简语音球 + 双列聚焦版)

- **面向读者**：DeepSeek Coding Agent（负责 `App.tsx` 与 `src/ui/home/` 工程落地）
- **目标设备基准**：`436dp × 970dp`（1200×2670 @2.75，Android 旗舰屏宽）
- **核心设计哲学调整（v6.0 推翻 v5.1 的繁琐列表，回归极致留白与一屏一焦点）**：
  1. **首页不再塞项目文件夹树，也不做半屏选目录发射卡**：首页只做两件事——**上半屏（64%）用 `2×2` 双列卡片聚焦「待审批 + 进行中」会话**（不含定时任务）；**下半屏（36% 黄金分割区）放置一枚呼吸语音动画球**。
  2. **自动准备 `mobile` 专属工作区**：连接网关后，自动创建/关联名为 `mobile` 的工作区。用户在首页按住底部语音球说话，即刻在 `mobile` 工作区新建会话并发送（事后支持将该会话移动到其他工作区）。
  3. **进行中/待审批卡片支持「长按直接语音回复（Push-to-Talk on Card）」**：卡片展示标题与最新一句 Agent 回复摘要；**轻点卡片**进入会话详情，**按住卡片（`> 220ms`）**直接在卡片内激活声波倾听，松手即可把“继续 / 可以 / yes”直接发进该会话，免去进退页面的繁琐。
  4. **「全部会话」独立为第 2 个 Tab，且彻底去除胶囊背景嵌套**：工作区展开后的会话条目**严禁再包圆角卡片背景与外框**，改用纯粹的左侧 `1dp` 缩进导轨线 + 极简排版行（Typography + Hairline）。
  5. **底部采用 4 格极简 Tab 栏**：`聚焦` / `全部会话` / `定时任务` / `插件`（进入具体 `SessionScreen` 后自动隐藏底部 Tab 栏）。

---

## 一、 顶层空间架构与 436dp × 970dp 黄金分割布局

### 1.1 Tab 1：「聚焦首页（Focus Home）」全屏结构图

```text
+-------------------------------------------------------------------+  0dp (SafeArea Top)
| [1] 极简顶栏 (48dp)                                               |
|  DSH  tokyo-gateway ●                                  [⌕ 搜索]   |
+-------------------------------------------------------------------+  48dp
| [2] 上半屏 62%：双列实时聚焦网格 (2×2 Focus Grid · 最多 4 张)     |
|  ACTIVE FOCUS · 待审批与进行中          点按进入 · 长按直接语音回  |
|  +-----------------------------+   +-----------------------------+|
|  | ● core              [待审批]|   | ● mobile-ios        进行中 || <- 宽 194dp × 高 138dp
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
|                                                                   |
|                  默认归属工作区: mobile                           |
|                                                                   |
|                        ( ( (  🎤  ) ) )                           | <- 84dp 核心球 + 双层同心呼吸环
|                                                                   |
|                 按住说话 · 在 mobile 区新建会话                   |
|                 无需先选目录，后续可随时移入其他项目               |
+-------------------------------------------------------------------+  914dp
| [4] 底部四格 Tab 栏 (56dp · 进入会话页后自动隐藏)                 |
|      [ 聚焦 4 ]       全部会话        定时任务         插件       |
|         ━━━                                                       |
+-------------------------------------------------------------------+  970dp
```

### 1.2 Tab 2：「全部会话（All Workspaces）」无框排版列表结构图

彻底抛弃“文件夹包圆角卡片、圆角卡片里再包胶囊”的过度设计，采用类似纸质书目录的 **左导轨线 + 纯文字排版**：

```text
+-------------------------------------------------------------------+
| 全部工作区与会话                                        共 14 条  |
| ----------------------------------------------------------------- |
| ▾ mobile  [手机默认工作区]                                     2  | <- Group Header (纯文字行)
|   │ 排查网关 WebSocket 心跳重连抖动                 [移至工作区 ›]| <- 无背景、无外框，仅底部分割细线
|   │ #06 · 刚刚 · DeepSeek-R1                                      |
|   ├ · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · |
|   │ 临时验证正则切分性能                            [移至工作区 ›]|
|   │ #07 · 3小时前 · DeepSeek-V3                                   |
|                                                                   |
| ▾ deepseek-harness/core                                        5  |
|   │ ● 重构 MCP 连接池并修复偶发超时                        1m42s  |
|   │ ○ 创建测试文件 hello 与环境自检                          1天  |
|   │ ○ 你好，请你检查本服务器负载与句柄                       2天  |
|   │ 展开其余 2 个会话 ⌄                                           |
|                                                                   |
| ▸ deepseek-harness/router                              ● 1 待批 4 |
+-------------------------------------------------------------------+
```

---

## 二、 核心业务逻辑与协议适配规则（给 DeepSeek 的实现准则）

### 2.1 自动准备 `mobile` 工作区与会话迁移机制
1. **自动确保 `mobile` 工作区存在**：
   - 客户端连接网关并收到 `workspaces` 帧后，检查是否存在 `title.toLowerCase() === 'mobile'` 的工作区；
   - 若网关尚未创建 `mobile` 工作区，或当前网关尚未接通 `workspaces` 帧，客户端在本地聚合层固定置顶一个虚拟/默认的 `mobile` 工作区（对应默认目录 `~/mobile` 或网关默认 `cwd`）。
   - 用户通过首页底部「语音动画球」发起的新会话，**100% 自动归入 `mobile` 工作区**，绝不弹窗询问目录。
2. **从 `mobile` 移动到其他工作区**：
   - 在「全部会话」Tab 下，`mobile` 工作区内的每条会话右侧带有一个轻量文字按钮 `移至工作区 ›`；
   - 点击后原地展开一行工作区胶囊（或调用 `ActionSheet`），点选目标工作区后更新会话归属（若网关支持 `workspace-assign` 则发帧同步，否则写入本地 `persisted-state.ts` 的 `session-workspace-map-${gatewayId}` 并同步 `cwd`）。

### 2.2 首页双列聚焦网格（2-Column Focus Grid）筛选规则
1. **严格只展示需要人工关注的任务**：
   - 仅保留满足 `pendingItems(pending, s.sessionId).length > 0`（待审批/待提问）或 `s.running === true`（正在进行中）的会话；
   - **明确排除定时任务**：若 `s.origin === 'schedule'` 或属于自动巡航定时任务且无阻塞审批，一律不进入首页聚焦网格。
2. **排序与数量上限**：
   - 排序：`待审批` 优先于 `进行中`，同类内按 `updatedAt` 降序；
   - 展示数量：最多取前 **4 条**（刚好构成 `2×2` 黄金网格，绝不产生冗长滚动条；若超过 4 条，在网格右上角显示 `查看全部 N 项活跃 ›` 跳往全部会话页）。
   - 若当前没有任何待审批或进行中会话，上半屏展示极简留白状态：`当前所有 Agent 均已就绪 · 按住下方语音球直接开启新任务`。

### 2.3 双列卡片「轻点进入 vs 按住直接语音回复」手势状态机
每张聚焦卡片（宽 `(436 - 32 - 10) / 2 = 197dp`，高 `138dp`）包含 3 个信息层与 2 种手势：
1. **卡片三要素**：
   - **顶行**：左侧 `6dp` 状态点 + 工作区短名（如 `mobile` / `core`），右侧状态标签（`待审批` / `进行中`）；
   - **中段**：会话标题（`fontSize: 13, fontWeight: '700', numberOfLines: 2`）+ **最后一条 Agent 回复摘要**（`fontSize: 11, color: t.text.secondary, numberOfLines: 2`）；
   - **底行**：`#序号 · 耗时` + 右下角微型提示 `🎤 按住直回`。
2. **手势分流（Tap vs Press-and-Hold 220ms）**：
   - **轻点（`< 220ms` 松手）**：调用 `tapFeedback()`，直接进入该会话的 `SessionScreen`；
   - **按住（`>= 220ms`）**：触发 `tickFeedback()`，卡片立即反色高亮（`bg: t.action.primaryBg, color: t.action.primaryText`），卡片中央切换为 5 根动态声波竖条 `正在向 #01 说话… 松手即发送`，用户说出“继续”、“可以”、“yes”后松手，直接向该 `sessionId` 发送 `{ type: 'message', sessionId, content: recognizedText }` 并触发 `successFeedback()`，**全程无需离开首页**！

---

## 三、 像素级样式与动效参数表（`src/theme/tokens.ts` & `Animated`）

| 组件模块 | 尺寸与布局 (`436dp × 970dp`) | 颜色与边框 Token | 动效实现（仅用 `Animated` / `LayoutAnimation`） |
| :--- | :--- | :--- | :--- |
| **双列聚焦卡**<br>`FocusGridCard` | `width: '48.5%'`<br>`height: 138`<br>`padding: 12`<br>`borderRadius: 16` | • 待审批：`bg: t.bg.elevatedAnswer, border: 1dp t.semantic.gateAmberText`<br>• 进行中：`bg: t.bg.surface, border: hairline t.border.default`<br>• 按住说话态：`bg: t.action.primaryBg` | 按住 `220ms` 激活时：`Animated.spring(scale, { toValue: 0.97, tension: 180, friction: 18, useNativeDriver: true })`。 |
| **底部语音球舞台**<br>`VoiceOrbStage` | 占首页下半屏 `36%~38%` 高度（约 `260dp~290dp`），水平垂直居中 | • 球体常态：`width: 80, height: 80, borderRadius: 40, bg: t.bg.elevatedAnswer, border: 1.5dp t.border.activeOrigin`<br>• 球体按住态：`bg: t.action.primaryBg`<br>• 外围双同心环：`border: 1dp t.border.default` | • 常态：外圈 `scale` 在 `1.0 ↔ 1.08`、`opacity` 在 `0.12 ↔ 0.28` 之间做 `2400ms` 慢速正弦呼吸；<br>• 按住说话态：核心球放大至 `1.10`，内部 5 根声波柱按音量或交错相位跳动。 |
| **全部会话无框行**<br>`CleanWorkspaceRow` | 组头高 `38dp`<br>会话行 `paddingVertical: 10`<br>左缩进 `marginLeft: 14, paddingLeft: 12` | • **严禁设置 `backgroundColor` 和圆角外框！**<br>• 左侧导轨线：`borderLeftWidth: 1, borderLeftColor: t.border.default`<br>• 行间分割：`borderBottomWidth: hairlineWidth, borderBottomColor: t.border.subtle` | 展开/折叠工作区时调用 `LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)` + `tapFeedback()`。 |
| **底部四格 Tab 栏**<br>`BottomTabBar` | `height: 56`<br>4 等分网格 | `bg: t.bg.dockGlass`<br>`borderTopWidth: hairlineWidth, borderTopColor: t.border.default`<br>选中项文字 `t.text.primary` + 底部 `16×2dp` 短横线 | 仅在 `activeSessionId === null`（即不在会话详情页）时渲染；进入会话页自然卸载隐藏。 |

---

## 四、 给 DeepSeek 的四步落地清单（Implementation Steps）

1. **Step 1：重构首页数据派生纯函数（`src/protocol/home-grouping.ts`）**
   - `selectFocusGridSessions(sessions, pending)`：过滤掉定时任务（`origin === 'schedule'`），仅提取 `pending > 0` 或 `running === true` 的会话，最多返回 4 条，并提取每条会话的最新一条助手回复摘要。
   - `groupAllWorkspaces(sessions, workspaces, mobileOverrides)`：始终置顶 `mobile` 工作区，其余按 `workspaces` 或 `cwd` 归组。
2. **Step 2：实现首页双列聚焦与底部语音球（`src/ui/home/FocusHomeView.tsx`）**
   - 上半部渲染 `2×2` `FocusGridCard`，内置 `onPress`（进入会话）与 `onLongPress`（220ms 激活卡片内语音直回，松手发送消息）；
   - 下半部黄金分割区渲染 `VoiceOrb`，按住说话松手后直接触发 `onQuickVoiceCreateInMobile(transcript)`。
3. **Step 3：实现去胶囊化的「全部会话」页（`src/ui/home/AllWorkspacesView.tsx`）**
   - 采用左导轨线 + 纯排版行渲染工作区与会话，并为 `mobile` 工作区内的条目提供 `移至工作区 ›` 快捷迁移操作。
4. **Step 4：在 `App.tsx` 挂载底部 4-Tab 切换（聚焦 / 全部会话 / 定时任务 / 插件）**
   - 当未进入具体会话时显示底部 4-Tab，进入 `SessionScreen` 时自动隐藏 Tab 栏。