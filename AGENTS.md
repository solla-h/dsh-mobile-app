This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

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

**源码位置**：`D:\workspace\open_source\dsh-plugin-mobile-gateway`（没 clone 就用
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

## 命令

```bash
npx jest              # 协议层单测（纯函数，秒级）
npx tsc --noEmit
npx expo lint
```

## 真机调试

- `adb reverse tcp:8081 tcp:8081` 在 adb server 重启后会丢，重新拉一次再用 `exp://127.0.0.1:8081` 打开。
- **不要改手机的输入法设置**（`ime enable/disable/set`）。需要输入空格时用设备侧引号：
  `adb shell "input text 'a b c'"`。


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
