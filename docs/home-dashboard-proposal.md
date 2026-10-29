# 首页看板设计提案（v0.1）

> 用途：交给 Gemini 一起打磨。基于 2026-10-29 对 DSH Web 源码与 `dsh-mobile-v1` 协议的核对。

## 0. 一句话

首页不是「平铺会话列表」，也不是「纯文件夹树」，而是：
**顶部一条「最近焦点」，下面按项目折叠分组，默认只展开你最近在用的那个项目。**

## 1. 现状与硬约束（已核对源码）

### 1.1 DSH Web 是怎么做的

`packages/client/ui-workspace/src/client/tree.ts`：

- **分组依据是 Workspace 注册表**：`workspace.sessionIds` 是权威成员关系，不在任何 Workspace 里的会话落到 `Ungrouped` 桶。
- **组内排序**：`orderByRecency()` —— `updatedAt` 降序，时间相同用 `sessionId` 决定（稳定排序）。另有 `manual` 模式，用本地保存的手工顺序。
- **置顶**：`pinnedSessionIds` 的会话排在本段最前，且只能和置顶项互相调序。
- **归档**：`archivedSessionIds` 的会话原地置灰、不可打开。
- **组头**：文件夹图标 + 展开箭头 + `label`（`workspaceTitleOf(cwd)`，即路径 basename）+ 会话数 + hover 出现的重命名/删除/新建会话。
- **会话行状态**：`running` / `runningSubagentCount` / `pendingInteraction(approval|plan-review|question)` / `completed`（绿点提醒）/ `pinned` / `archived` / `updatedAt`。

结论：**「按项目分组 + 组内按最近交互排序」这个判断是对的**。

### 1.2 我们手机上拿得到什么

`dsh-mobile-v1` 的 `sessions` 帧只有这些字段：

```
sessionId, updatedAt, running, blank, cwd, agentPreset, parentSessionId, origin,
projections.asOfSeq, projections.values.title
```

**没有** `workspaceId`、`pinned`、`archived`、`completed`。这意味着：

| 能力 | 手机端可行性 |
| --- | --- |
| 按项目分组 | 可行：用 `cwd` 派生项目（basename 作组名） |
| 组内按最近排序 | 可行：`updatedAt` 已经有了 |
| 待审批徽标 | 可行：全局待办已经从 `approval-requested` 帧收集 |
| 置顶 / 折叠状态 | 只能本地存（按 gatewayId），不同步 |
| 归档 | 协议不支持，先不做 |

## 2. 设计目标

1. 打开就能回答「现在该处理什么」——跑着的、等审批的、刚结束的。
2. 项目是折叠容器，默认只展开最近活跃的一个，避免一次铺 30 行。
3. 会话多了也能靠结构定位，而不是先搜索。

## 3. 信息架构：三段式

```
┌────────────────────────────────────────┐
│ DSH  default-vnic ›           ● 已连接 │
├────────────────────────────────────────┤
│ 焦点                                    │
│ ┌────────────────────────────────────┐ │
│ │ ◆ 待审批  dsh-mobile-app            │ │
│ │   修上传 offset                     │ │
│ │   bash · 12 秒前            [去处理] │ │
│ └────────────────────────────────────┘ │
│ ┌──────────────┐ ┌──────────────┐      │
│ │ ● 运行中      │ │ ✓ 已完成      │      │
│ │ 重做会话页 UI │ │ 童鞋比价      │      │
│ │ 2 分钟前      │ │ 18 分钟前     │      │
│ └──────────────┘ └──────────────┘      │
├────────────────────────────────────────┤
│ 项目                                    │
│ ▎ dsh-mobile-app        6 个 · 2 分钟前 ⌄│
│   修上传 offset            12 秒前   ◆  │
│   重做会话页 UI            2 分钟前  ●  │
│   介绍 AI 助手自我介绍     1 小时前     │
│   还有 3 个 ›                          │
│ ▸ api-gateway           3 个 · 昨天   › │
│ ▸ 临时会话              2 个 · 3 天前 › │
│                                         │
│                          ＋ 新建会话    │
└────────────────────────────────────────┘
```

- **A 焦点条**：0~3 张卡，纵向堆叠。第 1 张是大卡（待审批优先），后面最多 2 张小卡并排。
- **B 项目分组**：组头可折叠；组内默认 3 条 + 「还有 N 个」。
- **C 未分组**：`cwd` 为空的会话落到「临时会话」，默认折叠。

## 4. 焦点条规则

- 候选集合：`待审批` > `running` > `最近 30 分钟内互动且未打开`。
- 最多 3 张；第 1 张全宽，其余两张各占一半。
- 卡片内容：项目名（mono，小号）、会话标题、状态徽标（待审批 / 运行中 / 已完成）、相对时间。
- 点击直接进会话；长按出「标记已读」。
- 没有候选时整段隐藏（不留空白）。

## 5. 项目分组规则

- 组头：左侧 3pt 竖脊（表示「当前所在项目」，和弧形转盘的定位脊同一套语言） + 项目名 + `N 个` + 最近活跃相对时间 + 折叠箭头。
- **默认展开**：最近活跃的那 1 组；其余折叠。折叠状态本地持久化（`projects-<gatewayId>.json`）。
- 组内排序：`updatedAt` 降序。
- 单会话项目：不折叠，直接平铺（省一次点击）。
- 组头右侧 `＋`：在该项目 `cwd` 下新建会话（走 `session-create` 的 `cwd`）。
- 长按组头：置顶 / 取消置顶（本地）。
- 会话行右侧状态点：待审批琥珀、运行中绿、已完成灰绿、普通无点。

## 6. 视觉规格（全部复用现有 token）

| 元素 | 规格 |
| --- | --- |
| 页面底色 | `bg.canvas` |
| 组头 | `bg.subtle` 胶囊，`radius 12`，高 44 |
| 组头当前项目竖脊 | `3 × 22`，`border.activeOrigin` |
| 会话行 | `bg.surface` + `hairline` + `border.default`，高 56 |
| 焦点大卡 | `bg.elevatedAnswer` + `border.activeOrigin` 1.5pt；待审批时边框换 `semantic.gateAmberText` |
| 焦点小卡 | `bg.surface`，状态点代替边框 |
| 组名 | 15/600；会话标题 14/400；元信息 11 mono `text.muted` |
| 展开/折叠 | `LayoutAnimation` 220ms `easeInEaseOut`，不做弹簧 |
| 焦点卡入场 | 120ms fade + 8pt translateY |

## 7. 边界情况

1. 同名目录不同路径（两个 `workspace`）：组名显示最后两段路径。
2. 会话数 > 50：组内虚拟化，并保留「还有 N 个」。
3. 运行中的会话被折叠在组里：组头加一个小绿点，避免「跑着却看不见」。
4. 网络断开：焦点条隐藏，分组用缓存（`sessions-<gatewayId>.json`）继续展示。
5. 搜索：输入即切到平铺搜索结果（复用现有搜索），清空回到看板。

## 8. 实现拆解

| 层 | 内容 |
| --- | --- |
| `src/protocol/projects.ts`（新） | `deriveProjects(sessions)` 纯函数：按 `cwd` 分组、组内 `updatedAt` 降序、算默认展开、返回焦点候选；配单测 |
| `src/storage/projects.ts`（新） | 折叠状态 / 置顶项目，按 gatewayId 存 |
| `src/ui/home/FocusStrip.tsx`（新） | 焦点条 |
| `src/ui/home/ProjectGroup.tsx`（新） | 组头 + 组内行，含 `LayoutAnimation` |
| `App.tsx` | 列表段替换成 `<HomeBoard/>`；保留网关头、搜索、新建 |

不改协议：**没有 workspace 帧，就按 `cwd` 派生**。等网关以后透出 `workspaceId/pinned/archived` 再切过去，`deriveProjects` 的入参留一个可选的 `workspaceId`。

## 9. 需要和 Gemini 定的 5 个问题

1. **焦点条形态**：1 大 + 2 小（占 ~200dp），还是 3 行紧凑列表（占 ~150dp）？会话很少时按哪种降级？
2. **默认展开策略**：只展开最近 1 组，还是「最近 24 小时有互动的都展开」？
3. **折叠状态跨设备不同步**能否接受？（协议没有 workspace 设置，只能本地）
4. **置顶**要不要做，还是纯靠 recency？（置顶同样只能本地）
5. **首页右侧要不要也放弧形转盘**？现在是会话页专属；如果首页也有分组，转盘的作用是「跨项目快速跳最近会话」，可能更有价值，但会和新列表的滚动手势抢。
