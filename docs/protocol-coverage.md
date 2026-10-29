# 网关协议覆盖表（dsh-plugin-mobile-gateway@0.11.1）

> 口径：网关 `lib/index.mjs` 里所有 `msg.type === '...'` 分支（共 60 个，含 `string` 这类噪声）；
> App 侧对照 `src/protocol/types.ts` 的 `ClientFrame` 联合类型（40 个）。

## 1. 已接（40）

| 能力 | 客户端消息 | 网关落到 |
| --- | --- | --- |
| 心跳 | `ping` | 本地回 `pong` |
| 会话列表 | `sessions` | `api.sessions.list`（只裁 projections） |
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

## 2. 网关有、App 没接（按能力分组）

| 能力 | 客户端消息 | 网关落到 | 对 App 的价值 |
| --- | --- | --- | --- |
| **项目分组** | `workspaces` | `api.workspace.list` → `{items[], pinnedSessionIds[], archivedSessionIds[]}` | **首页看板必需**：权威分组、置顶、归档 |
| 新建项目 | `workspace-create` | `api.workspace.create` | 手机上直接开新项目 |
| 新建目录 | `directory-create` | 宿主目录服务 | 新建会话时建目录 |
| **全文搜索** | `search` | `api.sessions.search` | 现在 App 的搜索只是本地过滤标题，接了这个能搜正文 |
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

1. **`workspaces`** —— 首页看板的分组权威数据，社区版网关从 0.11.x 就有，零风险。
2. **`search`** —— 会话一多，本地按标题过滤不够用；服务端能搜正文。
3. **`permission` / `permission-options`** —— 现在审批只能一条条批，不能切「只读/工作区写/全权」模式。
4. `context-usage` —— 比 `session-stats` 细，顶部水位线可以用真实压力值。
5. 其余（模型切换、定时任务、插件安装）按需。

## 5. 结论

协议层没有「mobile 阉割版」：会话、历史、文件、审批、目标、任务、命令、预设都在，
项目/置顶/归档/搜索/权限/模型也都有。**缺的是 App 的接入**，不是网关的能力。
