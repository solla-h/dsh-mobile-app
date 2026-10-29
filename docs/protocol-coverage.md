# 网关协议覆盖表（dsh-plugin-mobile-gateway@0.11.1）

> 口径：网关 `lib/index.mjs` 里所有 `msg.type === '...'` 分支（共 60 个，含 `string` 这类噪声）；
> App 侧对照 `src/protocol/types.ts` 的 `ClientFrame` 联合类型（42 个）。

## 1. 已接（42）

| 能力 | 客户端消息 | 网关落到 |
| --- | --- | --- |
| 心跳 | `ping` | 本地回 `pong` |
| 会话列表 | `sessions` | `api.sessions.list`（只裁 projections） |
| 工作区/项目 | `workspaces` | 一次性 `workspace/follow` 开场 baseline 摊平返回 |
| 全文搜索 | `search` | `sessions.search`，单次上限 20 条 |
| 历史 | `history` | `api.sessions.history` |
| 订阅 | `subscribe` / `unsubscribe` | 本地（subscribed/error） |
| 发消息 | `message` | 本地（含排队/插话、附件回执） |
| 审批 | `approval-response` | 本地（一次性） |
| 提问 | `question-answer` / `question-cancel` | 本地 |
| 取消回合 | `session-cancel` | `api.sessions.cancel` |
| 新建/改名/归档 | `session-create` / `session-rename` / `session-archive` | `sessions.create` / `rename` / `workspace.archiveSession` |
| 目录浏览 | `directories` | 宿主的目录服务 |
| 分叉 | `fork` | `api.sessions.fork` |
| 命令面板 | `commands` / `command-execute` / `command-options` / `command-select` | `skills.*` |
| 任务 | `tasks` | 本地 |
| 目标 | `goal` / `goal-edit` / `goal-pause` / `goal-resume` / `goal-clear` | 本地 |
| 智能体预设 | `agent-presets` / `session-agent-preset` / `select-agent-preset` | `agentPresets.list` 等 |
| 会话统计 | `session-stats` | 本地 |
| 附件/文件 | `attachment` / `file-resolve` / `file-list` / `file-download-*` / `file-upload-*` | 附件与上传模块 |
| 队列编辑 | `queue-update` | `api.sessions.updateQueue` |

## 1.1 实测记录（2026-10-29，default-vnic）

`workspaces` 与 `search` 已经在真网关上跑通（临时探针直连 `127.0.0.1:3080`，配对后打帧）。
四个会直接影响 UI 的事实：

- **工作区覆盖率极低**：30 个会话里只有 3 个落在唯一的工作区里，其余 27 个的 cwd 全是
  `/home/dsh/workspace`。首页看板不能只按 `workspaces` 分组，必须给没被认领的会话按 cwd
  兜底分组——`deriveProjects` 已按这个实现。
- **归档会话照样出现在 `sessions` 里**：18/30 是归档的，`sessions` 帧一个不少地返回，
  只能靠 `session-archives` / `workspaces.archivedSessionIds` 才知道该隐藏。
- **搜索命中只有 `sessionId` + `snippet`**，没有标题和分数；20 条命中里 12 条是归档会话。
  没有翻页参数，`hasMore: true` 只表示「还有更多」。
- `sessions.items[].updatedAt` 实测是**毫秒**（`1793240232363`），PROTOCOL.md 的示例写的是秒
  （`1786937352`）；`workspaces.items[].createdAt/updatedAt` 反而是 ISO-8601 字符串。

> 注意这两条的**接入深度**：目前只有类型定义 + 纯函数 + 单测，`App.tsx` 里还没有任何
> `client.send({type:'workspaces'})` / `{type:'search'}` 的发送点，也没有对应的 `case` 分支。
> 也就是说表里的「已接」指协议层已验通，线上界面还没消费。

两个使用上的坑：

- `workspaces` 不是廉价的列表查询：网关每次都会开一条 `workspace/follow` 流、取开场 baseline
  再断开。别拿它做轮询，重新拉取只在需要刷新分组时做。
- 成员变化和置顶变化**没有推送帧**，网关只转发 `archived`；想看到变化只能重新发一次 `workspaces`。

## 2. 网关有、App 没接（按能力分组）

| 能力 | 客户端消息 | 网关落到 | 对 App 的价值 |
| --- | --- | --- | --- |
| 新建项目 | `workspace-create` | `api.workspace.create` | 手机上直接开新项目 |
| 新建目录 | `directory-create` | 宿主目录服务 | 新建会话时建目录 |
| 模型选择 | `models` / `select-model` / `providers` / `default-model` / `save-default-model` | `llm.models` / `sessions.selectModel` 等 | 会话内切模型、看 provider |
| 权限预设 | `permission` / `permission-options` / `defaults` / `set-default` | `permissionPresets.*` / `settings.describe` | 会话里改权限模式（只读/工作区写/全权） |
| 上下文用量 | `context-usage` | 本地投影 `tokenUsage` + `contextPressure` | 比 `session-stats` 更细的上下文压力 |
| 定时任务 | `schedule-catalog` / `schedule-list` / `schedule-history` / `schedule-update` / `schedule-delete` | `schedule.*` | 手机上看/改 cron |
| 子代理 | `subagents` / `agent-team` | 本地（错误/空） | 看子代理树 |
| 插件安装 | `plugin-install` | 本地 | 手机上装插件（优先级低） |
| 宿主信息 | `host` | `api.host.describe` | 版本/能力位 |

## 3. 网关发了、App 没消费的帧（部分）

`subscribed`、`permission`、`context-usage`、`models`、`providers`、`schedule-*`、
`session-archived`、`session-renamed`、`workspaces`、`permission-options`、`defaults`、`set-default`。

App 的 `ServerFrame` 是宽松联合（未知类型落 `{kind: string}`），所以这些帧现在会被**静默丢弃**——不报错，但也没反应。

## 4. 建议的接入顺序

1. **`permission` / `permission-options`** —— 现在审批只能一条条批，不能切「只读/工作区写/全权」模式。
2. `context-usage` —— 比 `session-stats` 细，顶部水位线可以用真实压力值。
3. `schedule-*` —— 等首页 tab 结构定下来再决定接不接。
4. 其余（模型切换、插件安装）按需。

## 5. 结论

协议层没有「mobile 阉割版」：会话、历史、文件、审批、目标、任务、命令、预设都在，
项目/置顶/归档/搜索/权限/模型也都有。**缺的是 App 的接入**，不是网关的能力。
