# 界面 i18n 说明

App 界面提供中文与英文两套文案。这份说明记录字典形状、术语口径、版本对照依据，以及当前可核验的
测试证据。仓库文档以中文为准。

- 界面代码：`App.tsx` 与 `src/` 下所有用户可见文案、协议 / 传输层的用户可见消息与 a11y 标签都经 `tr()` 输出。
- 运行时字典：`src/i18n/`。
- 语言设置：`src/ui/home/HostInfoSheet.tsx` 的「界面 / 语言」行，离线可达；偏好持久化在 `app-settings`。

## 字典形状

- `src/i18n/keys.ts`：`KEYS` 是 `as const` 的中文字符串数组，`Key = (typeof KEYS)[number]`。
  中文文案全集即真源——中文原文直接当 key，中文模式 `tr()` 原样返回 key，不需要第二份中文字典。
- `src/i18n/en.ts`：`export const en = { ... } satisfies Record<Key, string>`，按 key 逐条给出英文。
  `satisfies` 保证漏任何一条中文 key 都是编译错误。
- 占位符：`tr(key, params?)` 支持编号 `{0}` 与命名 `{name}` 两种；数组参数按编号取值，对象参数按名字取值。
  英文译文必须保留同名 / 同编号占位符，构建脚本会校验占位符是否一致。
- 语言出口：`src/i18n/index.tsx` 提供 `tr()`、`LanguageProvider` / `useLanguage()` / `useLanguageVersion()`，
  以及 `systemLanguage()`（无显式偏好时 `zh*` 用中文，其余含 `en-US` 与未知 locale 回退英文）。
  偏好经 `src/storage/app-settings.ts` 读-合并-写，与全局字号设置共存。

## 界面文案在哪里，如何新增一条

界面文案写在 `App.tsx` 与 `src/` 的界面代码里，统一走 `tr('中文原文')`；注意网关 DATA
（会话标题、历史正文、工具名）按设计不翻译，`commands` 帧 `locale` 与轨迹时钟改为跟随当前界面语言
（`en-US` / `zh-CN`）。

新增一条界面文案：

1. 在界面代码里调用 `tr('中文原文', params?)`，中文原文就是 key；变量用 `{0}` / `{name}` 占位符。
2. 运行 `node scripts/i18n-extract.mjs`：用 TypeScript AST 扫描 `App.tsx` 与 `src/` 的中文字符串，
   把去重后的 key 清单 `keys.json` 与报告 `report.md` 写到仓库内的 `scripts/i18n/`。
   扫描排除 `src/i18n/` 与 `__tests__`，该目录内文案由构建脚本的 `EXTRA` 固定维护。
3. 为该 key 补英文译文。`i18n-build-dict.mjs` 合并 `scripts/i18n/en-part-{1..4}.json` 四份分片与脚本内
   `EXTRA`；缺少译文的 key 会回退成中文原文，脚本打印 `missing=` / `placeholderMismatch=` 计数，
   两者都应为 0。四份分片已随仓库纳入，新克隆无需临时目录或联网即可重生成。
4. 运行 `node scripts/i18n-build-dict.mjs`：重新生成 `src/i18n/keys.ts` 与 `src/i18n/en.ts`。
5. `npm run typecheck`：`satisfies Record<Key, string>` 让任何未覆盖的中文 key 成为编译错误。

两个再生成命令（按顺序）：

```bash
node scripts/i18n-extract.mjs
node scripts/i18n-build-dict.mjs
```

`scripts/i18n-apply.mjs` 是本次一次性 codemod，不参与日常维护。

## 为什么模块级 `tr()` 必须惰性

`tr()` 是模块级文案出口（`src/protocol` / `src/transport` 的纯函数也要产出给界面看的句子，
拿不到 React context），读取模块级 `activeLanguage`。语言切换由 `useLanguageVersion()` 广播，
`src/ui/theme.tsx` 的 `useThemedStyles()` 统一订阅并触发整棵树重渲染，组件在渲染期重新调用 `tr()`
即可拿到新语言。

因此，模块顶层把 `tr('中文')` 求成常量的写法会把当时的语言冻结，切换后不会更新。模块级文案必须惰性：
用函数 / getter（`languageOptions()` 每次调用重新取值即为一例）或在渲染期调用，绝不写成模块级常量。

## 官方术语（对齐口径）

界面文案以官方词表为准，固定对照：

| 中文 | English |
| --- | --- |
| 允许一次 | Allow once |
| 拒绝 | Reject |
| 等待审批 | Waiting for approval |
| 待审批 | Approval |
| 审批详情 | Approval details |
| 空闲 | Idle |
| 运行中 | Running |
| 停止生成 | Stop generating |
| 轮次 | Turn |
| 子智能体 | Subagent |
| 网页搜索 | Web search |
| 未分组 | Ungrouped |
| 用户 | User |
| 展开 | Expand |

层级与保留规则：

- 层级：`Session > Round > Turn（轮次）> Step（步骤）`。
- `Round` 保留英文，不译作「回合」「目标回合」「Ralph 回合」。
- `subagent` 在中文 UI 用「子智能体」，禁用「子代理」。
- agent 组合词与缩写（如 `agent preset`）在中英文界面都保留英文原文 / 缩写，不翻译。

## 版本口径

App 在 `compatibility.json` 锁定 DSH `0.2.1-rc.5`；issue #10 的官方词表对照基于官方 checkout
提交 `5badb15`（`dsh-v0.2.0-rc.2-266`）。我们在上游标签 `dsh-v0.2.1-rc.5` 重新取回官方词表，
与本地 `5badb15` checkout 逐文件比对：`docs/i18n/translation-rules.md`、
`packages/client/locale/src/locales/{zh,en,settings}.ts` 与
`packages/client/ui-approval/src/client/locales.ts` 逐字节一致；`docs/i18n/terminology.md`
仅多出一行 `exchange | 交互段 | 不要译作 回合、交换`；`ui-conversation` / `ui-trajectory` 的 locale
只增减了与本 issue 无关的 key。因此，本 issue 依赖的每一个术语在所锁定标签上都未改变；
这不等于官方所有词表文件逐一相同（`terminology.md` 与两个 locale 文件确有增减），
不能据此写成「官方文件全部一致」。

## 测试与证据

以下均为**源码 / 测试确认**，来自仓库内实际存在的单元测试与本地 UI 集成测试；
**未运行任何真机 E2E / 实体设备验证**：

- `src/i18n/__tests__/dictionary.test.tsx`：字典完整性（英文覆盖全部中文 key 且无多余条目、译文非空且不含中文、
  占位符与中文 key 对应、审批与状态词使用官方英文用词、不出现官方禁用译法、中文 key 不再含六种非官方审批
  用词与设计稿残留）；`tr()` 在中英文偏好下的返回；切换语言持久化偏好并通知订阅组件重渲染；
  系统语言 `zh*` 用中文、其余回退英文。
- `src/storage/__tests__/app-settings.test.ts`：`app-settings` 读-合并-写——写语言保留已有字号、
  写字号保留已有语言、无旧设置只写新字段、旧文件损坏也不丢新设置。
- `src/ui/__tests__/app-journey.english.test.tsx`：英文界面本地 UI 集成旅程。主路径为配对 → 列表 → 会话 →
  发消息 → 返回，全程不出现中文界面文案；审批路径在会话连接注入 `approval-requested`，断言
  `Allow once` / `Reject` / `Approval details` 等官方英文出现、中文审批词为 0，并覆盖三个分支：
  悔棋窗到期后真的发出 `approval-response`（`allowed-once`）、点撤回后不发帧、未到期就离开会话时
  卸载补发且不重复。另有「无显式偏好时按系统语言回退英文」。

审批旅程只覆盖 `allowed-once`；`reject`、高危长按充能、命令不可见阻断、多条审批队列与目录信任自动
批准仍未自动化，控制连接侧的全局待办与首页徽标也未纳入该测试。这些属于已知缺口，不写成已覆盖。

既有中文旅程测试显式设置 `app-settings.language='zh'`，以免 CI 系统 locale 影响结果。这些是本地
UI 集成测试，不是真机 E2E；本页不把自动化与本地集成证据升级为真机结论。
