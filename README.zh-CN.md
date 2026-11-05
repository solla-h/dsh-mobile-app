# DSH Mobile

一个第三方、开源的 **DeepSeek Harness（DSH）** 手机客户端。它通过
[`dsh-plugin-mobile-gateway`](https://github.com/Clarklevis1995/dsh-plugin-mobile-gateway) 插件，以
`dsh-mobile-v1` WebSocket 协议连接 DSH 宿主。

> **状态：实验性 / 未正式发布。** 目前没有上架应用商店，协议和界面都还在变化。请搭配兼容的网关版本使用，
> 并预期会有破坏性变更。本项目与 DeepSeek、Expo 官方无关。

> [!IMPORTANT]
> **给 DSH Agent / AI Agent：** 如果用户把这个仓库交给你，要求安装或配置手机网关，
> **请先阅读 [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md) 和 [`compatibility.json`](compatibility.json)**
> 并按手册执行。必须使用固定的 gateway/DSH 版本；不要用 `@latest`、本机源码 checkout 或 profile 备份。
> 不要照下面的人类快速开始自行猜，也不要在用户没要求时构建 App。

[English](README.md) · [使用说明](docs/USER-GUIDE.zh-CN.md) · [Agent 安装手册](docs/AGENT-SETUP.md) ·
[版本兼容](docs/COMPATIBILITY.md) · [地址簿设计](docs/rendezvous-design.md)

## 为什么做这个客户端

DSH 的 Web UI 在桌面端很好用。但在手机上，真正需要的不是把桌面页面缩小，而是快速回答三个问题：
**什么在跑、什么在等我、我接下来要说什么。** DSH Mobile 围绕这个循环设计：

- **聚焦优先**：第一屏就是运行中的会话、待处理的审批/提问。
- **单手操作**：底部 Tab、拇指够得到的语音球、不抢注意力的输入框。
- **手机原生链路**：扫码配对、断线重连与离线队列、图片/文件、以及可选的加密地址簿。

## 功能

- **配一次，之后可切换**：扫码或粘贴配对串；可以保存多个网关，在顶部切换。
- **聚焦首页**：运行中的会话、未处理的审批/提问、最近会话，以及一个小的状态宠物。
- **会话**：列表、搜索、新建、重命名、归档、从某条消息分叉，打开来源/子会话。
- **实时对话**：流式文本、思考/工具轨迹分组、Markdown 与代码渲染、复制与文本选择、把用户消息放回输入框
  重新编辑、排队消息、插入当前回合（插话）。
- **人在回路**：审批卡与提问卡，包括离开期间产生的审批；输入框主按钮可直接停止当前回合。
- **附件**：相机/相册图片、带 SHA-256 校验的文件上传（本地限制 24 MB）、文件下载/预览、历史图片卡片。
- **语音输入**：网关有就绪的语音 provider 时，按住说话；转写结果进入输入框或直接发给当前会话。
- **插件与定时任务**：查看网关能力、管理插件和设置、浏览定时任务。
- **连接韧性**：会话列表缓存、草稿、离线发件箱、自动重连，以及前后台安全的心跳。
- **可选地址簿**：网关支持 `rendezvous-v1` 时，Quick Tunnel 或局域网地址变化后，手机可自动找回入口，
  不必重新扫码。Worker 只保存密文。

## 整体结构

```text
┌─────────────────────┐        WebSocket（会话通道）          ┌──────────────────────────────┐
│  DSH Mobile (Expo)  │ ────────────────────────────────────▶ │ dsh-plugin-mobile-gateway    │
│                     │        WebSocket（控制通道）          │  （运行在 DSH Web 内）       │
│  App.tsx 状态机      │ ────────────────────────────────────▶ │                              │
└─────────┬───────────┘                                       └──────────────┬───────────────┘
          │                                                                  │
          │ 可选：GET 加密后的地址                                        │ PUT 加密后的地址
          ▼                                                                  ▼
                              Cloudflare Worker（用户自己的账号）
```

App 只连接网关，不直接使用 DSH 内部的 agent 协议。认证、设备密钥、会话/事件投影，以及可选的地址簿发布，
全部由网关负责。

## 环境要求

- **Node.js 22.13+**（开发用；Expo SDK 58 / React Native 0.88 的要求）。
- 已安装 DSH，并安装 `dsh-plugin-mobile-gateway`。App 使用 `dsh-mobile-v1`。
  本版本已验证的组合是 **DSH `0.2.1-rc.5`** + fork release
  [`v0.12.0-rdv.1`](https://github.com/solla-h/dsh-plugin-mobile-gateway/releases/tag/v0.12.0-rdv.1)；
  安装前先看 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。
- 可选地址簿：网关需要支持 `rendezvous-v1`，并需要一个 Cloudflare 账号来托管 Worker。
  上面的 fork release 已包含地址簿；上游 release 不在本版本的验证组合内。
- 扫码配对需要相机权限；语音输入需要麦克风权限。

## 给 DSH Agent 的说明

如果用户把这个仓库交给你，要求安装或配置手机网关，**不要照下面的人类快速开始自行猜**。
请阅读 [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md)，并且只运行：

```bash
node scripts/setup-gateway.mjs check
```

`install` 和 `voice` 交给用户在停掉 DSH Web 的普通终端里执行；脚本在 3080 被监听时会拒绝安装。
不要直接运行 `dsh plugin add`、不要改 profile、不要用本机 checkout。`enable`/`pair` 是安全的；
`pair` 只生成本地二维码页，不打印配对载荷。

版本绑定在 [`compatibility.json`](compatibility.json)：只用里面的 `recommended` 版本，不要用 `@latest`
或本机 checkout。任务是网关，不是构建/测试 App；真实用户已经装好 APK。

手册里还有一段可以直接交给用户的中文提示词，以及所有必须停下来等人工确认的节点
（sudo、停止/重启 DSH Web、公网隧道、Cloudflare 登录）。

## 快速开始（终端用户）

### 1. 安装网关插件

在运行 DSH 的机器上，从本仓库运行。先停掉 DSH Web——往运行中的 Web 进程里装 bundle 会热重载插件树，
可能让 `sessionController` 一直不可用，直到整个进程重启：

```bash
# Linux systemd
sudo systemctl stop dsh-web
# 或者 Ctrl+C 掉正在运行 `dsh web` 的终端

node scripts/setup-gateway.mjs install --yes
```

脚本会安装 [`compatibility.json`](compatibility.json) 里的固定 tag，3080 在监听时直接拒绝，并重新跑检查。
不要用 `@latest` 或 Web 插件面板；详见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。

可选语音：DSH Web 仍停着时运行 `node scripts/setup-gateway.mjs voice --yes`。它会安装与
`0.2.1-rc.5` 匹配的语音 bundle，并预下载约 241 MB 的 SenseVoice 模型；模型 ready 之前 App 会显示
「语音未启用」。不要在 DSH `0.2.1-rc.5` 上装旧的 `0.1.7-alpha.1`。

用你平时的方式启动 DSH Web，然后：

```bash
node scripts/setup-gateway.mjs check
```

### 2. 启用网关并生成配对码

```bash
node scripts/setup-gateway.mjs enable
node scripts/setup-gateway.mjs pair --open
```

也可以打开 DSH Web → **移动设备 → 连接与配对**。脚本会写一个本地二维码页；配对码一次性、五分钟有效。

如果 Web UI 说 Quick Tunnel 公网入口未通过验证、但隧道日志显示 online，可能是宿主本机 DNS 被污染，
隧道本身仍然可用。用 `pair` 生成配对页；如果手机也解析不了域名，就在手机上开 VPN 或 Private DNS
（DoH），或者改用 Tailscale / 命名 Tunnel。App 会拒绝公网地址的明文 `ws://`，这是有意设计。

### 3. 安装 App

目前没有应用商店版本。请从本仓库构建 preview APK（见[构建](#构建)），或使用本地开发构建。
安装后打开 App，允许相机，扫描二维码。相机不可用时，可以退回手动粘贴配对串。

配对载荷默认只有五分钟有效期，且包含设备 token。请像对待密码一样对待二维码。

### 4. 使用

- **聚焦**：显示正在运行的会话和等待你处理的事项。
- **全部会话**：所有会话；点进去就是对话页。
- **定时任务**、**插件**：网关的定时任务和插件管理界面。
- 点顶部网关名可以添加、切换、移除网关。
- 审批和提问会出现在对话页，也会出现在聚焦页；在那里处理即可。
- 输入框支持文字、图片、文件、排队、插话和停止。
- 连接断开时，App 保留缓存的会话和草稿并在后台重试；离线期间写的文字会进入发件箱，联网后补发；
  文件上传必须在线。

完整流程和故障排查见[使用说明](docs/USER-GUIDE.zh-CN.md)。

## 地址簿（可选）

地址簿只解决一个具体问题：网关的 Quick Tunnel 地址（或局域网 IP）变了，已经配对的手机连不上。
启用 `rendezvous-v1` 后：

1. 在网关面板打开 **地址簿**，点击启用。
2. 插件通过 `wrangler login --device` 让你登录 Cloudflare，然后自动部署 Worker，写密钥保存在本机。
   你只需要完成 Cloudflare 授权，不需要手动部署 Worker。
3. 每个配对设备会通过已认证连接获得一份设备密钥。网关用 AES-256-GCM 加密当前入口；Worker 只保存密文。
4. App 连不上旧地址时，会从 Worker 取回最新密文，解密后重试新地址。通常一到三分钟内恢复，不是瞬时切换。

Worker 属于你自己的 Cloudflare 账号。Cloudflare 能看到请求元数据（路径、IP、时间、密文长度），
但看不到入口地址和密钥。详见[地址簿设计](docs/rendezvous-design.md)。

一个 Worker 对应一个网关。如果多台机器都运行 DSH，请分别配对；每台网关可以使用自己的地址簿。
地址簿只负责它所属的网关，不会把多台 DSH 宿主合并成一次配对。

地址簿不是核心功能的必要条件；没有它，公网地址变化后仍需要重新扫码。

## 构建

### 用 EAS 构建 preview APK（推荐）

```bash
git clone https://github.com/solla-h/dsh-mobile-app.git
cd dsh-mobile-app
npm install
npx eas-cli login
npx eas-cli init --account <your-expo-account>
npx eas-cli build --platform android --profile preview
```

- `preview` 生成可安装的 APK，Android 签名由 EAS 托管。
- `preview-local` 使用本地的 `credentials.json` 和 keystore，适合不想把签名材料交给 EAS 的维护者。
  `credentials.json` 和 `*.jks` 已在 `.gitignore` 中。
- iOS 使用 `--platform ios --profile preview`，需要 Apple 开发者账号和描述文件。

`app.json` 里的 EAS 项目绑定在维护者的 Expo 账号下。如果你 fork 了仓库，先运行
`npx eas-cli init --account <your-account> --force` 绑定自己的项目再构建。

### 本地原生构建

`android/` 和 `ios/` 由 Expo Continuous Native Generation 生成，不提交到仓库。

```bash
npm install
npx expo run:android   # 需要 JDK 17+ 和 Android SDK；构建 debug 包
```

本地 release APK 需要自行配置 keystore 和 Gradle；本仓库支持的主路径是 EAS。

### 开发

```bash
npm install
npx expo start        # Expo Go / 开发构建
npm test              # Jest：协议与传输层
npm run typecheck     # tsc --noEmit
npm run lint          # expo lint
npx expo-doctor       # 依赖与配置检查
```

Expo Go 适合调 UI，但相机、安全存储、音频、后台重连等原生行为，应在开发构建或 preview 构建里验证。

## 项目结构

| 路径 | 职责 |
| --- | --- |
| `App.tsx` | 顶层状态机：配对 → 网关列表 → 会话；全局待办/离线状态 |
| `src/protocol/` | `dsh-mobile-v1` 帧的纯函数解析与映射；不 import `react-native` |
| `src/transport/` | WebSocket 客户端、连接策略、历史缓存、发件箱、文件传输、地址簿刷新 |
| `src/storage/` | SecureStore（网关 token/设备身份）与文件缓存 |
| `src/ui/` | 屏幕与组件；没有 Expo Router，导航由状态驱动 |
| `docs/` | 使用说明、地址簿设计、内部工作记录 |

App **刻意不使用 Expo Router**：路由会在一套网关/会话状态机之外再引入一套导航状态。屏幕由
`App.tsx` 根据状态直接渲染。非路由代码不要堆进 `App.tsx`，协议逻辑保持在 `src/protocol/`。

## 安全与隐私

- 配对 token 与设备身份存放在 `expo-secure-store`，不写明文文件。
- 公网入口必须使用 `wss://`；明文 `ws://` 只接受私有/局域网地址。
- 会话历史、草稿和附件元数据会缓存在本机，以便离线使用。在网关面板撤销设备后，token 立即失效，
  App 会停止重连并要求重新配对。
- App 代码没有接入第三方分析 SDK。网关和 Expo 运行时仍可能产生各自的日志，请分别查看对应项目。
- 地址簿内容在网关与每台手机之间端到端加密；Worker 只持有密文和元数据。

不要在公开 issue 里贴配对二维码、网关写密钥或设备 token。截图前请遮掉主机名和账号 ID。

## 已知限制

- 没有应用商店版本，目前需要侧载 APK 或开发构建。
- 协议仍在演进。请让 App 与网关版本匹配；旧网关可能没有新能力。
- 地址簿依赖 Cloudflare 和支持 `rendezvous-v1` 的网关构建；恢复需要一到三分钟，且依赖 Worker 可达。
  中国大陆部分网络可能受 `workers.dev` DNS 污染影响，可改用自定义域名或 VPN/DoH。
- Quick Tunnel 是尽力而为的服务，没有可用性保证。
- iOS 构建需要 Apple 开发者账号；Windows 无法本地构建 iOS。

## 参与贡献

欢迎提 issue 和 PR。提交 PR 前：

1. 协议改动放在 `src/protocol/`，保持纯函数并补测试。
2. 运行 `npm test`、`npm run typecheck`、`npm run lint`、`npx expo-doctor`。
3. 不要手改生成的 `android/`、`ios/`；原生行为改 `app.json` 或 config plugin。
4. 如果改了配对、重连或地址簿行为，同步更新使用说明和地址簿设计文档。

## 许可证

MIT，见 [LICENSE](LICENSE)。
