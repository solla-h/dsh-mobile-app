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
不确定帧名/字段时，先 `npm pack dsh-plugin-mobile-gateway@<版本>` 解开读 `lib/index.mjs`，
不要靠猜。

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
