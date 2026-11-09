# 客户端协议覆盖（dsh-mobile-v1）

> 口径：本文只描述 **App 侧**已实现的客户端契约，对照 [compatibility.json](../compatibility.json)
> 里 pin 的组合（协议 v3、网关 `0.12.0-rdv.3`）。不数帧：`src/protocol/types.ts` 的联合类型只代表
> 「声明过」，是否接入以真实发送点和处理器为准；网关内部落点以 pin 版本的 `PROTOCOL.md` 为准，
> 不要用本地 checkout 推断在装网关的行为。证据等级：下表为源码/单测确认；真机结论另见
> [COMPATIBILITY.md](COMPATIBILITY.md)。

## 1. 已接入的客户端能力 → 模块

| 能力 | 客户端帧 | 实现模块（发送 / 消费） |
| --- | --- | --- |
| 心跳与断线重连 | `ping` | [../src/transport/gateway-client.ts](../src/transport/gateway-client.ts)、[connection-policy.ts](../src/transport/connection-policy.ts) |
| 会话列表、归档、重命名推送 | `sessions`、`session-archive`、`session-rename` | `App.tsx`、[AllSessionsView.tsx](../src/ui/home/AllSessionsView.tsx)、[focus.ts](../src/protocol/focus.ts) |
| 工作区（首页看板） | `workspaces` | [projects.ts](../src/protocol/projects.ts)、[rows.ts](../src/ui/home/rows.ts)、`App.tsx` |
| 历史、订阅、实时流、轮次级大纲 | `history`、`subscribe`/`unsubscribe` | [chat.ts](../src/protocol/chat.ts)、[outline.ts](../src/protocol/outline.ts)、[outline-cache.ts](../src/protocol/outline-cache.ts)、[history-cache.ts](../src/transport/history-cache.ts) |
| 发消息、排队、插话 | `message`、`queue-update` | [outbox.ts](../src/transport/outbox.ts)、[SessionScreen.tsx](../src/ui/SessionScreen.tsx) |
| 审批、提问 | `approval-response`、`question-answer`/`question-cancel` | [interactions.ts](../src/protocol/interactions.ts)、[pending.ts](../src/protocol/pending.ts)、[ApprovalDock.tsx](../src/ui/dock/ApprovalDock.tsx) |
| 取消回合 | `session-cancel` | [SessionScreen.tsx](../src/ui/SessionScreen.tsx) |
| 新建、改名、归档、分叉 | `session-create`、`session-rename`、`session-archive`、`fork` | `App.tsx`、[SessionScreen.tsx](../src/ui/SessionScreen.tsx)、[RenameSessionModal.tsx](../src/ui/home/RenameSessionModal.tsx) |
| 目录浏览与新建 | `directories`、`directory-create`、`workspace-create` | [directories.ts](../src/protocol/directories.ts)、[DirectoryPicker.tsx](../src/ui/DirectoryPicker.tsx)、`App.tsx` |
| 命令面板 | `commands`、`command-execute`、`command-options`、`command-select` | [commands.ts](../src/protocol/commands.ts)、[CommandPalette.tsx](../src/ui/CommandPalette.tsx)、`SessionScreen` |
| 任务与目标 | `tasks`、`goal`、`goal-pause`/`goal-resume`/`goal-clear` | [tasks.ts](../src/protocol/tasks.ts)、[TasksSheet.tsx](../src/ui/TasksSheet.tsx)、`SessionScreen` |
| 智能体预设 | `agent-presets`、`session-agent-preset`、`select-agent-preset` | [presets.ts](../src/protocol/presets.ts)、`SessionScreen`、[HostInfoSheet.tsx](../src/ui/home/HostInfoSheet.tsx) |
| 会话统计与上下文压力条 | `session-stats` | [chat.ts](../src/protocol/chat.ts)（tokenUsage）、`SessionScreen` |
| 模型、权限预设、宿主信息、全局默认 | `models`、`select-model`、`permission`、`permission-options`、`host`、`defaults`、`set-default` | [runtime.ts](../src/protocol/runtime.ts)、[ModelPermissionBar.tsx](../src/ui/session/ModelPermissionBar.tsx)、[HostInfoSheet.tsx](../src/ui/home/HostInfoSheet.tsx) |
| 定时任务（须走 control 连接） | `schedule-catalog`、`schedule-update`/`schedule-delete`/`schedule-history` | [schedules.ts](../src/protocol/schedules.ts)、[SchedulesView.tsx](../src/ui/home/SchedulesView.tsx)、[ScheduleSheet.tsx](../src/ui/home/ScheduleSheet.tsx) |
| 语音输入（依赖宿主 bundle） | `speech-catalog`、`speech-transcribe`、`speech-cancel` | [speech.ts](../src/protocol/speech.ts)、[useVoiceInput.ts](../src/ui/voice/useVoiceInput.ts) |
| 插件管理（control 连接，单独通道） | `plugin-*` 请求族 | [plugins.ts](../src/protocol/plugins.ts)、[usePluginManager.ts](../src/ui/plugins/usePluginManager.ts) |
| 文件 | `file-resolve`、`file-download-*`、`file-upload-*`、`attachment` | [files.ts](../src/protocol/files.ts)、[file-download.ts](../src/transport/file-download.ts)、[file-upload.ts](../src/transport/file-upload.ts)、[FileCards.tsx](../src/ui/FileCards.tsx) |
| 地址簿 | `rendezvous-config` | [rendezvous.ts](../src/protocol/rendezvous.ts)、[transport/rendezvous.ts](../src/transport/rendezvous.ts) → [rendezvous-design.md](rendezvous-design.md) |

插件管理是唯一走宽松类型的 `request(type, params)` 通道（`usePluginManager.ts`），
帧名不在 `ClientFrame` 联合里逐个列出；**不要**用联合类型反推 App 的覆盖范围。

## 2. 已声明但全仓库没有发送点（别当成已接入）

- `search`：服务端全文搜索。[search.ts](../src/protocol/search.ts) 的解析、`normalizeQuery` 与单测已在，
  但列表搜索框（`App.tsx` → `AllSessionsView`）仍是本地过滤，没有 `type:'search'` 发送点。
- 仅类型声明、无发送点：`speech-subscribe`、`providers`（有 `mapProviders` 映射但没发）、
  `default-model`、`save-default-model`、`schedule-list`、`file-list`、`goal-edit`。
  （`goal-pause`/`goal-resume`/`goal-clear` 是动态拼帧发送的，见 `SessionScreen.tsx`。）

## 3. 客户端契约要点（实现时反复踩到的）

- `workspaces` 不是廉价列表：一次请求对应网关开一条 `workspace/follow` 取开场 baseline。
  App 只在连接建立、新建工作区等时机重发，不做轮询（`App.tsx`，`types.ts` 注释）。
- 归档会话仍会出现在 `sessions` 里；隐藏靠 `session-archives` 帧与 `workspaces.archivedSessionIds`
  （[projects.ts](../src/protocol/projects.ts)、[focus.ts](../src/protocol/focus.ts)）。
- `workspaces` 只覆盖显式创建的工作区；没归组的会话按 `cwd` 兜底分组，否则看板会漏会话
  （[projects.ts](../src/protocol/projects.ts)）。
- 服务端搜索命中只有 `sessionId` + `snippet`，单次上限 20 条、无翻页参数，命中可能落在归档会话上
  （`types.ts` 注释、[search.ts](../src/protocol/search.ts)）。
- 时间字段口径：`sessions.items[].updatedAt` 按 epoch 毫秒排序；`workspaces` 的 `createdAt`/`updatedAt`
  是 ISO-8601 字符串，客户端不解析（`types.ts`）。
- `ServerFrame` 是宽松联合：未知 kind 静默丢弃，不报错也没有反应；接新帧要看实际处理器，不能只看类型
  （`types.ts`）。
- `hello.protocol` 与 pin 版本不一致时只提示、不断连（[compat.ts](../src/protocol/compat.ts)）。

协议行为约束（可写帧、goal 双层嵌套、`fork` 的 `historyFormatVersion` 等）见
[AGENTS.md](../AGENTS.md)「Protocol constraints」；那里是维护契约，这里是覆盖地图。

## 4. 证据与验证方式

- 纯函数单测：`npm test`（`src/protocol/__tests__`、`src/transport/__tests__`，各能力各自的映射与负例）。
- UI 旅程：`npx jest src/ui/__tests__/app-journey --runInBand`（配对→发送→返回；离线冷启动保会话）。
- 可控失败：`node docs/tools/fake-gateway.mjs`（`no-ack`、`no-hello`、`half-open`、`no-history`、`no-create`），
  用法见 [DEVELOPMENT.md](DEVELOPMENT.md)。
- 未覆盖：iOS、非 pin 版本网关、真机（真机与发布级结论以 `compatibility.json` 的 verified 条目和
  [COMPATIBILITY.md](COMPATIBILITY.md) 为准）。上表是源码/单测口径，不等于在装网关验证。

结论：会话、历史、文件、审批、目标、任务、命令、预设、运行时配置、定时任务、插件、语音、地址簿都有
真实模块与发送点；缺口集中在 §2 的未发送帧，而不是网关能力。
