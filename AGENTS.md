This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

> This file is for **developing the app**. If you are a DSH agent asked to install/configure the mobile gateway on
> a host, use [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md) instead.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## 这个项目的实际结构

Expo SDK 58 + React Native 0.88，**没有用 expo-router**：整个 App 是 `App.tsx` 里的一个状态机
（未配对 → 会话列表 → 会话页），下面的规则优先于上面「Navigation & Routing」那一节的模板建议。

```
App.tsx                  网关配对、会话列表、多网关切换、全局待办
src/protocol/            纯函数：帧 → App 内部模型（可单测，别在这里 import react-native）
src/transport/           WebSocket 客户端、文件下载器、离线发件箱
src/storage/             SecureStore / FileSystem 持久化（网关、草稿、状态）
src/ui/                  屏幕与组件
```

## 协议

服务端是第三方插件 `dsh-plugin-mobile-gateway`（protocol `dsh-mobile-v1`）。
不确定帧名/字段时，读源码里的 `PROTOCOL.md` 和 `lib/index.mjs`，不要靠猜。

**版本绑定**：每个 App 发布版本与 gateway/DSH 的已验证组合写在 [`compatibility.json`](compatibility.json)
和 [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)。安装/发版前先看；禁止把 `@latest` 当默认。

**源码位置**：`../dsh-plugin-mobile-gateway`（没 clone 就用
`git clone https://github.com/Clarklevis1995/dsh-plugin-mobile-gateway.git` 拉一份）。

**注意源码版本可能领先 npm 发布版**。仓库 `main` 的 `package.json` 版本号不随每次提交更新，
所以「源码里有」不等于「线上网关跑着」。发版前两者会分叉：线上装的是 npm 包，
要确认某个能力真的落到线上了，还得 `npm pack dsh-plugin-mobile-gateway@<线上版本>` 对一遍。
两边冲突时以 npm 包为准。

几个已经踩过的坑：

- 通道：带 `X-DSH-Channel: conversation` 的连接只接受 `message/history/subscribe/unsubscribe`；
  `tasks/goal/fork/agent-presets/session-agent-preset` 都是 **control 专属**。本 App 的会话连接是
  legacy（不带 channel 头），所以两边都能发；不要随手给它加 channel。
- `goal` 响应是双层嵌套 `goal.goal.{id,revision,...}`；写操作的响应 **不回 sessionId/requestId**，
  只能整体重查一次拿新 revision。
- `ref.revision` 必须是正整数；读不到合法 revision 就当没有目标（`mapGoal` 已按这个约定实现）。
- `fork` 带 `atSeq` 时必须同时带 `historyFormatVersion: 4`，否则 `history-format-mismatch`；
  响应里的 `sessionId` 是**新会话**的 id。
- 文件下载的 `offset` 是**解码后**的字节数，下一页 = 服务端 offset + base64 解码长度。
- `agent-preset` 一旦会话跑过一轮就 `locked`，锁上不会再解开。
- `assistant-stream` 的 start/end 是**每步**（每次模型尝试）一对，**不是每回合**；
  回合边界只看 `turn/end` 事件（真机探针实测：3 步的回合 = 3 对 start/end + 1 个 turn/end）。
- `rendezvous-config` 有两种形态：请求/响应带 `requestId`，配置变化时的主动推送**不带**。
  App 两种都要采纳（无 `requestId` 直接处理，带 `requestId` 仍严格关联），否则换 Worker/
  重新部署后要等下一次重连才迁移，甚至可能因旧 Worker 已删除而卡死。
- 同一 `gatewayId` 下 URL/key 变化是正常迁移（手动↔托管、停用再启用、重新部署），
  App 必须更新配置并清空 `seenRev`；只有 `gatewayId` 与配对记录不一致才拒绝。
- 托管 Worker 名由网关状态里的 `deploySalt` + `gatewayId` 派生（16 hex），停用保留时
  状态 `active:false` 但文件仍在；`configured` 只看 `active`，不要用「状态文件存在」判断。

## 宿主与真网关

真网关跑在 **`dsh-host`**（`~/.ssh/config` 里有别名，`ssh dsh-host`；
`admin` 有 NOPASSWD sudo）：

```
dsh-web.service         # systemd 单元，User=dsh，HOME=/home/dsh，cwd /home/dsh/workspace
/home/dsh/.dsh/sessions # 会话日志，<session>.v4.jsonl.zstd（zstdcat 后 grep）
/home/dsh/.dsh/profiles/web/cordis.patch.yml   # profile 补丁层（改审批策略/插插件都在这里，动前先备份）
sudo -u dsh -H dsh-pair                        # 打印 5 分钟有效的配对串
```

**要造一次真审批**（App 的审批 UI 只有这条路能验）：临时插一个 ask 钩子——
`cordis.patch.yml` 末尾加

```yaml
- insert:
    - id: approval-probe
      name: './approval-probe.mjs'
```

同目录放 `approval-probe.mjs`（`tools/pre-execute` 里只对含 `DSH_APPROVAL_PROBE` 的命令返回
`{kind:'ask', reason, displayReason:{en,zh}}`，其余 `return next()`），然后 `sudo systemctl restart dsh-web`，
在手机上发一条 `echo DSH_APPROVAL_PROBE`。**验完把插件和那段 patch 一起删掉再重启**，别留在生产上。

已确认的死路（别再试）：宿主 bash 执行器没有 `sandboxMode`，工具 schema 里**没有**
`sandbox_permissions`/`justification` 这两个参数，所以模型「申请越权」的调用会被校验器直接打回
（`invalid escalation: justification-without-sandbox_permissions`），永远不会 ask；
approval policy 本身是 `ask`，不是策略问题。详见 `docs/HANDOFF.md` §13.3。

## 本机网关（家里网络差的时候用它测）

`dsh-host` 那台跨国家庭网络容易抖，本机也能起一个**功能等价**的网关，而且**不用探针插件就能出真审批**。

```bash
npm i -g @deepseek-ai/dsh@0.2.1-rc.3          # 与宿主同版本，已装
dsh plugin --profile web add dsh-plugin-mobile-gateway
# profile: ~/.dsh/profiles/web（package.json + cordis.patch.yml）
cd ~/dsh-lab && MAGPIE_GATEWAY_KEY=magpie dsh web --no-open
```

`cordis.patch.yml` 里接的是**本机 magpie**（`http://127.0.0.1:3425/v1`，`api: openai-completions`，
默认模型 `group/dsf-1017`），不需要任何外部 key；magpie 本身不校验鉴权，`MAGPIE_GATEWAY_KEY`
随便给个值就行（`apiKeyEnv` 指向的变量缺失会报错，所以要给）。

**端口**：`3080` 只绑 loopback（Web UI + `/ws/mobile` + `/mgw/*` 管理面），
`3081` 绑 `0.0.0.0`（局域网 `/ws/mobile`）。Windows 防火墙早有放行
`C:\Program Files\nodejs\node.exe` 的入站规则（Private+Public），局域网这条路不用再动系统设置。

**开网关 + 配对**（`dsh-pair` 是 dsh-host 上的脚本，本机直接用 curl）：

```bash
curl -X POST http://127.0.0.1:3080/mgw/gateway -H 'content-type: application/json' -d '{"mode":"persistent"}'
node .scratch/local-pair.mjs                    # 默认局域网入口，生成二维码页并打开浏览器
node .scratch/local-pair.mjs ws://127.0.0.1:3080/ws/mobile   # USB 路径
```

- App 的选路是 `candidates.find(wss) ?? candidates[0]`，本机没有 `wss`，所以**由 `publicUrl` 决定**；
  配对请求里必须显式传 `publicUrl`，否则落到网关自己的 loopback 默认值。
- 手机开 WiFi：用 `ws://192.168.1.10:3081/ws/mobile`（PC 的局域网 IP）。
- 手机只有蜂窝 + VPN：局域网到不了，得 `adb reverse tcp:3080 tcp:3080` 走 `ws://127.0.0.1:3080/ws/mobile`。
- 撤销设备：`POST /mgw/devices/<id>/revoke`；查状态 `/mgw/status`、`/mgw/devices`。

**真审批怎么造**——Windows 上组合了 `pwsh-sandbox`，`pwsh` 工具 schema 里**有**
`sandbox_permissions` + `justification`（Linux 宿主没有，那才是死路），所以模型能自己申请升权：

> 用 pwsh 工具把文本 xxx 写进 `C:\Users\example\dsh-sandbox-outside.txt`。工作区之外会被沙箱拦，
> 那就用 sandbox_permissions 加 justification 申请一次升权，我需要看到审批弹窗。

先被沙箱拒一次（`[sandbox: escalation available — retry this exact command once with
sandbox_permissions …]`），下一步就带 `sandbox_permissions: danger-full-access` 重试 → `approval/asked`。
注意这条审批要的是**整块磁盘的访问权**，测试时默认拒绝/撤回，别随手批准。

`.scratch/localgw-approval-probe.mjs` 是不经手机的探针：`node … "<提示词>" [allowed-once|rejected]`，
**不给结论就挂起**（审批留在网关侧等手机拍板，别让脚本自己超时——连接一断网关按「撤回」处理）。

**要把语音输入也弄成和宿主一样**，得补两处（都已在 profile 里配好）：

1. 装 `@deepseek-ai/dsh-experimental-voice-input-bundle@0.1.7-alpha.1`，**并且**在
   `~/.dsh/profiles/web/compatibility.json` 里给它的 4 个包开对 `0.2.1-rc.3` 的版本豁免——
   它们声明的是 `@deepseek-ai/dsh-* ^0.1.7-alpha.1`，不满足 0.2.1-rc.3，不开豁免会被
   「incompatible with dsh」整排禁用（表现就是 `speech-input-v1` 能力消失、App 显示「语音未启用」）。
   豁免文件照抄 dsh-host 的 `/home/dsh/.dsh/profiles/web/compatibility.json` 即可。
2. 识别模型默认从 **`huggingface.co`** 下，国内直连超时（`UND_ERR_CONNECT_TIMEOUT`）。
   在 `cordis.patch.yml` 里把 `speech-to-text-sensevoice` 的 `modelOrigin` 换成 `https://hf-mirror.com`；
   **补丁整块替换 config，`dataRoot` 必须重申**。共 3 个文件约 241 MB
   （`model.int8.onnx` 239 MB + `tokens.txt` + `silero_vad.onnx`），实测镜像 ~1.5 MB/s。

**注意 App 的「语音未启用」文案不等于网关没启用语音**：它是 `hasReadyProvider()` 的结果，
即 `available && 有 ready/standby 的 provider`。模型没下载时 phase 是 `unprepared`，
能力在、目录在，但 App 仍然显示这句。真机上看的是 `speech-catalog` 返回的
`providers[].preparation.phase`（注意 phase 在 `preparation` 底下，不在 provider 顶层）。

## 命令

```bash
npx jest              # 协议层单测（纯函数，秒级）
npx tsc --noEmit
npx expo lint
```

## 测试与验证方式（用户旅程优先）

验证新功能/改动时走**用户旅程**，不做孤立的功能点测试（协议层单测照旧写）：

1. 设想真实场景：用户为什么、在什么状态（离线/后台/有新审批/刚配对……）来用这个功能；
2. 从打开 app 起，写清他经过的点击/手势一步步走到目标（冷启动/配对 → 列表 → 进会话 → 目标操作），
   每一步在真机上实际走一遍；
3. 枚举这个功能上他可能的动作（正常、失败、取消、中途离开），逐个核对预期；
4. 走完「用完继续做什么 → 怎么回到列表/主页 → 怎么退出」，确认没有断头路；
5. 记录心流（是否被打断）、手指动线、操作复杂度；结论按「源码确认 / 真机实测 / 仍是假设」分级。

发现或提建议前先过七问：收益与代价（不做的最坏后果）→ 可证伪性（先写失败用例）→
架构熵增（复用抽象还是新增状态/分支/跨层依赖）→ 爆炸半径（挂掉是崩溃还是优雅降级，会脏数据吗）→
退路与观测（单 commit 可 revert 吗，看什么日志能瞬间验证）→ 心流滤网 → 交互连贯性。

（「心流滤网」= 本项目「漫反射电纸书 + 单手拇指心流 + 零打断」的极简准绳，
出处 `docs/backlog_gemini_reviewd.md` §10；通用方法论与七问原文在全局 CLAUDE.md。）

## 真机调试

- **adb `input tap` 不可靠**：MIUI 上 Modal 内的单点注入经常被系统丢弃（同一坐标连续扫描可能命中一次、单点不中），表现为「按钮点了没反应」。**交互细节不要靠 adb 单点验证**——先用真实手指或看协议帧；只有非交互的视觉/布局可以用截图。
- `adb reverse tcp:8081 tcp:8081` 在 adb server 重启后会丢，重新拉一次再用 `exp://127.0.0.1:8081` 打开。
- **Metro 会 OOM**（node heap 满被系统杀）：日志表现为 bundle 请求全部失效、手机跑缓存 bundle（改了代码但界面不变）。启动时带 `NODE_OPTIONS=--max-old-space-size=8192`；怀疑「改动没生效」时先 `curl 8081/status`。
- **连上手机第一件事：切输入法到小米自带「百度输入法小米版」**——
  `adb shell ime set com.baidu.input_mi/.ImeService`（原「微信输入法」会把 `adb input text`
  截在候选层不落进输入框，真机打字很费劲）。只做 `ime set` 切换；
  **不要 `ime enable/disable`**（会动系统输入法列表，曾坏过输入）。需要输入空格时用设备侧引号：
  `adb shell "input text 'a b c'"`。
- 坐标换算按**原图 1200×2670**：缩略图（780 宽）坐标 × 1200/780 ≈ ×1.54 才是 `input tap/swipe`
  的坐标（按 1080 算会偏 10%，点不中还被误当成 MIUI 丢单点）。
- **单点坐标先像素定位再点**：目测缩略图容易偏几十像素（实测差过 73px）；PIL 找目标区域深色像素
  的 bbox 取圆心最稳，别急着怪 MIUI 丢单点。
- **`adb shell "input text '<中文>'"` 会 NPE**（`java.lang.NullPointerException`，sendText null array）——
  设备侧中文只能手打；探针消息用英文，并避开 `'` 等需转义的字符。
- **快速动效（淡入淡出/收拢/滚动）不能用 1 帧/秒连拍**（本机模型几百 tok/s，整回合可能就 2 秒）。
  用 `adb shell screenrecord` 录（VFR，活跃段源帧可达 100fps+），再
  `ffmpeg -i rec.mp4 -fps_mode passthrough -vf scale=... out/f%04d.png` 全帧抽取后逐帧差分；
  注意 ffmpeg 默认的 CFR 输出会抽稀帧，且 9.x 已移除老参数 `-vsync`（用 `-fps_mode passthrough`）。
- **Git Bash（MSYS）会改写 `/sdcard/...` 参数**：`adb pull /sdcard/x.png`、`screenrecord ... /sdcard/x.mp4`
  会报 “Must specify output file / failed to stat”。解：远程路径放进整条引号内命令
  （`adb shell "screenrecord --time-limit 30 /sdcard/x.mp4"`）或 `MSYS_NO_PATHCONV=1 adb pull ...`。
- `adb input swipe` 会把手势发到**当前前台的任何 App**：设备回归的最后一拍之前先确认
  手机还在测试手上（用户中途拿走用过微信，滑屏落在人家聊天界面里）；发现后就地停手，
  删掉拍到用户隐私的截图。
- **Android 新架构下 LayoutAnimation 默认是死的**：RN 0.88 `enableLayoutAnimationsOnAndroid=false`
  （C++/Kotlin/JS 三处默认一致），`configureNext` 全部静默 no-op；`setLayoutAnimationEnabledExperimental`
  在 Bridgeless 下也是死代码。要动效只能手写 `Animated`（参考 `SessionScreen.tsx` 的 `RowFadeIn`）；
  已知波及 `ThinkPill`/`ActivityGroup`/`ToolGroup`/`TrajectoryView` 的折叠动画（记 BACKLOG，待修）。
  iOS 默认开启，那边照常。
- **录屏的绝对时间不能从状态栏读**（只有分钟精度）：先用服务端事件戳（网关会话
  jsonl 的 `time`）减帧 `pts_time` 反推录屏 t0，再下「几点几分发生了什么」的因果结论——
  曾把 14:52:12 起的录屏当成 14:52:00，误判出一条不存在的「15.5s 发送延迟」。
- **慢回显/不回显的 UI 用假网关 `no-ack` 造**（`docs/tools/fake-gateway.mjs`，
  `curl 'http://127.0.0.1:3999/mode?value=no-ack'`）：消息收下但不回执不回显，真机难复现的慢窗口
  （发送后贴底、待发行呈现、20s 未确认翻转）都能确定性复验；验完切回 `normal` 或停进程。


## 文件上传（file-upload-v1）

`src/transport/file-upload.ts` 实现 open → chunk → finish 三段式，收到 `receiptId` 后
把它放进 `message.files`：

```
{type:'file-upload-open', requestId, sessionId, name, size, sha256}   // name 只能是叶子文件名
{type:'file-upload-chunk', uploadId, offset, data}                    // offset = 已发送的字节数
{type:'file-upload-finish', uploadId}
{type:'message', sessionId, text, files:[{receiptId}]}
```

- 每片长度必须是 4 的倍数；**末片带 `=` 填充**，所以 offset 要用「解码后字节数」累加，
  不能用 `chars/4*3`（会多算 1~2 字节，整条上传被 `file-upload-offset` 拒掉）。
  `decodedBytesOf()` 就是干这个的，已有单测覆盖。
- 上传绑定在创建它的连接上，断线即作废，所以离线时不允许带文件发送。
- 本地限制 24 MB（服务端允许 512 MB）：整份读成 base64 放内存，手机上再大就容易 OOM。

## 连接状态与离线

- **会话页只在没有选中会话时才卸载**。渲染条件用 `active`，不要写成 `connected && active`：
  断线卸载会把历史、草稿、附件、滚动位置一起丢掉，整页还会掉回「配对」页。
- 已经配过网关（`saved`）就别再显示配对页；断线时留在列表页，顶部提示可点一下重连。
- 后台期间 JS 定时器会被系统挂起，`lastFrameAt` 会停在进后台前。回前台时
  `GatewayClient.watchForeground()` 会把基准重置成当前时间并补一个 ping；
  不重置的话心跳第一跳就会把正常连接判成假死（HEARTBEAT_MS=25s，超过两轮没帧即断开）。
- 断线时发的消息进 `outbox`（落盘），重连后 `ready` 回调里按顺序 `flush`；
  带文件的不能离线发，收据绑在连接上。
- 会话列表按网关缓存到 `sessions-<gatewayId>.json`，冷启动先读缓存再连，
  断网时列表不会空成一张二维码。
- **贴底滚动一律不要用 `scrollToEnd`**：它的目标按 JS 侧滞后的内容高度算，真机 trace
  实测落地差 86px——足够把 `atBottom` 判假，跟随链中途断掉、终答停在折线下方（用户报
  「回合结束停在距底约 1/3 屏」的真根因）。贴底统一 `scrollToOffset({ offset: 本次量到的
  真实高度 })`，超出会被原生钳到真底，精度不依赖估算。
- 跟随只在对齐底部时续期（stream start / send 时看 `atBottomRef`）：停在上面的读者
  不许被拽回底部；回合结束（`turn/end`）且贴底时，把「最后一条用户消息」锚到视口第一行
  （折叠胶囊 + 正文随后）。

## 插件管理（plugin-management-v1）

页面在 `src/ui/plugins/`（PluginsView + BundleSheet / InstallFlow / SettingsEditor /
ExemptionsSheet），请求关联与推送在 `usePluginManager.ts`，帧映射在 `src/protocol/plugins.ts`。
全部走 control 连接（`App.tsx` 里的 `control` 客户端）；响应按 requestId 回显关联，不按 kind。

踩过的点：

- 目录分组在客户端做：排除 6 个 `@deepseek-ai/dsh-*` 内置包（`BUILTIN_BUNDLES`），
  `optional && !installed`→官方，`installed || !optional`→已安装。
- bundle 总开关只看 `bundle.enabled`，不要从 `plugins[]` 推；`readOnlyReason` 禁启停，
  `removable:false` 只禁卸载。
- `meta.icon` 是 data URL，当图片渲染；`meta.title/description` 是文本或带 en 回退的语言映射
  （`pickLocalized`）。icon 只接受 `data:image` 开头，别的丢弃防注入。
- `plugin-inspect` 的 refused 是成功帧里 `result.status`，不是 error 帧。
- `ChangeResult.application` 为 `restart-required` 要提示重启 DSH Web 后刷新目录。
- `pendingBuilds` 非空必须让用户批准那些具体包名，再带 `approvedBuilds` 重装，禁止自动批准。
- 安装日志是不可信文本，内存里限行数（`MAX_LOG_LINES=200`）。
- 断线恢复用 `plugin-install-status`（installId=原安装 requestId），不要盲目重装。
- settings 保存带读取时的 `expectedRevision`（乐观锁）；冲突或收到
  `plugin-settings-changed` 推送时重读。secrets 只显 `secrets[].set`，服务端不回明文。
- **关闭/卸载 `dsh-plugin-mobile-gateway` 自身会切断当前连接**——操作前必须提示，
  中断后标「待重连确认」，不能当成功或失败。

踩过的点（详情卡片轮播 PluginCard）：

- **Animated 的 transform 混用驱动会炸掉整条手势链**：同一个 transform 里
  一个节点 spring 用 `useNativeDriver: true`（如入场微弹 scale）、另一个被
  `Animated.event`（useNativeDriver: false）跟手写，native 提升后 JS 写入直接抛
  「moved to native」，且异常被静默吞掉——表现为「手势完全无反应」。解法：同一
  transform 全部 JS 驱动，或干脆删掉装饰动画。红屏出现前先怀疑这个。
- Modal 里 PanResponder 必须挂在**命中视图本体**上：挂在
  `pointerEvents="box-none"` 的容器上时容器不参与命中测试，手势协商不会经过它。
- **切卡手势的正解是 down 冒泡接管**（`onStartShouldSetPanResponder: () => true`）：
  协商从最深 target 冒泡，按钮（Pressable）和条目 ScrollView 更深先拿到 → 正常工作；
  纯文本/空白区没人要 → 卡片接管横滑。两个反面教材：
  capture 阶段 `onStartShouldSet...Capture: true` 会连按钮的 down 一起吃掉（按钮全失效）；
  只靠 `onMoveShouldSet...Capture` 在本 Modal 场景从未被协商到（探针 0 次调用，
  疑似 down 时被隐式 responder 截胡），表现为滑动完全无反应。
- Host 的 `listPlugins` 会返回上百个条目（含内置包内的服务），「独立条目」区
  必须默认折叠，否则目录页被拉到两万 dp 之外。
- 切卡动效（tinder 牌堆，参考 flutter_swiper SwiperLayout.TINDER）：顶层卡平移+倾斜(±10°)+
  边缘淡出、下层卡随揭示进度从 0.92 放大到 1——**全部是 pan.x 的插值**，
  飞出时只驱动 pan.x 一处（timing 到 -900），整套餐杯自动编排；不要再引入
  第二个动画值单独驱动同一 transform。飞出中再触摸，onPanResponderGrant 里按
  pendingTarget 立即提交，防止停在半空。
- **下层卡必须渲染与顶层完全相同的卡面（CardBody）**：只画标题预览的话，
  揭示到落位时内容会跳变（割裂感）；且**按拖动方向只渲染一张下层卡**——
  上一张/下一张两张壳完全重叠时，渲染顺序会让一个方向被另一张盖住，左右观感不统一。
