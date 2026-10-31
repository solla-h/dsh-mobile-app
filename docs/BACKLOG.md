# dsh-mobile-app Backlog（与 dsh-mobile 对比）

> 写于 2026-10-31。这是一份**候选池**，不是排期，也不是“必须做完”的清单。
> 每一项都要单独讨论后再决定：做 / 不做 / 什么时候做 / 用什么最小方案做。
> 行号写于当日，改动后可能漂移；以文件内容为准。

## 0. 怎么用这份文档

- **建议优先级**只表示“如果要做，先做哪个”，不代表已经承诺。
- **决策状态**初始全部是 `待讨论`；讨论后改成 `做` / `不做` / `已做` / `需验证`。
- 每项都有 **“为什么可能不值得做”**，讨论时先看这一段，避免默认“兄弟有我们就得有”。
- 触发条件很重要：有些项只在“用团队/对外分发/弱网/大屏”时才值得做。
- 证据口径：`dsh-mobile/...` 指同级原生项目 `D:\workspace\open_source\dsh-mobile`；`src/...` 指本仓库。
- 决策记录追加在第 8 节，不覆盖原文。

## 1. 快照与数据范围

| 项 | 值 |
|---|---|
| 本仓库 | `master` @ `cbbb6c9`（写作时） |
| 兄弟项目 | `Clarklevis1995/dsh-mobile` `main` @ `4979475` |
| 网关 | `dsh-plugin-mobile-gateway` 0.11.1（npm 与源码同版本） |
| issue/PR 数据 | 30 条 issue（含 comments）+ 35 条 PR（含 comments/files），拉取于 2026-10-31 |
| 分析方法 | 8 路源码/文档调查 + 30/35 条 issue/PR 逐条挖掘 + 三视角综合 + 四簇代码验证 + 完整性批判 |

## 2. 一页总览

### P0：会丢消息 / 卡死 / 安全

| ID | 主题 | 工作量 | 默认建议 | 为什么可能值得先做 |
|---|---|---|---|---|
| OUTBOX-1 | 发件箱与关键请求的确认闭环 | M | 建议做 | 现在“写入 socket 即删”，服务端拒收/丢帧会静默丢消息 |
| CONN-1 | 连接探活、socket 守卫、回前台/切网补数据 | S | 建议做 | “假在线”最坏 50–75s；兄弟 issue 区最高频 |
| CONN-2 | 候选地址回退 + 握手截止 + 鉴权失败停止 | M | 建议做 | `endpoints` 存了不用；onopen 清退避会重连风暴 |
| HIST-1 | 历史本地缓存 + 离线可读 + 原子写 | M | 建议做 | 冷启动/离线/切会话必空白；兄弟 #65 的核心诉求 |
| APPROVAL-1 | 审批安全与反馈（高危绕过、语音直批、错误不可见、单值覆盖、会话状态串） | S/M | 建议做 | 会“误放行”，不是体验差 |

### P1：高频体验

| ID | 主题 | 工作量 | 默认建议 | 触发条件 / 备注 |
|---|---|---|---|---|
| REQ-1 | 关键请求超时 + 可重试空态 | M | 建议做 | 与 OUTBOX-1 共用“已发送待确认”状态 |
| NOTIFY-1 | 审批/提问/回合结束的本地通知 | M | 待讨论 | 只在 JS 存活期可靠；杀进程不可达 |
| VOICE-1 | 语音上限、自动停、失败复位、音频会话 | S | 建议做 | 兄弟 #54 的 4MB 静默失败 |
| TEAM-1 | 子会话寻址（parentSessionId + subagentMode） | M | 待讨论 | 只有真正用 agent-team 才值得 |
| SEARCH-1 | 接 `search` 帧的搜索 UI | M | 待讨论 | 协议纯函数已就绪；跳消息依赖 HIST-1 |
| SEC-1 | 配对端点校验（禁明文公网/0.0.0.0） | S | 待讨论 | 配对串是唯一信任入口 |
| DIR-1 | 目录选择器跨盘/绝对路径输入 | S | 待讨论 | 兄弟 #31；只在 Windows 多盘场景有感 |
| APPROVAL-2 | 审批/提问交互细节（replay、error、plan-review、分页、停止键合一、终态对账） | S | 待讨论 | 可与 APPROVAL-1 一起做 |

### P2：增强

| ID | 主题 | 工作量 | 默认建议 | 触发条件 / 备注 |
|---|---|---|---|---|
| PERF-1 | 流式渲染节流（chunk 合并 + 流式纯文本） | M | 待讨论 | 长回答 O(n²)，短回答无感 |
| PERF-2 | 长会话内存窗口 + FlatList 参数 | S | 待讨论 | 会话跑几百事件后才有感 |
| PERF-3 | 单帧上限 + sessions 进 state 前瘦身 | S | 待讨论 | 网关 0.11.x 已裁 projections，复发概率下降 |
| FILE-1 | 工作区文件浏览（`file-list`） | M | 待讨论 | 预览已有系统能力，缺的是浏览器 |
| UI-1 | Markdown 表格全屏/复制/CSV | S | 待讨论 | 只在读大表格时有感 |
| PLAT-1 | 大屏/平板断点 | M | 待讨论 | 当前锁 portrait；平板/分屏用户才需要 |
| CTX-1 | 上下文用量环 | S/M | 待讨论 | 与 `session-stats` 去重；收益有限 |
| CTRL-1 | 会话控制保真（默认模型、preset 门控、command value） | M | 待讨论 | 多数是小口子 |
| OBS-1 | 帧分发异常边界 + ErrorBoundary | S | 建议做 | 一帧坏数据/一个 handler 异常会整页红屏 |
| MISC-1 | JSON 格式化查看 | S | 待讨论 | 对 genui/visualize 输出有感 |
| MISC-2 | 上传失败重试 | S | 待讨论 | 弱网用户 |
| MISC-3 | 下载 open/read 超时 | S | 待讨论 | 服务端不回帧时卡片永久 downloading |
| MISC-4 | control 断线时 pending 标“可能过期” | S | 待讨论 | 多通道断线场景 |
| MISC-5 | 存储管理/清理 | M | 待讨论 | 做了 HIST-1 之后才需要 |
| A11Y-1 | 无障碍主路径 + 字号跟随系统 | M | 待讨论 | 有屏幕阅读器/大字号用户才需要 |
| I18N-1 | i18n 基础设施 | L | 待讨论 | 只在对外分发时做 |
| DOC-1 | 更新 `docs/protocol-coverage.md` | S | 建议做 | 文档已滞后，避免下次按旧文档排期 |

### P3 / 不建议照搬

| ID | 主题 | 工作量 | 默认建议 | 理由 |
|---|---|---|---|---|
| TEAM-2 | 完整团队/子代理面板 | L | 不建议现在做 | 协议面大、依赖 Host 实验插件、当前无明确用户 |
| BG-1 | 后台常驻保活 / 实时活动 | L | 不建议现在做 | Expo 无等价 API；需原生模块 + dev build |
| DB-1 | SQLite 历史缓存 | M | 不建议 | 150–200 条 JSON 尾窗足够 |
| PDF-1 | 嵌入式 PDF/代码高亮库 | L | 不建议 | 系统预览已覆盖；大文件不划算 |
| ARCH-1 | KMP/MVI/单向数据流架构 | L | 不建议 | 我们单状态机 + 纯函数协议层已够 |
| UI-2 | 视觉模仿（tinder 牌堆、宠物、动态背景） | L | 不建议 | 我们已有自己的设计语言 |
| HEIC-1 | HEIC 转码 | S | 需验证 | 先确认 iOS 选图实际是否仍产出 HEIC |

## 3. 用户痛点地图（issue / PR）

> 数据来自 `dsh-mobile` 的 30 条 issue 与 35 条 PR。状态是 GitHub 状态，不代表已真正解决。

| 排名 | 痛点 | 代表 issue / PR | 用户症状 | 对我们的含义 |
|---|---|---|---|---|
| 1 | 连接/重连/前台恢复 | #53、#65、#39、#14；PR #5/#18/#21/#34/#38/#59/#69 | 切 WiFi/5G 后“假在线”；最坏 50–75s 才恢复；后台回来重新握手+重拉历史；候选地址串行轮询（10 个里 9 个局域网各耗 12s）；conversation lane 故障会把 `wantsConnection` 置 false 永久不重连 | `GatewayClient` 有同构缺口，见 CONN-1/CONN-2 |
| 2 | 历史/大 payload/缓存 | #65（本地缓存）、#51（855 会话 13.7MiB sessions 帧，公网 73s）、#60（子会话历史）；PR #19（每 token 全量 replace，单回合 1079 次） | 每次进会话阻塞在全量 history；大列表打不开；流式逐字卡顿 | 无正文缓存（HIST-1）；流式全量 regroup（PERF-1）；子会话只带 sessionId（TEAM-1） |
| 3 | 附件/文件 | #52（iOS 只能选照片、HEIC 转码） | 无法上传 PDF/Office/代码；大文件需分块 | 我们已支持任意文件 + 分块；只剩 HEIC/重试（MISC-2、HEIC-1） |
| 4 | 语音输入 | #54（4MB 静默失败、iOS 音频会话被占、Windows 无日志）、#39（轻点误触语音插件） | 说长了直接失败且无提示；键盘听写不可用 | 我们缺上限/自动停/失败复位（VOICE-1） |
| 5 | 布局/大屏/文本选择 | #50（iPhone Duo 断点差 10px）、#47（正文不可选中）、#46（统计页暗色不跟随） | 折叠屏不触发双栏；消息不能选片段 | 我们锁 portrait、无断点（PLAT-1）；文本选择已有 |
| 6 | 团队/子代理 | #60（OPEN）、PR #73（OPEN）、#49 | 点进成员会话历史失败；想看并行 subagent | 我们全仓无 `subagentMode`（TEAM-1）；完整面板不建议现在做（TEAM-2） |
| 7 | 崩溃/解析容错 | #29（emoji 孤立代理对导致 iOS JSONDecoder 拒绝整帧、列表永久冻结）、#45（SwiftUI 栈溢出）、#71（Android 弹窗闪退） | 一帧坏数据/一个单点异常放大成整 App 故障 | 我们无 frame dispatch try + ErrorBoundary（OBS-1） |
| 8 | 通知/实时活动 | #24（只有计时，无进度；后台更新需 APNs） | 后台看不到审批/进度 | 我们无通知（NOTIFY-1）；实时活动不建议（BG-1） |
| 9 | 工作区/目录 | #31（Windows 新建工作区只能 C 盘） | 目录选择器到 C 盘根就结束 | 我们 `DirectoryPicker` 无路径输入（DIR-1） |
| 10 | 插件/可视化 | #42（genui JSON 只能看字符串）、#36（自定义 UI 槽位） | JSON 可读性差；想塞自定义面板 | JSON pretty viewer 可做（MISC-1）；DOM 槽位不建议 |

两个细节：**#53 虽标 CLOSED，但用户实测 v1.7.10 仍未修复**；**#60 的修复 PR #73 至今 OPEN**。issue 状态不能直接当“已解决”。

## 4. P0 候选（逐项展开）

### OUTBOX-1 发件箱与关键请求的确认闭环

- **决策状态**：待讨论（默认建议：做）
- **建议优先级**：P0 ｜ **工作量**：M ｜ **依赖**：无（可与 REQ-1 合并）
- **用户痛点**：弱网/切网关时消息静默丢失；用户看不到“到底发出去没有”。
- **兄弟证据**：兄弟也把 `sent` 当作 inbox 接受，不保证去重；PR #34/#38/#40 反复修前台恢复与重试；#65 强调回前台不要重新付握手+重拉历史。
- **我们现状**：
  - `outbox.flush()` 只要 `client.send()` 返回 true 就删条目；`send()` 只代表写进本地 socket。`src/transport/outbox.ts:93-121`
  - `sent` 帧回显 `requestId`（网关 0.11.1：`lib/index.mjs:561/626-629`，PROTOCOL.md:1475），但 App 只把它用于语音新建，不用于发件箱。`App.tsx:600-609`
  - outbox 是模块级单例、全局 key、条目无 `gatewayId`；任何 conversation client ready 都会 flush 全部。`src/transport/outbox.ts:12-21`、`App.tsx:703-711`
  - 切网关只清 sessions/queues/pending，不动 outbox。`App.tsx:1005-1024`
- **最小改法**：
  1. `OutboxItem` 持久化 `requestId` + `gatewayId`；
  2. flush 后标“已发送待确认”，收到同 `requestId` 的 `sent` 才删；收到 error 标失败可重试；
  3. 15–30s 未确认标“未确认”，给重试/移除；
  4. 切网关只 flush 当前网关；旧版无 `gatewayId` 的条目归到当前 active 网关并给可见提示。
- **为什么可能不值得做**：如果实际使用中几乎不切网关、也极少弱网，收益会低于复杂度；但“静默丢消息”一旦发生很难排查。
- **讨论点**：
  - 是否接受“未确认 15s 后标黄、不自动重发”的保守策略？
  - 是否把 outbox 拆成按网关的多队列，还是只加 `gatewayId` 过滤？
  - 网关能否保证 `sent` 的 requestId 一定回显（发版前用 `npm pack` 复核）？

### CONN-1 连接探活、socket 守卫、回前台/切网补数据

- **决策状态**：待讨论（默认建议：做）
- **建议优先级**：P0 ｜ **工作量**：S ｜ **依赖**：无
- **用户痛点**：界面显示“已连接”，实际收不到帧；切网/回前台后要等 50–75s 才恢复；旧 socket 的迟到帧污染状态。
- **兄弟证据**：#53/#65/#39；PR #5（后台回来不重新 subscribe）、#18（conversation lane 故障导致永久不重连）、#21（候选竞速）、#34/#38（握手/前台重试）。
- **我们现状**：
  - `watchForeground` 只把 `lastFrameAt` 重置为现在并补一个 ping，没有 pong 截止。`src/transport/gateway-client.ts:265-283`
  - `watchNetwork` 只在“socket 已空且已有 reconnectTimer”时立即 open；socket 半开不处理。`src/transport/gateway-client.ts:233-256`
  - 心跳看门狗 25s × 2 轮，最坏约 50s。`src/transport/gateway-client.ts:207-226`
  - `onmessage` 没有 socket/generation 守卫（`onclose` 有）。`src/transport/gateway-client.ts:136-168`
  - App 层回前台只在 `state !== 'ready'` 时重连；ready 时既不探活也不补 sessions。`App.tsx:994-1002`
- **最小改法**：
  1. 回前台/网络恢复发 ping，4–5s 内没收到任何帧就主动 close + 立即重连（`attempt=0`）；
  2. 网络事件加 1–3s 防抖，避免车载 WiFi 抖动触发重连风暴；
  3. 所有 socket 回调校验 `socket === this.socket`（或 generation）；
  4. `ready` 后补一次 `sessions`；会话页收到 ready 后重发 history/stats/tasks（不重订阅）；
  5. 抽一个共享 `probe()`，切网与回前台复用。
- **为什么可能不值得做**：如果用户基本只在稳定 WiFi 下用，感知不强；但这是兄弟 issue 区最高频的问题，且我们的实现有同样的结构缺口。
- **讨论点**：
  - 探活超时 4s 还是 5s？弱网下会不会误杀正常连接？
  - `ready` 后补 `sessions` 的频率、是否也要补 `workspaces`？
  - 是否需要把连接状态机抽成可注入 `now/socketFactory` 的纯模块，补 jest 单测？

### CONN-2 候选地址回退 + 握手截止 + 鉴权失败停止

- **决策状态**：待讨论（默认建议：做）
- **建议优先级**：P0 ｜ **工作量**：M ｜ **依赖**：CONN-1 的守卫
- **用户痛点**：家里局域网入口超时后不会回公网；配对时选了 wss 就一直走公网；反复“接受后立刻断”的代理造成 1s 一次重连风暴；token 已废仍带旧 token 重连。
- **兄弟证据**：PR #21（候选竞速，10 个候选里 9 个局域网各耗 12s）、#34（单 endpoint 握手超时后 `reconnectBlocked` 永久停止）、#59/#69（局域网地址精确跳过、失败不整体失败）、#38（前台恢复重试已鉴权 endpoint）。
- **我们现状**：
  - 配对时 `candidates.find(wss) ?? candidates[0]`，之后 `connectWith` 永远用 `gateway.url`；`SavedGateway.endpoints` 存了但重连不再读。`App.tsx:755-765`、`src/storage/gateway-store.ts:12-13`、`src/transport/gateway-client.ts:102-128`
  - `open()` 没有握手截止；`onopen` 立即 `attempt=0` 并起心跳；`onerror` 不 close/不重连。`src/transport/gateway-client.ts:130-164`
  - 4003 只提示后继续按退避重连，仍带旧 token。`src/transport/gateway-client.ts:180-187`
  - `hello` 从不与配对载荷里的 `gatewayId` 比对。
- **最小改法**：
  1. 每次 open 起 15s 截止（私网 3–4s），收到 `hello`/`paired` 才算成功；成功前不清退避；
  2. 4003/401 停止自动重连，保留凭据并提示重新配对；
  3. `hello.gatewayId` 与配对载荷比对，不符即停止；
  4. `endpoints` 加 last-good 游标：成功入口写回 `SavedGateway.url`，重连优先 last-good，失败按候选轮换；
  5. 不要并发竞速配对码（一次性），只对已配对 token 的重连路径轮换。
- **为什么可能不值得做**：如果只用一个固定地址（如公网 wss），候选回退没有收益；但握手截止和鉴权停止仍然是正确性修复。
- **讨论点**：
  - 是否把“私网判定”抽成 `isPrivateHost()` 纯函数（同时给 SEC-1 复用）？
  - 重连轮换时，是否允许“上一次成功地址”和“局域网地址”交替尝试？
  - 4003 停止后，UI 是引导重新配对，还是保留手动重试？

### HIST-1 历史本地缓存 + 离线可读 + 原子写

- **决策状态**：待讨论（默认建议：做）
- **建议优先级**：P0 ｜ **工作量**：M ｜ **依赖**：无（与 PERF-2 共享窗口策略）
- **用户痛点**：冷启动/离线/切回会话时正文空白，每次都要等网络；兄弟 #65 的核心诉求。
- **兄弟证据**：#65（OPEN）；v1.7.9 已做本地历史缓存+预取+离线；`SharedChatHistoryCache` 用 L1 内存窗口 + L2 持久化；`ChatCacheWindowPolicy` 8MB/400 事件。
- **我们现状**：
  - 只缓存会话列表前 30 条（`sessions-<gatewayId>.json`）；正文只在 `SessionScreen` 内存。
  - 每次 mount `setMessages([])` 再发 history。`src/ui/SessionScreen.tsx:844-848`
  - `persisted-state` 只有通用 JSON 读写，`delete→write` 非原子。`src/storage/persisted-state.ts`
  - 离线打开没打开过的会话只能看到“连接断开”。
- **最小改法**：
  1. 按 `(gatewayId, sessionId)` 存最近 150–200 条事件（按 seq 去重、截断）；
  2. 用 `expo-file-system` 的 temp→`File.move` 原子写；
  3. 进会话先 `setMessages(cache)` 再发 history，到达后按 seq 对账；
  4. 离线保留缓存并标“离线副本”；
  5. 切网关清命名空间；附件只存引用，不存 base64。
- **为什么可能不值得做**：如果用户几乎不离线、也不常冷启动进旧会话，收益有限；但“进会话等网络”是最常见的体感问题。
- **讨论点**：
  - 缓存窗口 150 还是 200 条？按条数还是按字节（1–2MiB）？
  - 历史版本不匹配（`historyFormatVersion`）时直接丢弃还是迁移？
  - 是否顺带做 MISC-5 存储管理，还是先不暴露清理入口？

### APPROVAL-1 审批安全与反馈

- **决策状态**：待讨论（默认建议：做）
- **建议优先级**：P0 ｜ **工作量**：S/M ｜ **依赖**：无
- **用户痛点**：高危命令可被一键放行；语音可能误批；审批失败用户看不到原因；多个审批互相覆盖；切会话串引用/信任目录。
- **兄弟证据**：#39（审批弹窗不出现）、#71（弹窗闪退）、PR #22（审批长命令按钮被推出屏幕；我们已有限高）。
- **我们现状（全部代码核实）**：
  - `TriageSheet` 的高危审批仍是普通 `onPress`，点开决策卡后能一键放行；只有 `ApprovalDock` 是长按充能。`src/ui/dock/TriageSheet.tsx:161-168`
  - 首页语音命中唯一 pending approval 且识别到“同意”时直接发 `approval-response`，没有风险展示/长按/悔棋。`App.tsx:567-586`
  - 审批被拒/发送失败只写 `interactionError`，但 `InteractionSheet` 固定 `approval={null}`，`ApprovalDock` 不接 error → 用户看不到原因。`src/ui/SessionScreen.tsx:2264-2273, 2368-2383`
  - `approval`/`question` 都是单值 state，多个同时挂起会互相覆盖。`src/ui/SessionScreen.tsx:634-640`
  - 切会话的 reset 没清 `pinnedOnceRef/followRef/atBottomRef/quote/trustedDirs`，旧会话的引用/信任目录会串进新会话。`src/ui/SessionScreen.tsx:844-876`
- **最小改法**：
  1. 统一审批风险门：`TriageSheet` 高危也长按/二次确认；
  2. 语音批高危前必须二次确认（或直接禁止语音批高危）；
  3. 把 `interactionError` 传进 `ApprovalDock` 常驻显示；
  4. `approval`/`question` 改队列，或至少“后到不覆盖先到”；
  5. reset effect 清全部会话级状态（滚动锚点、引用、信任目录、编辑队列、草稿备份）。
- **为什么可能不值得做**：高风险修复没有“要不要做”的余地；争议只在交互形式（长按 vs 二次确认 vs 禁止语音）。
- **讨论点**：
  - 高危语音审批：二次确认、完全禁止、还是要求进会话？
  - 多审批队列的 UI：顶部计数 + 逐条处理，还是只保留最新并提示“还有 N 条”？
  - `TriageSheet` 与 `ApprovalDock` 是否合并成一套组件，删掉不可达的 `InteractionSheet` 审批分支？

## 5. P1 候选（逐项展开）

### REQ-1 关键请求超时 + 可重试空态

- **决策状态**：待讨论（默认建议：做）
- **优先级/工作量**：P1 / M ｜ **依赖**：OUTBOX-1 的“待确认”状态
- **现状**：history 首屏失败只写 `error`，不清 `loading`；session-create 无超时；message 有 requestId 归位但无超时；语音新建只等 `sent`。`src/ui/SessionScreen.tsx:514/537/802-839`、`App.tsx:600-609`
- **最小改法**：history/session-create/session-stats/语音新建挂 12–30s 超时；超时清 loading 并给“重试/返回”空态；错误按 requestId 归位；同一会话在途首屏请求单飞，避免重试堆叠。
- **讨论点**：超时时长是否按私网/公网区分？重试是否自动一次，之后手动？

### NOTIFY-1 审批/提问/回合结束的本地通知

- **决策状态**：待讨论（默认建议：先做“短后台”一档）
- **优先级/工作量**：P1 / M ｜ **依赖**：无（`expo-notifications`）
- **兄弟证据**：#24（实时活动只有计时，后台更新需 APNs）；#65（后台保活开关）。
- **最小改法**：`npx expo install expo-notifications`；只在 `AppState !== 'active'` 时对 approval-requested / question-requested / turn-end 发本地通知；按 `rpcId/sessionId` 去重；点击深链回会话；正文只放会话标题/工具名。
- **边界（必须写清）**：iOS 进入后台约 30s 后 JS 可能挂起，进程被杀后不会触发；真正杀进程提醒需要远程推送或原生前台服务。不要承诺“后台一定收到”。
- **为什么可能不值得做**：如果用户很少把 App 切后台等审批，收益有限；且通知权限会带来一次打扰。
- **讨论点**：是否先只做“审批/提问”两个节点，不做回合结束？是否要通知开关和免打扰时段？

### VOICE-1 语音上限、自动停、失败复位、音频会话

- **决策状态**：待讨论（默认建议：做）
- **优先级/工作量**：P1 / S ｜ **依赖**：无
- **兄弟证据**：#54（4MB/约 2 分钟静默失败；iOS 键盘听写被占用；应显示已用时长/剩余额度）；#39（轻点误触语音）。
- **我们现状**：
  - `maxRecordSeconds` 在 `App.tsx:33` import 后全仓无第二处调用。
  - `speech.ts:81-88` 映射了 `maxAudioBytes/maxDurationSeconds`，但 UI 不用。
  - 会话页只有 0.5s 计时（`SessionScreen.tsx:1447-1453`），无上限/预警/自动停；首页录音球没有秒数。
  - 首页 `speech-transcribe` 的 error 分支只 `setError`，不重置 `transcribing`（`App.tsx:674-695`）。
  - `useVoiceCapture` 在 hook 创建时就 `useAudioStream`（`useVoiceCapture.ts:31-34`），可能进会话就占音频会话。
- **最小改法**：
  1. 用 `speech-catalog` 上限：录中显示 `0:52 / 2:00`，90% 变色，到点自动停并直接送转写；
  2. WAV 字节按 `44 + 秒数*32000` 估算，超 `maxAudioBytes` 本地先拦；
  3. 两条路径共用同一份“上限/错误复位”小函数；
  4. 按住时才创建 stream；`setAudioModeAsync` 显式配置录音模式（需真机确认 iOS 键盘听写是否仍冲突）。
- **为什么可能不值得做**：如果用户很少说长语音，上限提示优先级下降；但“失败无提示”是明确的体验缺陷。
- **讨论点**：到点自动停后直接转写，还是让用户确认？是否保留“取消录音”上滑手势？

### TEAM-1 子会话寻址（parentSessionId + subagentMode）

- **决策状态**：待讨论（默认建议：只做寻址，不做完整面板）
- **优先级/工作量**：P1 / M ｜ **依赖**：`hello.capabilities` 门控
- **兄弟证据**：#60（OPEN）：成员会话 `requestHistory` 未带父地址，网关按普通会话寻址被 Host 拒；PR #73（OPEN）仍未合。
- **我们现状**：
  - 全仓无 `subagentMode`；`history/subscribe/message/session-cancel/tasks/goal` 都只带 `sessionId`。
  - `SessionItem.parentSessionId` 被 fork 占位复用（`App.tsx:1249-1252`），不能直接拿来判子会话。
  - `sessions.items[]` 不下发 `subagentMode`，需要独立 target 注册表或 `agent-team/subagents` 投影。
- **最小改法**：
  1. 新增独立子会话 target 注册表（不要复用 `parentSessionId` 字段的现有语义）；
  2. 六类请求统一走 `decorateSessionFrame`：仅当有合法子地址时追加 `parentSessionId + subagentMode`；
  3. `subagentMode` 取 `continuable/one-shot/unknown`，不猜；缺一个就报 `address-incomplete`；
  4. 用 `hello.capabilities` 的 `subagent-conversations-v1` 门控；
  5. 先只做寻址 + 门控，不做团队面板。
- **为什么可能不值得做**：只有真正用 agent-team 的用户才需要；如果 Host 没启用团队插件，这段代码永远不会跑。
- **讨论点**：是否先不做，等确认有团队使用场景？能否用 `agent-team` 投影替代独立注册表？

### SEARCH-1 接 `search` 帧的搜索 UI

- **决策状态**：待讨论
- **优先级/工作量**：P1/P2 / M ｜ **依赖**：HIST-1（跳具体消息）
- **现状**：`search` 请求类型、`mapSearchResult/resolveSearchHits` 和单测都在（`types.ts:410`、`src/protocol/search.ts`），但 `App.tsx` 没有发送点、没有 `case 'search'`；界面只按标题/cwd 本地过滤，且会话数 >3 才显示。
- **网关限制**：单次最多 20 条、无翻页、命中只有 `sessionId + snippet`；大量命中是归档会话（`resolveSearchHits` 已处理）。
- **最小改法**：搜索页/下拉加防抖、loading、空态、20 条截断提示；命中点击先打开会话，第二阶段再做消息定位（依赖 HIST-1）。
- **讨论点**：值不值得做完整搜索页，还是只在会话列表上做“远程补全”？

### SEC-1 配对端点校验

- **决策状态**：待讨论（安全底线，建议至少加校验）
- **优先级/工作量**：P1 / S ｜ **依赖**：无
- **兄弟证据**：`dsh-mobile/.../GatewayProfile.kt:35-51`、`PairingPayloadParser.swift:4-74`：≤16 个候选、地址 ≤2048、禁 `?/#/\`、禁 `0.0.0.0/::`、非私网必须 `wss`、私网判定。
- **我们现状**：`parsePairingPayload` 只校验 `version===2`、`publicUrl` 前缀、`pairingCode` 非空、`expiresAt`；`endpoints` 完全不校验（类型断言直接放行）。`src/protocol/pairing.ts:64-89`、`App.tsx:755-765`
- **最小改法**：新增 `validateEndpoint` 纯函数（上述规则 + `gatewayId` UUID 形状），`endpoints` 逐条校验；`candidates` 组装只接受合法项；`hello` 到达时再比对 gatewayId。
- **讨论点**：是否允许用户手动填写明文 `ws://` 局域网地址（私网例外）？校验失败是拒绝整个配对串，还是只丢弃坏候选？

### DIR-1 目录选择器跨盘/绝对路径输入

- **决策状态**：待讨论
- **优先级/工作量**：P1 / S ｜ **依赖**：无
- **兄弟证据**：#31（Windows 新建工作区只能 C 盘；目录选择器上一级最多到 C 盘根）。
- **我们现状**：`DirectoryPicker` 只有面包屑和子目录列表，没有路径输入或盘符入口；服务端 `directories` 接受任意绝对路径（`lib/index.mjs:1024-1044`）。
- **最小改法**：顶部加“跳转路径”输入（提交绝对路径后 `onOpen(path)`）和/或盘符快捷行；错误沿用 `directory-unreadable`；面包屑按响应 `path` 回填。
- **为什么可能不值得做**：只有 Windows 多盘用户有感；如果工作区都在 Home 下，可以不急。

### APPROVAL-2 审批/提问交互细节

- **决策状态**：待讨论
- **优先级/工作量**：P1 / S ｜ **依赖**：APPROVAL-1
- **包含**：
  1. **replay 标记**：“已恢复”字段全仓只定义不消费；重连后网关 replay 的 pending 应显示“已恢复”。
  2. **审批终态对账**：断线期间 `approval-resolved` 丢失会卡在“处理中”；`accepted:true` 被忽略；建议 ready 时按 `rpcId` 对账，并给 10–15s 终态超时。
  3. **plan-review 专用卡**：`QuestionIntent` 已定义但全仓无消费；`InteractionSheet` 对所有 question 平铺 options。
  4. **多题分页**：1/N + 单选自动前进 + 提交时跳回第一个未答。
  5. **停止键合一**：running 且输入为空时，主按钮变成停止键（`cancelTurn` 已有 10s 兜底）。
- **讨论点**：这几项是否一起做？plan-review 的「确认执行/拒绝/去聊天里说」具体文案和布局？

## 6. P2 候选（简表 + 关键说明）

| ID | 现状/证据 | 最小改法 | 讨论点 |
|---|---|---|---|
| PERF-1 流式节流 | 每个 text-delta 直接 setStreaming；每 chunk 触发 baseRows/groupMessages 全量重算 + 整段 markdown-it 重 parse；代码块逐行生成（`SessionScreen.tsx`、`Markdown.tsx`） | chunk 写 ref、约 100ms 合并一次 setState；流式期间纯文本，结束再 Markdown；代码块加行数上限/展开 | 100ms 是否够顺滑？流式期间牺牲 Markdown 是否可接受？ |
| PERF-2 长会话窗口 | messages 只 append/merge，无裁剪；FlatList 无 `initialNumToRender/windowSize/maxToRenderPerBatch`（`SessionScreen.tsx:2099-2103`） | 先打日志统计典型条数/字节；设 400–600 条或 2MiB 上限；FlatList 补窗口参数；裁剪部分留给 HIST-1 缓存 | 上限按条数还是字节？裁剪后顶部提示怎么画？ |
| PERF-3 大帧上限 | `onmessage` 同步 `JSON.parse`，无单帧字节上限、无背压；sessions 全量 items 直接进 state（`gateway-client.ts:136-160`、`App.tsx`） | 16MiB 上限 + 大帧日志；sessions 进 state 前只保留 UI 字段 | 网关 0.11.x 已裁 projections，是否还值得做客户端自保？ |
| FILE-1 工作区文件浏览 | `file-list` 只有请求类型（`types.ts:521`），无响应类型/发送/UI；下载后只 `File.canPreview/preview` 或分享（`file-download.ts:304-328`） | 补 `file-list` 响应 + 只读浏览；预览继续用系统能力；不引 PDF 库 | 是做成独立文件页，还是会话内抽屉？ |
| UI-1 Markdown 表格 | 表格已按列宽测量、支持宽表横向滚动（`Markdown.tsx:300-348`），无全屏/旋转/复制/CSV | 先做“复制 TSV/CSV + 全屏纵向表格”；横屏可选 `expo-screen-orientation` | CSV 是否需要 BOM/引号转义（兄弟已实现，可抄）？ |
| PLAT-1 大屏/平板 | app.json 锁 portrait；App 单栏状态机；无断点/最大内容宽度；`useWindowDimensions` 只用于局部组件 | 宽度断点（compact/medium/expanded）+ 正文 maxWidth；解锁 orientation；双栏后置 | 当前用户是否有平板/分屏需求？先做宽度还是先做双栏？ |
| CTX-1 上下文环 | 只有 `session-stats` 的 contextPressure + 2px 水位线；`context-usage` 未接 | 用现有 stats 画环；breakdown 来自 history 的 `contextBreakdown`；不单独发 `context-usage` | 环是否比现在的 2px 水位线更有用？ |
| CTRL-1 会话控制保真 | `default-model/save-default-model` 只有类型从未发送；preset `locked` 用 `!session.blank` 猜；`command-selected` 只显示 label；commands locale 固定 zh-CN | 默认模型写操作 + 二次确认；preset known/loading 门控；command value 回退 selected.id；locale 跟随系统 | 全局默认模型是否容易误改？要不要只读？ |
| OBS-1 帧分发边界 | `frameListeners.forEach` 在 try 外；App/SessionScreen `handleFrame` 无 try；无 ErrorBoundary（`gateway-client.ts:136-160`） | 分发/处理器包 try/catch + ErrorBoundary；记录 frame.kind 与错误 | 是否引入错误上报？先 console.warn 够不够？ |
| MISC-1 JSON 查看 | 工具输出固定 20 行原始文本；Markdown 代码块逐行 | 新增 `json-pretty.ts`；CodeBlock/ToolRow 提供“格式化/原样”切换 | 只对 genui/visualize 用户有感，是否值得？ |
| MISC-2 上传重试 | 失败 chip 只显示错误和 ×；`FileUploader` 只有 upload/cancel | `retry(localId)` + chip 重试按钮；断线时提示等连接恢复 | 重试是否要重新算 hash？ |
| MISC-3 下载超时 | `file-resolve` 有 15s；`file-download-open/read` 无超时（`file-download.ts:189-261`） | open 15s、每块 read 30s 看门狗；超时 cancel + 删半文件 + 可重试 | 与上传的超时策略是否统一？ |
| MISC-4 control 离线提示 | pending 只在 control hello 时清空；断线仍按旧数据渲染（`App.tsx`） | 记录 control 状态；断线时 pending 标“审批通道重连中/可能过期”；恢复回放后恢复 | 是否直接清空 pending？不建议（会闪没） |
| MISC-5 存储管理 | 只有会话列表缓存；无历史/附件/预览缓存统计与清理 | HIST-1 后按类别统计/清理；附件只存引用 | 是否值得单独做页面，还是放在设置里一行？ |
| A11Y-1 无障碍/字号 | 37 个 UI tsx 中仅 12 个有 accessibility*；SessionScreen 只有语音条 5 处；字号 4 档手动，系统缩放被 1.2/1.3 封顶 | 主要路径补 role/label；加“跟随系统”字号档；系统放大时强制单栏（兄弟 Theme.swift:170） | 当前是否有屏幕阅读器/大字号用户？ |
| I18N-1 i18n | 全仓无 i18n/expo-localization；文案中文常量 | 确定分发再做：`t(key)` + 两张字符串表；不做全量对齐 | 是否对外分发？不确定就明确 YAGNI |
| DOC-1 文档滞后 | `docs/protocol-coverage.md` 说 models/permission/schedules 未接，但代码已接 | 按 `src/protocol/types.ts` + 实际发送点重写覆盖表 | 是否顺便加“最后核对日期/网关版本”？ |

## 7. P3 / 不建议照搬（讨论后大概率不做）

| ID | 内容 | 为什么不建议 |
|---|---|---|
| TEAM-2 | 完整团队/子代理面板（成员切换、共享任务、只读子会话） | 协议面大、依赖 Host 实验插件、当前无明确用户；先只做 TEAM-1 寻址 + 能力门控 |
| BG-1 | 后台常驻保活 / 实时活动 | Expo 没有可维持 WebSocket 的等价 API；`expo-background-task` 最小 15 分钟且由系统调度；Android 前台服务需原生模块 + dev build；实时活动需 ActivityKit widget extension |
| DB-1 | SQLite 历史缓存 | 150–200 条 JSON 尾窗足够；等需要 FTS/结构化查询再上 |
| PDF-1 | 嵌入式 PDF / 语法高亮库 | 系统预览已覆盖 PDF/图片/文本；代码高亮用纯文本+行号先够；大文件高亮不划算 |
| ARCH-1 | 照搬 KMP/MVI/单向数据流 | 我们“单状态机 + 纯函数协议层”已够；只借行为，不借架构 |
| UI-2 | 视觉模仿（tinder 牌堆、宠物、动态背景） | 我们已有自己的设计语言；动画不是当前瓶颈 |
| HEIC-1 | HEIC 转码 | 先确认 `expo-image-picker quality:0.8` 在 iOS 实际产出格式；若已是 JPEG 则不需要 |

## 8. 已具备，不要重复做

| 能力 | 证据 |
|---|---|
| 任意文件选择 + 三段式上传 | `SessionScreen.tsx:1225-1248`、`src/transport/file-upload.ts` |
| 系统预览（PDF/图片/文本） | `file-download.ts:304-328`（`File.canPreview/preview`） |
| 文本选择 | `src/ui/TextSelectionSheet.tsx` |
| 历史阅读位置保持 | `SessionScreen.tsx:496` 注释 + 插入前视口补偿 |
| 审批长内容限高/滚动 | `TriageSheet` ScrollView + `DiffView` limit + `ApprovalDock` detail 两行 |
| 图片预算/压缩 | `SessionScreen.tsx:1150-1214`（单张/张数/总大小、quality 0.8） |
| 模型/权限切换 | `src/ui/session/ModelPermissionBar.tsx`（models、permission-options、select-model、permission） |
| 工作区/搜索协议纯函数 | `src/protocol/projects.ts`、`src/protocol/search.ts` + 单测 |
| 多网关、outbox、插件、定时任务、命令面板、目标、任务、轨迹、语音链路 | 见 `AGENTS.md` 与 `docs/HANDOFF.md` |

## 9. 验证与纠偏记录

这些是分析过程中“先以为是缺口、回代码/协议核实后否掉”的项，避免后面重复立项：

| 曾以为是缺口 | 核实结果 |
|---|---|
| 任意文件附件（issue #52） | 已实现：`File.pickFileAsync` + `file-upload.ts` 三段式；只剩 HEIC/重试 |
| 系统预览/PDF 打开 | 已实现：`file.canPreview()` / `file.preview()`，不可预览时退 `Sharing.shareAsync` |
| 消息正文文本选择 | 已实现：`TextSelectionSheet` + 长按菜单分流 |
| 审批长命令按钮被推出屏幕 | 已有限高/滚动：`TriageSheet` ScrollView、`DiffView` limit、`ApprovalDock` detail 两行 |
| 历史加载旧消息丢阅读位置 | 已处理：插入前记录视口并补偿（`SessionScreen.tsx:496`） |
| 图片压缩/多图预算 | 已实现：单张/张数/总大小校验 + quality 0.8 |
| `sent`/`history` 不回 requestId，需要改网关 | **错**。网关 0.11.1 的 `sent` 与 `history` 都回显 `requestId`（`lib/index.mjs:561/626-629`、`1536-1538`；PROTOCOL.md:1475）。OUTBOX-1/REQ-1 可以纯客户端修 |
| `command-selected` 一定有 `value` | **半错**。`select-model` 返回 `value`（`lib/index.mjs:1433-1439`）；permission 命令的文档示例没带。实现取“有 value 用 value，缺失回退 selected.id” |
| `context-usage` 有额外 breakdown | **半错**。它和 `session-stats` 是同一组投影；breakdown 来自 history 的 `contextBreakdown` |
| 子会话可直接用 `SessionItem.parentSessionId` 判断 | **错**。fork 占位也写这个字段（`App.tsx:1249-1252`），且 sessions 不下发 `subagentMode`；需要独立 target 注册表 |

## 10. 建议的讨论顺序

不是排期，只是“先聊哪些”：

1. **OUTBOX-1 / CONN-1 / CONN-2 / HIST-1**：这四项决定弱网和后台的基本盘，先定“做到什么程度”。
2. **APPROVAL-1**：先定安全策略（高危是否允许语音批、TriageSheet 是否长按），再谈 UI。
3. **REQ-1 / VOICE-1 / NOTIFY-1**：都是“失败/后台没有反馈”，可以一起定一套错误与通知规范。
4. **TEAM-1 / SEARCH-1 / DIR-1 / SEC-1**：按真实使用场景决定做不做。
5. **P2 整组**：先挑“用户已经抱怨过”的做，其余等反馈。
6. **P3/不建议**：除非场景变化（开始对外分发、有人用团队、需要平板），否则不做。

## 11. 决策记录（讨论后追加）

| 日期 | ID | 决定 | 理由 | 备注 |
|---|---|---|---|---|
| — | — | — | — | — |
