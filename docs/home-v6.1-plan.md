# 首页 v6.1 落地计划

> 基于 Gemini v6.0「极简语音球 + 双列聚焦」设计，按 2026-10-29 的七条决策重写。
> 本文只排计划，不含实现。每一步都写了验收方式，能测才算完成。

## 0. 决策记录

| 议题 | v6.0 原案 | v6.1 决定 | 依据 |
| --- | --- | --- | --- |
| 会话移动 | 「移至工作区」+ 本地 map 兜底 | **不做移动**。默认工作区可设成 mobile，并允许切换「当前工作区」（只影响之后新建的会话） | 网关只暴露 `workspace.list/create/archiveSession`（`lib/dsh-host-adapter.mjs:309-317`），本地 map 会和服务端分组冲突 |
| 语音 | 首页主操作 | **补齐**：装官方语音包 + 客户端录音链路 | 你明确要求；实测 `speech-catalog` 当前 `available:false` |
| 卡片按住审批 | 自然语言直接回 | **关键词白名单 + 安全阀**（见 §4.1） | 现有 `message` 只会排队、解不了审批（`PROTOCOL.md:403`） |
| 摘要 | 纯函数里取 | **接 `turnOutline` 一类帧**，取不到再降级 | 你确认；帧确实存在（`PROTOCOL.md:742`） |
| 卡片第三行 | 模型名 + 耗时 | **去掉模型名**，用 `updatedAt` 相对时间 | sessions 帧没有模型字段 |
| 长按阈值 | 220ms | **600ms** + 10dp 移动容差 | 220ms 与滚动冲突；仓库现有统一 320ms |
| 尺寸 | 固定 dp（138 / 197 / 296） | **响应式**：宽度按容器百分比，高度按内容，字号有上限倍率 | 你的决定 |

## 1. 现状盘点（实测，不是推测）

| 能力 | 服务端 | 客户端 | 差距 |
| --- | --- | --- | --- |
| 语音识别 | `speech-catalog` 回 `available:false` / `speech/unavailable` | 无录音依赖（`package.json` 里没有 expo-audio / expo-av） | **两头都缺** |
| `turnOutline` 摘要 | 帧会发（`projection-baseline` / `turn-outline-updated`） | `App.tsx` 不处理，整类丢弃 | 补 handler |
| `projection-baseline` | 实测发到**主连接也发**，无活跃会话时 `projections:{}` | 不处理 | 同上 |
| `session-status`（running 变化） | 广播 | 不处理，列表是开屏快照 | 补 handler |
| `workspaces` | 已验通 | 只有类型 + 纯函数，无发送点 | 补发送 + 状态 |
| `approvalId` | `approval-requested` 里带（`lib/index.mjs:2503-2511`） | `PendingMap` 只存 `rpcId`，把它丢了 | 补字段 |
| 子会话 | `sessions` 里带 `parentSessionId`，跑起来都是 running | 无区分 | 聚焦网格要排除 |

## 2. 目标形态

一屏两个 Tab，尺寸全部响应式，不写死 dp：

```
Tab 1「聚焦」                      Tab 2「全部会话」
┌────────────────────┐            ┌────────────────────┐
│ DSH  gateway   ⌕   │            │ 全部会话    共 N 条 │
│ 现在有谁在等我  2/3 │            │ ▾ mobile        2  │
│ ┌───────┐┌───────┐ │            │  │ 会话标题        │
│ │待审批 ││进行中 │ │            │  │ 3 分钟前        │
│ └───────┘└───────┘ │            │ ▾ workspace      5  │
│                    │            │  │ …               │
│      (语音球)      │            │                    │
├────────────────────┤            ├────────────────────┤
│ 聚焦   全部会话     │            │ 聚焦   全部会话     │
└────────────────────┘            └────────────────────┘
```

- **网格高度由内容决定**（1~4 张卡自适应），语音球吃掉剩余空间，自然形成黄金比例，而不是硬切 64/36。
- 卡片宽 = `(容器宽 - 间距) / 2`，高度 `minHeight` 由内容撑开，字号 `maxFontSizeMultiplier={1.3}`。
- 球直径 = `clamp(72, 屏宽 × 0.2, 96)`。

## 3. 分期

### P0 · 地基（不碰 UI，可单独验收）

| # | 改动 | 文件 | 验收 |
| --- | --- | --- | --- |
| 1 | `PendingMap` 补 `approvalId` / `toolName` / `reason` | `src/protocol/pending.ts` | 单测：`approval-requested` 解析出 approvalId，`approval-resolved` 按 approvalId 移除 |
| 2 | 处理 `projection-baseline` / `turn-outline-updated` → outline map（只改主连接，control 不用动） | `App.tsx:191-335` + 新 `src/protocol/outline-cache.ts` | 单测 + 真网关日志打出 outline 条数 |
| 3 | 处理 `session-status` → 实时更新 running | `App.tsx` | 真机上跑一个会话，卡片状态自己变 |
| 4 | 连接就绪发 `workspaces`，处理响应 | `App.tsx` | 真网关：分组数与 `/mgw` 一致 |
| 5 | 会话模型带 `archived` / `pinned` 标记 | `src/protocol/projects.ts`（已支持） | 已有单测 |

### P1 · Tab 与「全部会话」页（纯前端，零协议风险）

| # | 改动 | 文件 |
| --- | --- | --- |
| 6 | 两 Tab 容器，会话页自动隐藏 Tab | `App.tsx` + `src/ui/home/BottomTabBar.tsx` |
| 7 | 无框排版列表（左导轨 + 纯文字行 + 折叠） | `src/ui/home/AllSessionsView.tsx` |
| 8 | 折叠用 `Animated` 高度，不用 `LayoutAnimation`（FlatList 上不可靠） | 同上 |

验收：真机截图与稿子对齐；折叠 60fps；无任何协议改动。

### P2 · 聚焦网格

| # | 改动 | 文件 |
| --- | --- | --- |
| 9 | `selectFocusSessions(sessions, pending, outlines)` 纯函数：pending 优先 → running；**排除 `parentSessionId` 子会话**；上限 4 | `src/protocol/focus.ts` + 单测 |
| 10 | 卡片组件（响应式宽高、状态点、标题、摘要、时间） | `src/ui/home/FocusCard.tsx` |
| 11 | 空态 / control 断线态 / 无摘要降级态 | 同上 |

验收：单测覆盖 4 种筛选组合；真机上 0/1/4/5 条时布局都不塌。

### P3 · 工作区与语音球

| # | 改动 | 说明 |
| --- | --- | --- |
| 12 | 当前工作区偏好（按 gatewayId 存） | `persisted-state.ts` |
| 13 | mobile 工作区：已有则用，没有则**问一次**再真建 | `directories` → `directory-create` → `workspace-create` |
| 14 | 顶部工作区切换器（长按/点击换「当前工作区」） | 只影响之后新建的会话 |
| 15 | VoiceOrb：**点按 = 新建会话并聚焦输入框**（先可用） | 不依赖语音 |
| 16 | 语音链路：装插件 → catalog → subscribe → 录音 → transcribe | 见 §5 |

验收：P3 前 4 项不依赖语音即可真机验证；语音单独验收。

### P4 · 卡片按住审批（关键词）

| # | 改动 | 文件 |
| --- | --- | --- |
| 17 | `matchDecision(transcript, pending)` 纯函数 + 白名单 | `src/protocol/voice-decision.ts` + 单测（≥20 条用例） |
| 18 | 600ms 长按 + 10dp 容差 + 卡片反色/声波 | `src/ui/home/FocusCard.tsx` |
| 19 | 匹配成功 → 发 `approval-response`；失败 → 什么都不发 | `App.tsx` |

## 4. 关键设计

### 4.1 关键词审批的安全阀

**归一化**：去首尾空白 → 全角转半角 → 转小写 → 去掉句末标点和语气词（`。，！？、…`）。

**白名单（整句匹配，不是包含）**：

| 结果 | 词表 |
| --- | --- |
| 同意 | 可以 / 行 / 好的 / 好 / 同意 / 批准 / 允许 / 确认 / 继续 / 执行 / 放行 / ok / okay / yes / yep / sure / go |
| 拒绝 | 不行 / 不可以 / 不要 / 别 / 否 / 拒绝 / 取消 / 停 / 算了 / no / nope / reject / deny / cancel / stop |

**规则**：

1. **否定优先**：整句里出现 `不 / 别 / 没 / 勿 / 禁止` 时直接判拒绝，即使含「可以」——「不可以」不能批。
2. **只有一条待审批才生效**：该会话 `pending.length === 1` 且 `kind === 'approval'`；多条时不动手，提示「有 N 条待审批，请进会话处理」。
3. **高危不语音批**：`assessRisk()` 判为 high 的（删除、越权、网络外发），语音一律不批，提示「这条需要进会话确认」。复用现有 `src/protocol/risk.ts`。
4. **匹配不上就什么都不发**：绝不把没听懂的文本当普通消息塞进会话——那会污染上下文，还会排在审批队列前面。
5. 每次决策都走现有的 4.5s 悔棋窗，语音批也一样。

### 4.2 mobile 工作区的决策树

```
连上 → 发 workspaces
  ├─ 有 title.toLowerCase() === 'mobile' → 选它当默认
  ├─ 没有 → 弹一次询问「在服务器上建 mobile 工作区？」
  │    ├─ 同意 → directories(home) → directory-create(home,'mobile')
  │    │          （directory-exists 也算成功）→ workspace-create(home/mobile)
  │    │          → 重发 workspaces → 写入偏好
  │    └─ 拒绝 → 不带 workspaceId 建会话（宿主用默认目录），分组落到 cwd 组
  └─ 之后用户可随时切「当前工作区」，只影响新会话
```

**不写本地假工作区**：分组一律来自服务端的 `workspaces` 帧 + cwd 兜底（`deriveProjects` 已实现）。

### 4.3 摘要的降级链

1. `turnOutline` 里有这个会话 → 取最后一条 `response`（最多 120 code unit，够用）；
2. 没有（冷会话）→ 该卡不发额外请求，显示「暂无最近回复」；
3. 只有当卡片可见且 `pending > 0` 时才允许补一次 `history {maxMessages:1, view:'conversation', maxBytes:65536}`，最多 4 次。

四条硬约束（都已核对源码）：

- **主连接就能收到**。`projection-baseline`、`turn-outline-updated` 在 legacy 和 control 上都发，且 outline 通知**不受 `subscribe` 过滤**（`lib/index.mjs:3556-3559`）。所以 P0 只改主连接的 `handleFrame`，不用动 control。
- **`history` 不能在 control 上发**，会回 `wrong-channel`（`lib/index.mjs:1533-1538`）。第 3 条必须走主连接。
- **基线只覆盖「已附着」的会话**，不是磁盘上所有会话；首次连接还可能是空的 `{}`（`lib/index.mjs:2407`）。所以不能用它判断「没有会话」。
- **`response` 是轮次结束后才提交的**。正在跑的会话，outline 里是**上一轮**的回复——卡片显示的是「上次说了什么」，不是实时流。这是对的，但文案别写成「正在回复」。

### 4.4 手势仲裁

- 轻点（< 600ms 松手）：进会话。
- 按住 ≥ 600ms：卡片反色 + 声波，进入倾听；松手判定。
- 手指移动 > 10dp：取消长按（防滚动误触）。
- 网格本身**不可滚动**（最多 4 张），冲突面比列表小；「全部会话」页不做按住。
- 600ms 与仓库现有的 `delayLongPress={320}` 不同，这是刻意的：按住说话需要明确意图。

### 4.5 响应式尺寸

| 元素 | 规则 |
| --- | --- |
| 卡片宽 | `(contentWidth - gap) / 2`，用 onLayout 或百分比 |
| 卡片高 | `minHeight: 112`，内容撑开，不加 `height` |
| 字号 | 标题 13 / 摘要 11，全部加 `maxFontSizeMultiplier={1.3}` |
| 语音球 | `clamp(72, screenWidth * 0.2, 96)` |
| 上下分区 | 网格 `flexShrink: 0`，球区 `flex: 1` —— 比例由内容自然形成 |

## 5. 前置依赖与风险

| 项 | 状态 | 处理 |
| --- | --- | --- |
| 官方语音包 | **已用版本豁免强开成功**：`dsh plugin allow-version <pkg>@0.1.7-alpha.1 --dsh-version 0.2.1-rc.3 --accept-risk` 逐条登记 4 个包后，插件行不再被禁用；`speech-catalog` 返回 `available:true`，SenseVoice INT8 模型已下载到 `ready`。实测 1 秒音频推理 12ms | 开发期可用。**风险**：这是跨 rc 强开，后续 DSH 若改 `dsh-settings` 接口可能出问题；升级 DSH 前先去 Web 插件管理里确认状态 |
| **服务器是 aarch64（2 核 12G）** | 该包「首次使用时下载运行时」，**需先确认有 ARM64 运行时** | 装之前先验证，没有就得换方案（远端 ASR） |
| 录音格式 | 网关只收 **16kHz 单声道 PCM16 WAV** 的 base64 | `expo-audio` 走 `useAudioStream` + `startFileRecordingAsync({format:'wav'})`，必须显式设 `encoding:'int16'`、`sampleRate:16000`、`channels:1`；`useAudioRecorder` 的 Android 枚举里没有 WAV，用不了 |
| 采样率可能不达标 | 文档写明「实际采样率可能和请求不同」 | 录完要断言 `result.sampleRate === 16000 && channels === 1`，不满足就报错，不能静默发出去 |
| 读 base64 | SDK 58 的新 API | `new File(uri).base64()`；旧的 `readAsStringAsync` 已废弃且运行时会直接抛错 |
| dsh 重启 | 装插件要重启 dsh-web，会断当前连接 | 挑时间，提前说 |
| 模型首次下载 | 几百 MB，取决于 provider | 在服务器侧做，不占手机流量 |

## 6. 验收清单

- [ ] P0：单测全绿 + 真网关上 running/outline/分组都能实时变
- [ ] P1：两个 Tab 真机可切；全部会话页折叠流畅；会话页自动隐藏 Tab
- [ ] P2：0/1/4/5 条会话四种布局都不塌；字号放大 1.3× 不裁切
- [ ] P3：点球能新建会话并聚焦输入框；mobile 工作区能建能切
- [ ] P4：关键词 20 条用例全过；「不可以」不会批；高危不语音批；多条待审批不乱批
- [ ] 全程：断线、离线发件箱、审批悔棋窗回归一遍

## 7. 明确不做

- 会话移动（网关没接口）
- 定时任务 Tab、插件 Tab（协议没接，先不占位置）
- 卡片上的模型名、耗时秒数
- 本地虚拟工作区

## 8. 进度（2026-10-29 当天）

| 期 | 状态 | 说明 |
| --- | --- | --- |
| P0 | **已完成** | `approvalId` 已进 `PendingMap`；接上 `projection-baseline` / `turn-outline-updated` / `session-status` / `workspaces`；连接就绪时并发拉 sessions + workspaces + speech-catalog |
| P1 | **已完成** | 底部两 Tab；全部会话页改成组头 + 缩进无框行（`src/ui/home/rows.ts` + 单测） |
| P2 | **已完成** | `selectFocusSessions` 纯函数 + `FocusHome`（响应式卡、空态、断线态、时间文案） |
| P3 | **已完成（未真机验证）** | 语音球、当前工作区与本机持久化、新建 mobile 工作区、`expo-audio` 录音（16k/单声道/int16 WAV）+ `speech-transcribe` 全链路 |
| P4 | **已完成（未真机验证）** | 600ms 长按 → 录音 → 转写 → 关键词判定 → `approval-response`；匹配不上不发任何帧 |

验收记录：`npx jest` 132 条全绿（新增 49 条），`npx tsc --noEmit` 干净，
`npx expo lint` 仍是基线 5 条，`npx expo export -p android` 能出包。
