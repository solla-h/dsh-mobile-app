# 地址簿（Rendezvous）工程参考

> 范围：**App 侧实现契约**，对照 [compatibility.json](../compatibility.json) 里 pin 的网关版本（`0.12.0-rdv.3`，协议 v3）；
> 部署与运维见 [USER-GUIDE.zh-CN.md](USER-GUIDE.zh-CN.md) §9（[English](USER-GUIDE.md)）。网关内部实现以该版本发布物为准——
> 不要用本地 checkout 推断在装服务端行为。加解密、迁移、刷新契约均源码/单测确认；端到端结论以 [COMPATIBILITY.md](COMPATIBILITY.md) verified 条目为准。

## 1. 目的与边界

手机配对一次后，网关地址（Quick Tunnel URL、局域网 IP）变了也不用重扫：网关把当前入口列表**加密**后
发布到用户自己的 Cloudflare Worker，手机连不上时去读、解密、换址、重连。

已确认边界：

- 恢复不是秒级（通常 1–3 分钟）；Quick Tunnel 无可用性保证，地址簿只解决「换址后找回」。
- 手机必须先在新版本下连上过一次才会拿到设备 key；此前地址全失效只能重扫。
- bearer token 先于服务端证明发出（沿用现有协议）；本功能不新增也不放大该缺口。
- 内容零知识 ≠ 元数据零知识：Cloudflare 能看到路径、IP、时间、密文长度。
- 默认关闭；网关未配置时 App 不请求、不改行为。

## 2. 部署方式（网关面板托管）

地址簿由网关面板托管，手机侧零操作、无设置页；独立 Worker 仓库、手动 `wrangler` 部署与手写 Worker 代码
均已作废，不要照旧文档操作。流程以 [USER-GUIDE.zh-CN.md](USER-GUIDE.zh-CN.md) §9 为准：

- 启用：DSH Web → **移动设备 → 连接与配对 → 地址簿** → 启用 → 完成 Cloudflare 设备登录；
  插件自行部署 Worker（`npx wrangler`），写密钥留在宿主，面板显示部署日志与 Worker 地址。
- 使用已有 Worker：填地址 + 写密钥（手动↔托管切换时手机在已认证连接上自动采纳，§5）；停用会停止发布，可同时删除 Worker（不可恢复），不删则保留写密钥、重新启用复用。
- 一个 Worker 对应一个网关；`workers.dev` 不可达时改用自定义域名或命名 Tunnel（后者地址固定，不需要地址簿）。

## 3. 安全契约

- 内容恒加密：AES-256-GCM，Worker 只存不透明密文；每设备独立随机 key，撤销粒度 = 设备。
- 写密钥只留在宿主，读取只靠 256 位路径能力；写密钥**永不下发手机**，不出现在日志/帧里。
- 配置只经**已认证连接**下发：仅在启用时、对已认证设备追加 `rendezvous-v1` 能力位。
- `gatewayId` 是网关身份：同一 `gatewayId` 的 url/key 变化按迁移采纳；`gatewayId` 变化 = 冲突，保留原配置。
- `rev` 只保证「相对本机已见版本不回退」，**不提供防重放承诺**（§4.4）。

## 4. 密码学与 blob 格式（App ↔ 网关必须逐字节一致）

App 侧实现见 [../src/protocol/rendezvous.ts](../src/protocol/rendezvous.ts)（纯函数）。

### 4.1 派生与信封

- `key`：32 随机字节，base64url 无填充 = 43 字符。
- `pathKey = HKDF-SHA256(ikm=key, salt=空, info="dsh-rendezvous-path-v1", L=32)`；`path = base64url(pathKey)`。
- `aesKey = HKDF-SHA256(ikm=key, salt=空, info="dsh-rendezvous-blob-v1", L=32)`。
- 加密：每次发布新随机 `nonce`（12B，绝不复用）；AES-256-GCM；tag 16B；**AAD = utf8(path)**。
- `envelope = 0x01 ‖ nonce(12) ‖ ciphertext ‖ tag(16)`；`body = base64url(envelope)`，无填充。

### 4.2 互操作测试向量（加密层）

[protocol 测试](../src/protocol/__tests__/rendezvous.test.ts) 用这条向量做解密断言（明文里的未知字段 `ts`/`name` 必须忽略）：

```
key(hex)   = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
nonce(hex) = 000102030405060708090a0b
path       = EhVmqRM6hY4xZwkqg2KgsMtamzQX33K2rJdB8RgfnY8
aesKey     = 2b614eec74828fcad0771ca475138a77163ec47d6cd4a5de0ff625ed48e32e7d
plaintext  = {"v":1,"rev":7,"ts":1762000000000,"gatewayId":"3f1b9c2e-7d4a-4b8f-9c1d-2e5a6b7c8d9f","name":"Test Gateway","endpoints":["wss://abc.trycloudflare.com/ws/mobile","ws://192.168.1.10:3081/ws/mobile"]}   (196 字节)
tag(hex)   = 0a67679437a5bbb039b2159682791084
body       = 300 字符，见测试里的 VECTOR_BODY
```

### 4.3 blob 明文

```json
{"v":1,"rev":1762000000123,"gatewayId":"<uuid>","endpoints":["wss://…","ws://192.168.1.10:3081/ws/mobile"]}
```

- `rev`：发布侧保证单调（`max(上次+1, 墙钟毫秒)`）；客户端只校验 `rev > seenRev`（§4.4）。
- 客户端接受 `endpoints` 1–16 项、每项 ≤2048 字符，`body` ≤ **8192** 字符；不放 `name`/`ts`；发布节奏与超限截断属网关实现（以 pin 版本为准）。

### 4.4 客户端校验规则（`decodeAddressBook`，任何一步失败 = 视为无数据，静默回退）

1. `body` 长度 24–8192，规范 base64url（解码后重编码必须与原文相等）。
2. `envelope` 首字节 `0x01`，长度 ≥ `1+12+16+2`。
3. 本地派生 `aesKey`，AAD=`utf8(本地派生 path)`，GCM 解密。
4. JSON：`v === 1`；`rev` 为正安全整数且 ≤ 本机时间 + 7 天；`gatewayId` 严格等于本地记录的；
   `endpoints` 1–16 项、每项非空 ≤2048（不合格整帧拒绝）。
5. `endpoints` 逐项过 `isPairingUrlAllowed`（[pairing.ts](../src/protocol/pairing.ts)，SEC-1）并去重；空 = 失败。
6. `rev > seenRev`（缺省 0）。

> 只防「相对本机不回退」：首次读取可能接受真但过期的记录，后果是试一次旧地址，下一轮被新记录取代；不要宣称「防重放」。

## 5. 配置领取与迁移契约

- 请求 `{type:'rendezvous-config', requestId}`：App 在 control 连接收到已认证且含 `rendezvous-v1` 的 `hello` 后发一次；
  `error` 帧（`rendezvous/disabled` 等）直接忽略，不影响连接与待办。
- 响应/推送 `{kind:'rendezvous-config', url, key, gatewayId}`：**不带 `requestId` 的主动推送同样采纳**（网关配置变化时推送）；
  带 `requestId` 的只认自己刚发出的那一次（`matchesRendezvousRequest`）。
- 采纳决策（[rendezvous.ts](../src/protocol/rendezvous.ts) `decideAdoption`/`applyAdoption`）：

| 本地状态 | 收到的配置 | 结果 | 动作 |
| --- | --- | --- | --- |
| 无 | 合法 | `adopt` | 保存，`seenRev` 留空 |
| 有 | `gatewayId` 与配对记录/本地不符 | `conflict` | 整帧丢弃，只留内存提示（§7.4） |
| 有 | `url` 变、`gatewayId` 相同 | `migrate` | 更新 url/key，**清空 `seenRev`**（新 Worker 是新 rev 作用域） |
| 有 | `key` 变、`url` 相同 | `rotate-key` | 更新 key，**清空 `seenRev`** |
| 有 | 全相同 | `same` | 不动 |

- 不能用「url 不同」拒绝（手动↔托管、停用再启用、部署重试都会换 Worker，拒绝等于逼回重扫）；重新配对会整条替换记录、清掉旧 `rendezvous`——有意为之，同一 `gatewayId` 的迁移不需要重扫。

## 6. 刷新与恢复（`GatewayClient` 契约）

- `ConnectOptions.refreshUrl?: () => Promise<string | undefined>`；session 与 control 都挂 `refresher(gateway.id)`（无配置时 no-op）。
- 触发（全部满足）：连续第 2 次失败起、在线、距上次刷新尝试 ≥ 60s、无在途刷新、未停止；
  `4003/4004` 已 `stopped`，天然不触发（[connection-policy.ts](../src/transport/connection-policy.ts)、
  [gateway-client.ts](../src/transport/gateway-client.ts)）。
- 新 URL → 换 `options.url`、清退避、`attempt=0`、立即重连；`undefined`/相同 URL → 不动；期间 `connect()` 换了
  options → 结果丢弃。
- 两条连接各自刷新：先完成的写存储；后一条无新记录时返回**当前保存的 URL**（与现值相同即 no-op），
  避免卡在旧地址直到网关下次发布。

## 7. App 实现契约

### 7.1 存储（[gateway-store.ts](../src/storage/gateway-store.ts)）

- `SavedGateway.rendezvous?: { url, key, gatewayId, seenRev? }`；冷启动读回仍在（非法配置归一化时丢弃）。
- `patchGatewayIfExists`：锁内重读合并，**不新建、不改 `ACTIVE_KEY`**；写失败不推进 `seenRev`。

### 7.2 纯函数（[rendezvous.ts](../src/protocol/rendezvous.ts)）

`deriveLocator`、`normalizeWorkerUrl`（https、无 userinfo、path 仅 `/`、无 query/hash、非 IP/localhost）、`parseRendezvousConfigFrame`、
`pickGatewayUrl`（第一个 `wss://`，否则第一项）、`decideAdoption`/`applyAdoption`、`decodeAddressBook`、`matchesRendezvousRequest`。

### 7.3 接线（`App.tsx`）

control `hello`（已认证 + capability）→ 发请求；`adoptRendezvousConfig` 处理响应与推送，写回走
`patchGatewayIfExists`。**不要**在 `onState` 里做地址簿逻辑；配对/`paired` 流程一行不改。

### 7.4 冲突的唯一提示

内存 `Set`（不持久化），网关菜单一行灰字「网关身份已变化，重新扫码后可恢复自动找回」；不弹窗、不断连；
重新配对后记录整条替换，下次连接自然 `adopt`，提示消失。

### 7.5 网络与刷新（[transport/rendezvous.ts](../src/transport/rendezvous.ts)）

- `fetchAddressBook`：`GET {url}/r/{path}`，5s 超时，`credentials:'omit'`；非 200 → null；读完再检查 ≤8192 字符
  （**读后丢弃，不是接收上限**）。
- RN 的 whatwg-fetch 不支持 `redirect:'error'`，`cache:'no-store'` 只是追加时间戳；响应体在 resolve 前
  已完整缓冲。因此这里不保证禁止重定向，也不提供网络层接收大小上限。
- `createUrlRefresher`：按 `gatewayId` 单飞；调用时读 `savedRef`，每个 `await` 后核对 `{id,key}`，不满足即丢弃；
  `url`/`endpoints`/`seenRev` 同一次 patch 写入；失败安静返回，不抛给调用方。

## 8. 测试（动这里之前先跑）

- [protocol/__tests__/rendezvous.test.ts](../src/protocol/__tests__/rendezvous.test.ts)：向量解密；规范 base64url、篡改、错 key、
  gatewayId 不符、rev 未推进/领先 7 天、SEC-1 过滤后为空等负例；决策表；URL 规范化；`pickGatewayUrl`。
- [transport/__tests__/rendezvous.test.ts](../src/transport/__tests__/rendezvous.test.ts)：`patchGatewayIfExists` 不新建不激活、
  并发不丢字段、迟到 patch 不复活；配置与 `seenRev` 冷启动持久化；单飞；身份变化丢弃；写失败不推进 `seenRev`。
- [gateway-client-refresh.test.ts](../src/transport/__tests__/gateway-client-refresh.test.ts)：第 2 次失败才触发、冷却、4003
  不触发、options 更换丢弃、相同/`undefined` URL 不额外重连。

## 9. 已知限制

- 未在新版本下连上过 → 拿不到 key、地址全失效只能重扫；首次读取可能接受真但过期的记录，不宣称防重放（§4.4）。
- 网关时钟被拨到未来再改回后，手机会拒绝较小的 `rev`（`rotate-key`/重新配对可恢复）；只选一个入口（第一个 wss，否则第一项），不做多候选轮换。
- Worker 记录被删/丢失时只能等网关下次发布后自愈；其地址与访问元数据对 Cloudflare 可见（`workers.dev` 不可达需换域名/命名 Tunnel）。
- `gatewayId` 变化 = 一行灰字 + 需要重新扫码；不静默连到另一台网关。
