# dsh-mobile-app 交接文档

> 写于 2026-10-28。范围：从 10-25 的真机测试修复，到 10-27/28 的产品 UI 规范落地。
> 代码在 `master`，已推送到 https://github.com/solla-h/dsh-mobile-app （以 `origin/master` 最新提交为准，本文写作时为 6266796）。

## 1. 项目是什么

Expo SDK 58.0.19 + React Native 0.88 的安卓客户端，连第三方插件 `dsh-plugin-mobile-gateway`
（协议 `dsh-mobile-v1`），用来在手机上看 DeepSeek Harness 的会话、发消息、批审批。

**没有用 expo-router**：整个 App 是 `App.tsx` 里的一个状态机（未配对 → 会话列表 → 会话页），
路由相关的模板建议在这个仓库里不适用。

目录约定：

| 路径 | 职责 |
| --- | --- |
| `src/protocol/` | 纯函数：帧 → 内部模型，可单测，禁止 import react-native |
| `src/transport/` | WebSocket 客户端、文件上传下载、离线发件箱 |
| `src/storage/` | SecureStore / FileSystem 持久化 |
| `src/theme/tokens.ts` | 双色板、字号、动效常量 |
| `src/ui/` | 屏幕与组件（下方有地图） |
| `docs/` | 产品 UI 规范 + 参考实现 |

## 2. 这一轮做完了什么

### 2.1 产品 UI 规范落地（d5c775c / a38a818 / 77aa1a3 / 13ba216）

按 `docs/dsh_mobile_app_product_ui_spec.md`（v3.0）把会话页整套形态重做了：

- **双色板**：`paper`（日间暖石纸 #F4F2ED）/ `eink_slate`（夜间暖炭灰），弃用纯黑纯白；
  `useThemedStyles(makeStyles)` 按色板生成样式表，全站（会话页、列表页、配对页、所有抽屉、Markdown 代码块）
  已无硬编码颜色，`app.json` 的 `userInterfaceStyle` 改成 `automatic`，状态栏图标跟着翻色。
- **三阶段流**：思考 `ThinkPill` 默认展开打字机 → 正式回答阶段自动折成 34pt 胶囊并带一句摘要；
  连续工具调用合并成 `ToolGroup`（跑完显示「已折叠 N 项连续工具调用（BASH +N）」）；
  回答独占 `AnswerCard`（`bg.elevatedAnswer` 微提亮 + hairline 边框）。
- **审批拇指坞** `ApprovalDock`：折叠态待批复条 + 信任目录胶囊 + 2:3 双按钮；
  `src/protocol/risk.ts` 的 `assessRisk/approvalRisk` 分级，高危改成长按 0.5s 暖砂色充能。
- **78% 三段式决策卡** `TriageSheet`：01 为什么改 / 02 改哪里（内嵌 `DiffView`）/ 03 后续动作。
- **Diff 交互** `DiffView`：自动折行与横向滚动切换、点某行 → 引用回输入框（`> 引用 file:12：…`）。
- **4.5s 悔棋窗** `GraceUndo`：拍板后界面立刻推进，真正的 `approval-response` 压 4.5s 再发，
  点「撤回拍板」= 取消发送（网关审批是一次性的，重复提交只回 `accepted:false`）。
- **右侧弧形转盘** `ArcDial`：2pt 感应条按住展开，6 张卡沿弧排布、选中项 spring 吸附，松手切会话。
- **2px 上下文水位线 + 顶栏灵动胶囊** `AmbientContext`。

### 2.2 会话页滚动与头部（77aa1a3）

- 会话页不再渲染全局 `DSH / 网关名 / 已连接` 头，省出约 90dp（之前是双层头）。
- 进入会话直接贴底：首屏历史连滚三枪（80/260/700ms），避开大代码块延迟测量。
- 流式期间按**真实内容高度**跟随（`scrollToOffset` 而不是 `scrollToEnd`，后者在高度估算时会算短）；
  只有手指真的拖动列表（`onScrollBeginDrag`）才停止跟随，程序滚动不算。
- 键盘弹出补 280ms 二次贴底，避开 MIUI 输入法动画。

### 2.3 更早的稳定性修复（10-25 ~ 10-27）

`3710885` 断线时排队消息的编辑/撤回/插话不再静默丢失；`0fa9bda` running 状态提到 App 持有；
`cf76c1b` 被拒收的消息回显标「发送失败」；`741c0e4`/`2424c92` 断网保留列表与历史；
`e0f21ff` 新建会话可选目录；`dfd1cc9`/`7cfd3e3` 多图按气泡宽度分列；`8355ac5` 失败回显不参与去重。

## 3. 测了什么（真机：24129PN74C，Android 16，1200×2670）

### 3.1 已验证通过

- 扫码配对：App 内扫码（不是 Expo Go 启动器的扫码），连真网关 `default-vnic`，协议 v3，10 个会话。
  注意手机端连的是 `wss://gw.coding.us.ci/ws/mobile`；服务器 `dsh-pair` 给的 `publicUrl` 是本机
  `ws://127.0.0.1:3080`，靠 `endpoints` 回退，或在贴配对串时把 `publicUrl` 改写。
- 列表页浅色渲染；会话页浅色 / 深色各一遍，色板、状态栏、卡片对比度正常。
- 发送消息 → 顶栏 `THINKING` 胶囊 + 停止按钮 + 「排队 / 插话」切换出现。
- 回合结束 → 思考折成「已深度思考 · 摘要」、工具折成「已折叠 1 项连续工具调用（BASH）」、回答卡与代码块（引用/复制）正常。
- 流式跟随：键盘开着也贴底，不再出现「回到底部」常亮（修复后复验过）。
- 首屏进入即停在最新一条。
- v4 导入后复验：列表卡片有了 surface 底色 + hairline 描边；回答卡出「DEEPSEEK 正式回答 · FORMAL RESPONSE [主视窗聚焦]」题头；
  代码块带行号与「点按行可引 / 自动折行 / 整块引用 / 复制」；工具组折叠成「已折叠 1 项连续工具调用（Bash）」。
- 弧形转盘：**轻点右侧感应条已能展开**（并保持展开供点选），卡片等距排布不重叠、序号在卡外、锚点挂在弧上；
  按住拖动切换的手感需要人手指验（adb 合成手势按不出来）。

### 3.2 想测但环境不允许

**审批链路（ApprovalDock / TriageSheet / GraceUndo）没能在真机跑起来。**

- 网关默认 `DSH_PERMISSION_MODE=workspace-write`，工作区内的 `rm -rf` 直接放行，不弹审批；
- 工作区外（如 `/opt`）被沙箱直接拒绝，容器带 `no_new_privs`、`sudo` 不可用，
  agent 不会发起「申请越权」，所以 `approval-requested` 帧从头到尾没出现过；
- 已按用户要求把 profile 的 approval policy 显式改成 `ask` 并重启 `dsh-web`（见 §7），仍然不触发。

结论：审批 UI 目前只能靠 mock 网关验证（帧格式与真协议一致）。

## 4. 还没实现（规范里有、代码里没有）

| 项 | 状态 |
| --- | --- |
| 按住说话 | **没做**：需要 `expo-audio` 录音 + 网关 `speech-catalog / prepare / transcribe` 一族帧（能力位 `speech-input-v1`），且必须真麦克风验 |
| 思考耗时标签 | **已做**（v4 导入）：`ThinkPill` 本地每秒累计 `liveSec`，显示成 `(1m 42s · 1.8k tok)`；协议没有 duration 字段，所以只能本机计时 |
| 自动跳栈 | **已实现，未验证**：`SessionScreen` 在悔棋窗到期后延迟 `MOTION.autoHopMs` 切到下一个待审批会话；要等审批链路能触发才测得了 |
| 方案 C（上下分屏 HUD） | **没做**：规范里的备选方案，未开工 |

## 5. 已知问题 / 风险

1. `npx expo lint` 有 **5 条 `react-hooks/set-state-in-effect` 错误**，都是这轮改动之前就存在的基线
   （会话重置、sheet 展开、pendingSends、草稿加载），不要误以为是新引入的。
2. Expo Go 的悬浮齿轮（开发菜单按钮）会压在顶栏「已连接」胶囊上，**只在 Expo Go 里有**，正式包不会有。
3. 弧形转盘的感应条命中区已放宽到 24dp 且从边缘内缩 2pt，轻点可以稳定展开；
   但「按住拖动」的自动化（`input motionevent`）仍会被系统返回手势或列表滚动吃掉，只能人工验证。
   另外展开后卡片左侧会被屏幕裁掉一部分——这是照设计稿做的，觉得裁太多就调小 `CARD_W`（当前 240）。
4. MIUI 自带输入法在 pinyin 组合状态下会把 `rm` 转成「人民」。
   已把默认输入法切成系统自带百度输入法，`input text` 里的 `%s` 可正常上屏空格。
5. 真机调试依赖 `adb reverse tcp:8081 tcp:8081`，adb server 重启后会丢。

## 6. 计划

### 下一步（按优先级）

1. **人工复验弧形转盘**：轻点/按住屏幕右缘中部，确认 6 张卡的等距弧排、序号位置、拖动时的棘轮震动与吸附手感。
2. **审批 UI 用 mock 跑完 6 个态**：折叠坞、高危长按充能、78% 决策卡、diff 点行引用、目录信任、4.5s 悔棋。
3. **深色逐屏**：列表 / 会话 / 各抽屉（任务、大纲、命令面板、目录选择器）/ 图片查看器。
4. **断线态回归**：飞行模式下顶部提示、会话页保留、发件箱补发。
5. **打包实测**：`eas build`（用户要求放在 UI 全部核对完之后）。

### 之后

- 未实现四项按价值排期：按住说话 > 自动跳栈 > 思考耗时 > 方案 C。
- 协议层补 approval 的端到端覆盖（mock 里已经有 `approval-requested/resolved` 的样例）。

## 7. 环境与命令

**本机**

```
adb: C:/Users/from0/AppData/Local/Microsoft/WinGet/Packages/
     Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe/platform-tools/adb.exe
截图缩放: PowerShell 跑 cloud-env/.tmp/adb/shrink.ps1 <in> <out> 780   # 原图直接看会撑爆上下文
```

**服务器 `chuncheon-from0632`（140.245.70.226，ubuntu）**

```
dsh web 跑在 systemd 单元 dsh-web.service，cwd /home/dsh/workspace
配对:  sudo -u dsh -H dsh-pair          # 输出 5 分钟有效的配对串
profile: /home/dsh/.dsh/profiles/web/cordis.patch.yml（改审批策略的地方，备份 .bak-*）
```

**设备侧**

```
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"
```

**mock 网关**（审批 UI 用）

```
node cloud-env/.tmp/adb/mock-gateway.mjs      # 监听 8787，adb reverse tcp:8787 tcp:8787
配对串: 把 publicUrl 写成 ws://127.0.0.1:8787，version 必须是 2（App 只认 v2）
```

**检查三件套**

```
npx tsc --noEmit && npx jest && npx expo lint
```

## 8. 关键文件地图

```
App.tsx                      配对 / 网关切换 / 会话列表 / 全局待办
src/ui/SessionScreen.tsx     会话页（最重的一个文件：流、滚动、审批、抽屉都在这）
src/ui/stream/               ThinkPill / ToolGroup / AnswerCard / DiffView / group.ts
src/ui/dock/                 ApprovalDock / TriageSheet / GraceUndo
src/ui/nav/                  ArcDial（弧形转盘）/ AmbientContext（水位线、状态胶囊）
src/ui/theme.tsx             useTheme / useThemedStyles / MONO
src/theme/tokens.ts          PAPER / EINK_SLATE / TYPE / MOTION
src/protocol/risk.ts         审批风险分级
src/protocol/interactions.ts PendingApproval / PendingQuestion 类型
```

## 9. 提交记录（近 6 条）

```
80852e3 fix: 流式期间按 chunk 补贴底，避免回答被顶到屏幕外
efa127f feat: 导入 v4.0 规范与 Gemini 精修版，转盘按圆弧重做
13ba216 fix: 弧形转盘压缩间距、卡片两行不透明，拖动时卡片跟手移动
77aa1a3 fix: 会话页自动贴底、去掉双层头，弧形转盘重排并加弹簧吸附
a38a818 feat: 全站配色迁到 paper/eink_slate 双色板，跟随系统深浅色
d5c775c feat: 按产品规范重做会话页 UI（三阶段流、审批拇指坞、决策抽屉、弧形转盘）
0fa9bda fix: 运行状态改由 App 持有，重连后停止按钮不再一直挂着
3710885 fix: 断线时别静默丢掉排队消息的编辑/撤回/插话
```

## 10. 接手时先看这三件事

1. `npx tsc --noEmit` 干净、`npx jest` 58 例全过、lint 只剩 5 条既有基线 —— 先跑一遍确认环境没坏。
2. 会话页的滚动逻辑集中在 `followRef` / `atBottomRef` / `onContentSizeChange`，
   改之前先读那几条注释，别再用 `scrollToEnd` 追流式内容（会算短）。
3. 审批 UI 在真机上一定弹不出来（原因见 §3.2），要验证就起 mock，别怀疑是代码坏了。

## 11. v4.0 规范与 polished 代码导入（2026-10-28）

`docs/dsh_mobile_app_product_ui_spec_v_4_0.md` 是设计方（Gemini）对上一版的审查意见；
`D:\workspace\open_source\dsh-mobile-app-polished` 是他直接改好的源码树。

**已合并进本仓库**（一次性覆盖 17 个文件）：

- `chat.ts` 新增 `splitThinkTags()` / `reasoningOfBlocks()`：历史与流式都能提取 `thinking` 块和内嵌 `<think>`；
- `ThinkPill` 增加 `answerStarted`：正文一开始吐字就折叠；
- `ToolGroup` 内嵌 `extractToolDiff()` 的 Diff、待审批 callId 琥珀色高亮；
- `AnswerCard` 补 `DEEPSEEK 正式回答 · FORMAL RESPONSE [主视窗聚焦]` 题头；
- `Markdown` 代码块行号 + 单指点行引用、diff 围栏路由到 `DiffView`；
- `ApprovalDock` 高危长按显示百分比、`GraceUndo` 移到输入框上方、`SessionScreen` 加自动跳栈；
- `App.tsx` 列表卡片改成 `bg.surface` + hairline 描边。

**导入后由本仓库补的修复**：

- `ArcDial` 的 `StyleSheet.absoluteFillObject` 在本版 RN 类型里不存在 → 改成手写绝对定位；
- `SessionScreen` 里 `messages.find(...).reasoning` 的联合类型窄化报错 → 先取出 assistant 再读；
- `TriageSheet` 的 `({dir}/*)` 被 JSX 当成注释开始 → 改成字符串拼接；
- `ArcDial` 的 PanResponder 拆成 `useCallback` 处理器，规避 React Compiler 的 refs/purity 规则
  （`PanResponder.create` 一处保留 eslint-disable 并注明原因）；
- **转盘几何重做**：原实现按 ±44° 三角函数放卡片，卡片比弧长高，6 张会互相压；
  改为「以选中项为弧顶 + 纵向等距 PITCH=58 + 横向按 R=340 圆方程收」，
  序号移到卡片外侧、锚点圆环贴在弧上，并去掉了和弧对不齐的 17 道静态刻度。

**导入后又修了一个回归**：`onContentSizeChange` 只在内容高度变化时触发，同一段文字在长高不会回调，
回答会被顶到屏幕外。已在 `SessionScreen` 加一个监听 `streaming.text.length` 的贴底 effect（80852e3），真机复验通过。

**尚未人工确认**：转盘展开后的整体观感、按住拖动时的棘轮震动与吸附手感、
以及自动跳栈（`approval-resolved` 后 360ms 切下一个待审批会话）——后者要等审批链路能触发才测得了。

## 12. 协议层：workspaces 与 search（2026-10-29）

首页看板的 UI 在等设计稿，但这两个协议的**数据形状不依赖设计**，所以先落地了纯协议层，
一行 UI 都没写。

新增：

| 文件 | 内容 |
| --- | --- |
| `src/protocol/types.ts` | `WorkspaceItem` / `WorkspacesFrame` / `SearchHitFrame` / `SearchFrame`，及 `ClientFrame` 里的 `workspaces` / `search` 两个请求帧 |
| `src/protocol/projects.ts` | `deriveProjects(sessions, workspaces?)`：把两帧拼成「项目 → 会话」树，返回 `ProjectBoard` |
| `src/protocol/search.ts` | `normalizeQuery` / `mapSearchResult` / `resolveSearchHits`（把命中项 join 回标题并标归档） |
| `src/protocol/__tests__/projects.test.ts`、`search.test.ts` | 8 + 8 条单测 |

真网关实测（详见 `docs/protocol-coverage.md` §1.1）跑出来的三个结论，直接决定了 `deriveProjects` 的写法：

1. **工作区覆盖率极低**：30 个会话只有 3 个落在工作区里，其余 27 个没人认领。
   所以分组必须是「工作区优先 + cwd 兜底」，只按 `workspaces` 分会丢掉大半会话。
2. **归档会话仍在 `sessions` 里**（18/30），要自己剔掉；归档集合原样带回给 UI 显示计数。
3. **搜索命中没有标题**，且大量命中是归档会话，所以 `resolveSearchHits` 要做 join + 归档标记。

刻意**没有**做：App.tsx 里的请求与状态、折叠/置顶的本地持久化、任何看板组件。
这些都要等首页设计定稿，现在写就是白写。下一步接之前，先把 `client.send({type:'workspaces'})`
和 `client.send({type:'search', query})` 挂到合适的时机（连接就绪 / 搜索框提交）即可。

注意 `workspaces` 不是廉价查询：网关每次都会开一条 `workspace/follow` 流取首帧再断开，
别拿它轮询；成员和置顶变化也没有推送帧，只能重查。

## 13. 轨迹页 + 审批链路真机验证（2026-10-30）

### 13.1 做了什么

轨迹页（`src/ui/stream/TrajectoryView.tsx`）重做，映射层跟着补：

- **一行一件事**：正文默认压 4 行、点开看全文；上下文注入折 2 行；
  工具行是「名字 · 参数首行 → 结果首行」+ 耗时/错误码；每轮一条分隔线兼作轮次分界
  （`第 N 轮 · 本轮出错：RATE_LIMIT · 42s`，红/琥珀/灰三色）。
- **审批记录进轨迹**，两个来源：网关审计事件对（`approval/asked` + `approval/decided`，conversation 视图不裁）
  和本机拍板瞬间的回显（带 `callId`，历史一到就让位，不会画两遍）。
- `developer/message`（工具增删）映射成上下文行 `+bash -write`；
  `compaction/summary` 带出摘要全文（收起一行、展开看正文）。
- 修掉历史/实时两套 `tool/result` 的失败判定不一致：统一按
  `message.isError || data.error || 结果块 isError` 三处任一。
- 小改：内联代码块加圆角（`Markdown.tsx`）；轨迹角色色进了 `tokens.ts`（`role.*`，深浅两套）。

### 13.2 真机验到了什么（24129PN74C，1200×2670）

- 轨迹页各类行、上下文折叠、工具耗时、`思考 N 字`、通知行合并（一次 429 只留一行）、
  出错分隔线、失败工具红字——都过了。
- **审批链路整条走通**（这台宿主上第一次）：
  `approval-requested` → 面板显示宿主给的 zh displayReason → 快速批准 → 悔棋窗倒计时 →
  轨迹出现「已批准 · 本机决定 · bash · 允许执行这条探针命令吗？」→ **重开会话重拉历史后**，
  同一行换成审计记录「已批准 · bash · 移动端审批链路真机验证」（meta 消失、**只有一行**，callId 去重生效）；
  点开那一行显示「审计记录只留工具名和说明文字，参数在对应的工具行上。」
- 宿主落库的原始事件（`session-573daa7b-…`）：
  `{"type":"approval/asked",...,"data":{"id":"287be01d-…","toolName":"bash","callId":"call_resp_01a18cd7-…_0","reason":"移动端审批链路真机验证"}}`
  `{"type":"approval/decided",...,"data":{"id":"287be01d-…","outcome":"allowed-once"}}`

### 13.3 宿主侧的关键发现（别再重复踩）

1. **这台宿主从来没有任何一次真审批**：把 `/home/dsh/.dsh/sessions` 全量解压 grep，
   `approval/asked` 只出现在插件 API 的文档字符串里，零个真实事件。
2. approval policy 本来就是 `ask`（`cordis.patch.yml:121-122`），**不是**策略没生效。
3. 真正的原因：宿主 bash 执行器**没有 sandboxMode**，所以工具 JSON schema 里根本没有
   `sandbox_permissions` / `justification`（deployed `dsh-tool-bash/lib/index.js:343-346`、`519-527`；
   所有 session 的 `request/header` 里 grep 零命中）。模型想申请越权也传不进去，只在
   `justification` 单独到达时被校验器打回：`invalid escalation: justification-without-sandbox_permissions`。
   「用 danger-full-access 触发审批」这条路在**当前组合**下是死的。
4. **要造一次真审批，照抄这个临时钩子**：`cordis.patch.yml` 末尾追加
   ```yaml
   - insert:
       - id: approval-probe
         name: './approval-probe.mjs'
   ```
   同目录放 `approval-probe.mjs`：`tools/pre-execute` 里只对含 `DSH_APPROVAL_PROBE` 的命令返回
   `{kind:'ask', reason, displayReason:{en,zh}}`，其余 `return next()` 原样放行；然后
   `sudo systemctl restart dsh-web`。**验完必须删插件 + 撤 patch 再重启**（本次已撤，
   patch 备份在 `/root/cordis.patch.yml.bak-approval-probe`）。
5. 宿主 DSH `0.2.1-rc.3`，网关 npm `0.11.1`，会话日志是 zstd：
   `zstdcat <session>.v4.jsonl.zstd | grep -oE '"type":"approval/[a-z]+"'`。

### 13.4 没测的 / 已知取舍 / 下一步

**没测**：`拦截 → 已拒绝` 那一行（同一分支的另一个 label）、`无人应答`/`请求已撤回` 两种非人决定、
同一 callId 两次审批的去重（同一 `exec.callId` 可能先预审批再沙箱升权，按 callId 过滤会把第二次回显一起吃掉，
丢了的那条要等下次重拉历史才补回来）。

**已知取舍（都留了注释）**：

- 回显时间用手机 `Date.now()`，消息时间是宿主钟；两端差几分钟时审批行会插错位置，直到重拉历史换成审计行。
- `asked`→`decided` 的配对是单页局部的：网关 256KB 快照边界正好切在这对事件中间时，
  decided 那行退化成「工具调用」且丢 callId（长会话偶发）。
- `running` 之前漏传给轨迹页，运行中的工具显示成「没有输出」（已修）。

**还能扩的映射**（history 里有、手机没画的事件，按价值排序）：
`command/run`+`command/done`（斜杠命令）、`agent/inbox/spliced`（排队/插话/撤回）、
`subagent/catalog`（派过子 agent）、`compaction/prune`、`todo/write`、`goal/change`、`plan/mode`。

**测试残留**：`/home/dsh/mobile` 下「Verify approval flow with Bash tool」是本次探针造的会话
（含 `echo DSH_APPROVAL_PROBE` 和几次失败的 escalation 尝试），可删。

## 14. 本机网关 + 输入栏手势（2026-10-31）

家里网络到 chuncheon 不稳，改在本机起网关测（做法见 `AGENTS.md`「本机网关」）。
本机 Windows 组合了 `pwsh-sandbox`，工具 schema 里有 `sandbox_permissions` + `justification`，
**模型能自己申请升权 → 真审批**，不需要 §13.3 那种临时探针插件。

真机确认：§13 里挂着没看的「请求已撤回」行已经正常渲染（2026-10-30 23:05:22 那条）。
多网关配对/切换/冷启动记忆也都验过（`default-vnic` ↔ 本机 `yong_huang`）。

### 待办（明天讨论，不用当场验证）

- **`Reasoning and tool use` 胶囊的收纳与折叠逻辑还有问题**。用户观察到的现象记在这里，
  明天再深入：收起/展开的触发时机、嵌套层级、以及和下面 AnswerCard 的关系要一起捋。
  主要看 `src/ui/stream/ActivityGroup.tsx`、`ThinkPill.tsx`、`ToolGroup.tsx`，
  组装逻辑在 `src/ui/stream/group.ts`。
