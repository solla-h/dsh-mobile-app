# 地址簿（Rendezvous）设计与实现要点

> 状态：**已实现并完成真机/真 Worker 验证**（2026-11-04）。最终形态是 Worker 源码随
> `dsh-plugin-mobile-gateway` 一起安装、由面板托管部署；§5 中「新建独立仓库 / 手动 `wrangler`」的描述
> 仅作早期方案参考。
> 涉及两处代码：本仓库（App）与 `dsh-plugin-mobile-gateway`（网关插件，第三方开源，协议 `dsh-mobile-v1`）。

## 0. 一句话

手机配对一次后，网关的地址（Quick Tunnel 地址、局域网 IP）变了也不用重扫：网关把当前地址**加密**后发布到用户**自己的** Cloudflare Worker，
手机连不上时去读、解密、换址、重连。

## 1. 要解决的问题与取舍结论

现状：Quick Tunnel 重启后 URL 必变，换网络后局域网 IP 也变。App 配对时快照了一个 `url`，之后只会重连这个 URL，
失效后唯一出路是重新扫码。

### 1.1 设计决策（已拍板，附理由）

| # | 决策 | 为什么这样选 |
|---|---|---|
| D1 | **手机上零操作、零设置页**。成功恢复时静默；只在一种异常情况给一行灰字提示（§7.4） | 项目准绳是「零打断」。用户只做一件事：在电脑上部署 Worker 并粘贴两行配置 |
| D2 | **配置通过已认证连接按需领取**（新增能力位 `rendezvous-v1` + 一对请求/响应帧），**不改二维码、不改 `paired`、不改 `hello` 的既有字段** | ① 老设备不用重扫；② 二维码过期后截图不会留下长期读取能力；③ 严格解析配对载荷的下游不受影响；④ 沿用 `speech-input-v1` 的「仅对已认证设备下发」先例 |
| D3 | **每设备一把独立随机 key，网关第一次被请求时才生成**，存在设备记录里 | 老设备免迁移；撤销粒度 = 设备；不复用 token 摘要（摘要是鉴权校验值，不该兼任加密根） |
| D4 | **内容恒加密**（AES-256-GCM），Worker 只存不透明密文 | 用户不承担「云上明文地址」风险 |
| D5 | **写入需要网关专用写密钥**（Worker 的 `WRITE_SECRET`）；读取只靠 256 位路径 | 防止知道 Worker 域名的人无限创建记录、耗尽免费额度。写密钥**永不下发手机** |
| D6 | **同一 `gatewayId` 下自动迁移，换 `gatewayId` 才拒绝**（§7.3 决策表）。URL 变化来自已认证连接，不重新配对 | 防止被冒充的网关给手机塞伪造入口；同时消除手动→托管/停用再启用/重试部署的死锁 |
| D7 | **重连与换址由 `GatewayClient` 自己负责**（新增 `refreshUrl` 回调），不在 `App.tsx` 的 `onState` 里另开恢复流程 | 竞态、不可重试错误（4003）、一次性配对码这些判断本来就在 `scheduleReconnect` 里，放这里天然正确 |
| D8 | **`rev` 取墙钟毫秒并保证单调**：`rev = max(上次rev+1, Date.now())`，无需持久化计数器 | 崩溃/状态文件丢失后序号不会倒退；省掉「先落盘再发布」 |
| D9 | **清理采用 best-effort**：撤销设备 → 停止发布 + 删一次，不做持久清理队列 | 残留物是一条约 300 字节、无人能解的密文；为它建队列得不偿失 |
| D10 | 默认关闭；未配置 `rendezvousUrl` 时网关行为与今天**逐字节一致** | 向后兼容 |

### 1.2 明确不做（别顺手加）

- 不改二维码载荷、不改 `paired` 帧、不改 `hello` 已有字段（只往 `capabilities` 数组里**条件性追加**一个字符串）。
- 不做「未信任端点前的摘要派生引导」。
- 不做多候选地址轮换/failover（`endpoints` 目前存了但没人读，保持现状；本功能只选**一个** URL：第一个 `wss://`，否则第一项，与配对时规则相同）。
- 不做持久清理队列、不做 WebUI 卡片（只在 `/mgw/status` 里加摘要）。
- 不做 Tailscale Funnel / 对象存储等替代后端。
- 不做心跳以外的新定时器体系：网关复用一个 60s 轮询。

### 1.3 已接受的边界（用户确认）

- 手机必须**在新版本下成功连上过一次**才会拿到配置；如果在此之前网关地址已全部失效，只能重扫（密码学解决不了「不知道服务器在哪」）。
- Quick Tunnel 本身没有可用性保证，地址簿只解决「换址后找回」。
- 信任模型沿用现有协议：bearer token 在 WebSocket upgrade 头里先于服务端证明发出，**本方案不新增也不放大这个缺口**。
- 恢复延迟不是秒级：最坏约 `60s（发布轮询）+ 60s（手机刷新冷却）+ 退避` ≈ 2~3 分钟。文档/提示不得承诺即时。
- 内容零知识 ≠ 元数据零知识：Cloudflare 能看到路径、IP、访问时间、密文长度。

## 2. 用户体验（先读这一节再读实现）

### 2.1 电脑侧（一次性，约 2 分钟）

```
git clone <dsh-mobile-rendezvous> && cd dsh-mobile-rendezvous
npm install
npm run setup        # 登录 Cloudflare（如未登录）→ 生成写密钥 → 部署 Worker → 打印下面两行
```

`setup` 输出（可直接粘贴）：

```yaml
# 加到 dsh-plugin-mobile-gateway 的 config 里，然后重启 dsh web
rendezvousUrl: https://dsh-rendezvous.<账号>.workers.dev
rendezvousWriteSecret: <随机串>
```

### 2.2 手机侧

- **新用户**：照旧扫码。连上后 App 自动领取配置，用户看不到任何变化。
- **已配对的老用户**：升级 App，下次连上网关（网关也升级并配置了地址簿）就自动启用，**不用重扫**。
- **之后**：隧道重启/换网后连不上，App 在后台自动读地址簿换址重连，用户只看到原有的「重连中」横幅消失。
- **唯一的提示**：见 §7.4（地址簿被换了，需要重扫）。

### 2.3 为什么不更简单了

再简单只剩两条路：把 key 塞进二维码（过期截图变成长期读取能力，且旧用户必须重扫），
或者让手机什么都不存（那就没有「找回」能力）。当前方案手机只多存一份配置、多发一个请求，是最小集。

## 3. 总体架构

```
网关插件                          用户的 Cloudflare Worker             手机 App
   |  ① 每 60s / 地址变化 / 新 key        |                              |
   |  PUT /r/<path>  Bearer WRITE_SECRET  |                              |
   |  body = AES-GCM(地址列表)  --------> |  存 path→密文 (Durable Object)|
   |                                      |                              |
   |  ② 手机已认证连接上请求配置                                          |
   | <----- {type:'rendezvous-config'} ---------------------------------|
   | ------ {kind:'rendezvous-config', url, key, gatewayId} ----------> |  保存
   |                                      |                              |
   |  ③ 之后连不上网关时                                                  |
   |                                      | <--- GET /r/<path> ---------- |
   |                                      | ---- 密文 ------------------> |  解密→换 URL→重连
```

## 4. 密码学与 blob 格式（网关与 App 必须逐字节一致）

### 4.1 派生

- `key`：32 个随机字节，base64url 无填充 = **43 字符**（网关生成，只发给持有它的那台设备）。
- `pathKey = HKDF-SHA256(ikm=key字节, salt=空, info=utf8("dsh-rendezvous-path-v1"), L=32)`；`path = base64url(pathKey)`（43 字符）。
- `aesKey  = HKDF-SHA256(ikm=key字节, salt=空, info=utf8("dsh-rendezvous-blob-v1"), L=32)`。
- 加密：`nonce` = 12 个新随机字节（每次发布都重新生成，绝不复用）；AES-256-GCM；tag 16 字节；**AAD = utf8(path)**。
- `envelope = 0x01 ‖ nonce(12) ‖ ciphertext ‖ tag(16)`；`body = base64url(envelope)`，无填充。

### 4.2 测试向量（加密层；明文内容对加密层是任意字节）

```
key(hex)   = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
nonce(hex) = 000102030405060708090a0b
pathKey    = 121566a9133a858e3167092a8362a0b0cb5a9b3417df72b6ac9741f1181f9d8f
path       = EhVmqRM6hY4xZwkqg2KgsMtamzQX33K2rJdB8RgfnY8
aesKey     = 2b614eec74828fcad0771ca475138a77163ec47d6cd4a5de0ff625ed48e32e7d
plaintext  = {"v":1,"rev":7,"ts":1762000000000,"gatewayId":"3f1b9c2e-7d4a-4b8f-9c1d-2e5a6b7c8d9f","name":"Test Gateway","endpoints":["wss://abc.trycloudflare.com/ws/mobile","ws://192.168.1.10:3081/ws/mobile"]}   (197 字节)
tag(hex)   = 5216c00d8c4f51bc96b5ebdf6536933c
body (302 字符) =
AQABAgMEBQYHCAkKC2o9ixs6CrlWNdCqYJujnipSZYB1j0sz5t82XX8Su-FrC8YpOXSsYbkM3N3BIpt2ZwvLEVXkIpzzvJ24ZQ5T2JZG2t4cRP9us4GHPDYsBOOtYbTmzqr7IXRB2LlrK06nw9AhZRfAxXldWIyzgLXGPvFW9siaH6kXprVGGwInS0hXLir8cFeF3KwcisSqb5u6eWz2OgMcOfJoK-g6vMXekd1Hc5vSloBXbyj9acQOIKZfietXgjZjt9q0ZkibAIitqDB_j_pBUhbADYxPUbyWtevfZTaTPA
```

用法：
- App 单测：用 `@noble` 解这条 `body` 得到上面的明文；该明文里多出的 `ts`/`name` 字段必须被**忽略**（说明未知字段容忍）。
- 网关单测：用固定 key+nonce 加密同一明文，必须产出同一 `body`；用换过的 path 作 AAD 或空 AAD 解密必须失败。
- 反向向量（实现时自行生成并写进测试）：篡改首字节、错 key、截断、超长、非规范 base64url、tag 被改。

### 4.3 blob 明文（发布时）

```json
{"v":1,"rev":1762000000123,"gatewayId":"<uuid>","endpoints":["wss://…","ws://192.168.1.10:3081/ws/mobile"]}
```

- `rev`：`max(上次发布的 rev + 1, Date.now())`（整数，毫秒级）。仅内存保存上次值，**不落盘**。
- `endpoints`：直接取网关 `advertisedEndpoints()` 的当前快照（1~16 项，每项 ≤2048 字符）。
- 尺寸：`body` ≤ **8192** 字符（⇔ envelope ≤ 6144 字节 ⇔ 明文 ≤ 6115 字节）。超限时发布器**从末尾逐项丢弃 endpoints** 直到放得下，并在 `lastError` 记录。现实用量约 200 字节。
- 不放 `name`、`ts`（用不上，也少泄漏）。

### 4.4 手机端校验规则（按顺序，任何一步失败 = 视为「没有数据」，静默回退）

1. `body` 长度 ≤ 8192，且是**规范** base64url（解码后再编码必须与原文相等）。
2. envelope 长度 ≥ `1+12+16+2`，且 `envelope[0] === 0x01`。
3. 用本地派生的 `aesKey`、AAD=`utf8(本地派生的 path)` 做 GCM 解密。
4. `JSON.parse`；要求 `v === 1`；`rev` 是正安全整数且 `rev ≤ 手机当前时间 + 7 天`（防止网关时钟错乱后永久卡死）；
   `gatewayId` 严格等于本地保存的 `rendezvous.gatewayId`；`endpoints` 是 1~16 个字符串。
5. `endpoints` 逐项过现有的 `isPairingUrlAllowed`（`src/protocol/pairing.ts`，SEC-1 安全门）并去重；过滤后为空 = 失败。
6. `rev > rendezvous.seenRev`（`seenRev` 缺省视为 0）。

> 诚实边界：`rev` 只提供「相对本机已见版本不回退」。第一次读取时拿到一份真实但过期的旧记录仍会被接受，
> 后果只是尝试一个已失效的旧地址，会自然失败并在下一轮刷新时被新记录取代。不要在文档或 UI 里宣称「防重放」。

## 5. Worker（新仓库 `dsh-mobile-rendezvous`）

目标：约 100 行，只存不透明密文，不持有任何内容密钥。

### 5.1 HTTP 接口

| 方法 | 路径 | 鉴权 | 行为 |
|---|---|---|---|
| `GET` | `/r/<path>` | 无（路径即能力） | 200 `text/plain` 返回 body；没有则 404 |
| `PUT` | `/r/<path>` | `Authorization: Bearer <WRITE_SECRET>` | 204；覆盖写 |
| `DELETE` | `/r/<path>` | 同上 | 204，幂等 |
| `GET` | `/` | 无 | 一行说明文本 |

- `<path>` 必须匹配 `^[A-Za-z0-9_-]{43}$`，否则 404（不泄漏路由信息）。
- `PUT` body 必须匹配 `^[A-Za-z0-9_-]{16,8192}$`；**流式读取并累计字节上限 8192**，超限立刻 413（不要信 `Content-Length`）。
- 记录总数上限 **64**：新增 path 且已满 → 507。写密钥泄漏时也只能占 64 条。
- 响应统一带 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`。**不记录 path/body 到日志**。
- 写密钥比较用常数时间（见下方参考实现）；缺失/错误 → 401。

### 5.2 存储

单个 Durable Object 实例（SQLite 后端，Free 计划可用），键 = path，值 = body 字符串。
用 `ctx.storage` 的 KV 接口即可：`get / put / delete / list({limit})`。个人规模一个 DO 足够，不要为每个 path 建一个 DO。

### 5.3 参考实现

`wrangler.toml`：

```toml
name = "dsh-rendezvous"
main = "src/index.js"
compatibility_date = "2025-01-01"

[[durable_objects.bindings]]
name = "BOOK"
class_name = "Book"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Book"]
```

`src/index.js`：

```js
import { DurableObject } from 'cloudflare:workers'

const PATH_RE = /^[A-Za-z0-9_-]{43}$/
const BODY_RE = /^[A-Za-z0-9_-]{16,8192}$/
const MAX_BODY = 8192
const MAX_RECORDS = 64
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const reply = (status, body = null, extra = {}) =>
  new Response(body, { status, headers: { ...HEADERS, ...extra } })

async function sameSecret(given, expected) {
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  return crypto.subtle.timingSafeEqual(a, b)
}

async function readCapped(request, cap) {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > cap) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > cap) { await reader.cancel(); return null }
    chunks.push(value)
  }
  const all = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { all.set(c, at); at += c.byteLength }
  return new TextDecoder().decode(all)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/') return reply(200, 'dsh rendezvous\n', { 'content-type': 'text/plain' })
    const m = /^\/r\/([^/]+)$/.exec(url.pathname)
    if (!m || !PATH_RE.test(m[1])) return reply(404)
    const path = m[1]
    const stub = env.BOOK.get(env.BOOK.idFromName('book'))

    if (request.method === 'GET') return stub.fetch(`https://book/${path}`)

    if (request.method !== 'PUT' && request.method !== 'DELETE') return reply(405)
    const auth = request.headers.get('authorization') || ''
    if (!env.WRITE_SECRET || !auth.startsWith('Bearer ') ||
        !(await sameSecret(auth.slice(7), env.WRITE_SECRET))) return reply(401)

    if (request.method === 'DELETE') return stub.fetch(`https://book/${path}`, { method: 'DELETE' })

    const body = await readCapped(request, MAX_BODY)
    if (body === null) return reply(413)
    if (!BODY_RE.test(body)) return reply(400)
    return stub.fetch(`https://book/${path}`, { method: 'PUT', body })
  },
}

export class Book extends DurableObject {
  async fetch(request) {
    const path = new URL(request.url).pathname.slice(1)
    const store = this.ctx.storage
    if (request.method === 'GET') {
      const value = await store.get(path)
      return value === undefined ? reply(404) : reply(200, value, { 'content-type': 'text/plain' })
    }
    if (request.method === 'DELETE') { await store.delete(path); return reply(204) }
    const existing = await store.get(path)
    if (existing === undefined && (await store.list({ limit: MAX_RECORDS + 1 })).size >= MAX_RECORDS) {
      return reply(507)
    }
    await store.put(path, await request.text())
    return reply(204)
  },
}
```

> `crypto.subtle.timingSafeEqual` 是 Cloudflare Workers 的扩展 API，实现时按当前官方文档核对签名。

### 5.4 `npm run setup`（`scripts/setup.mjs`，易用性的关键）

1. 生成写密钥：`crypto.randomBytes(24).toString('base64url')`。
2. `wrangler secret put WRITE_SECRET`，把密钥通过 **stdin** 传入（不要出现在命令行参数里）。
3. `wrangler deploy`，用正则从输出里取出 `https://[^\s]+\.workers\.dev`。
4. 按 §2.1 打印两行 yaml。取不到 URL 时提示用户从 `wrangler deploy` 输出里自己复制。
5. 若 `wrangler` 未登录，直接转交 `wrangler login`，不要自己实现登录。

首次部署 DO 需要的 `new_sqlite_classes` 迁移已在 `wrangler.toml` 里，用户无需额外操作。

### 5.5 Worker 测试

用 `wrangler dev`（或 miniflare/vitest-pool-workers）跑：路径/体积校验、无密钥/错密钥 401、64 条上限 507、
超限 body 413（含不带 Content-Length 的流式上传）、GET/DELETE 幂等、响应头。

## 6. 网关插件改动（`dsh-plugin-mobile-gateway`）

先读 `PROTOCOL.md` 的「变更」相关章节和 `docs/*-app-integration.md` 的写法，新增能力要在 `PROTOCOL.md` 补一节，并标明
「`rendezvous-v1` 为可选能力，仅对已认证设备、仅当配置了 `rendezvousUrl` 时出现」。

### 6.1 配置

`lib/index.mjs` 的 `Config`（约 :221）追加：

```js
rendezvousUrl: Schema.string().default(''),
rendezvousWriteSecret: Schema.string().default(''),
```

- 启动时校验：`rendezvousUrl` 非空则必须是 `https:`、无用户名密码、path 只能是 `/`、无 query/hash、主机名含点且不是 IP 字面量；
  不合格 → 日志报错并**关闭功能**（不要让插件加载失败）。
- `rendezvousUrl` 与 `rendezvousWriteSecret` **两者都有**才启用。写密钥不得出现在任何日志/`/mgw/status`/帧里。
- 如果 `@deepseek-ai/schemastery` 支持 `.role('secret')`，给写密钥用上；不确定就查包里的类型，查不到就保持普通字符串并在文档里提示。
- `cordis.patch.yml` 里加注释掉的示例（与现有 `endpoints` 示例风格一致）。

### 6.2 设备注册表 `lib/devices.js`

- 设备记录新增可选字段 `rendezvousKey`（43 字符 base64url）。
- **`load()`（约 :65-84）是逐字段重建对象的，必须在重建处加上 `rendezvousKey`（校验 `^[A-Za-z0-9_-]{43}$`，非法则丢弃）**，
  否则重启后字段静默丢失——这是本改动最容易漏的一处。
- 新增方法：
  - `ensureRendezvousKey(deviceId)`：设备存在且未撤销则返回 key，缺失就生成 `crypto.randomBytes(32).toString('base64url')`、`save()` 后返回；设备不存在返回 `undefined`。
  - `rendezvousEntries()`：返回 `[{ id, key }]`，仅含有 key 的有效设备。
  - `peekRendezvousKey(deviceId)`：只读，撤销前取 key 用。
- `claimPairing` 的「同一 clientDeviceId 重新配对」分支原地更新同一个设备对象，key 自然保留；**不要**在重配对时重新生成 key。
- `publicDevice()` 保持字段白名单，**绝不能**暴露 `rendezvousKey`。`list()` 同理。
- 不需要提升 `STORE_VERSION`。

### 6.3 帧协议

请求（手机 → 网关，control 或 legacy 连接均可；`X-DSH-Channel: conversation` 的连接会被现有 `wrong-channel` 逻辑拒绝，不用额外处理）：

```json
{ "type": "rendezvous-config", "requestId": "<uuid>" }
```

响应：

```json
{ "kind": "rendezvous-config", "requestId": "<原样回显>", "url": "https://dsh-rendezvous.x.workers.dev", "key": "<43字符>", "gatewayId": "<uuid>" }
```

- 未认证：`{kind:'error', code:'authentication-required', requestType:'rendezvous-config', requestId, message}`（照抄 `PLUGIN_REQUEST_TYPES` 分支的写法，约 :3177）。
- 功能未启用：`{kind:'error', code:'rendezvous/disabled', requestType, requestId, message}`。
- 成功响应**只发给请求方这一条连接**，不广播、不推送。
- 处理流程：认证检查 → `registry.ensureRendezvousKey(ws.deviceId)` → 若这是新生成的 key，立刻触发一次发布（`publisher.poke()`），
  这样手机随后第一次 GET 就能读到。
- `hello.capabilities`（约 :3228）追加 `...(device && rendezvousEnabled ? ['rendezvous-v1'] : [])`，写法与 `speech-input-v1` 相邻。
  未配置时数组必须与今天**完全相同**（`test/auth.test.mjs:309-333` 的快照断言必须原样通过）。

### 6.4 发布器 `lib/rendezvous.mjs`（新文件）

```js
createRendezvousPublisher({
  url, writeSecret, gatewayId,
  getEndpoints,          // () => string[]，即 advertisedEndpoints()
  getEntries,            // () => [{id, key}]，即 registry.rendezvousEntries()
  fetchImpl = fetch, now = Date.now, log,
  tickMs = 60_000, republishMs = 30 * 60_000, timeoutMs = 10_000,
}) → { start(), stop(), poke(), retire(key), status() }
```

行为：

- `start()`：立即 poke 一次，并开 `tickMs` 的 `setInterval`（`unref()`）。`stop()` 清定时器并挂到插件已有的清理处
  （与 `fileTransferExpiryTimer` 的 `clearInterval` 同处）。
- 每次 tick：对每个 `getEntries()` 里的设备，当且仅当「endpoints 序列化结果与上次发布不同」**或**「距上次成功发布 ≥ `republishMs`」**或**「被 poke 标记为脏」时发布。
  `republishMs` 的作用：Worker 里记录被删/丢失而地址没变时能自愈。
- **所有网络操作（PUT 和 DELETE）走同一条串行 promise 链**，同一时刻只有一个在飞。这是「撤销后不复活」的全部保证：
  `retire` 的 DELETE 排在已入队的 PUT 之后；每个 PUT 真正发出前**重新检查**该设备仍在 `getEntries()` 且 key 未被 retire。
- PUT：`PUT {url}/r/{path}`，头 `Authorization: Bearer <writeSecret>`、`Content-Type: text/plain`，`AbortSignal.timeout(timeoutMs)`；
  204 视为成功。失败只记 `lastError` 并等下一个 tick 重试（60s 的 tick 本身就是重试节奏，不另写退避）。
- `retire(key)`：把该 path 加入内存 retired 集合（本进程内不再发布），入队一次 DELETE，失败仅记日志。
- 错误信息进日志前去掉 URL 中的 path 段（path 是读取能力）。
- `status()` → `{ configured, url, devices, lastPublishAt, lastError }`。

### 6.5 接线点（`lib/index.mjs`）

- 创建 publisher：放在 `registry`、`advertisedEndpoints` 定义之后（约 :2436 之后）。
- `/mgw/status`（约 :2826）追加 `rendezvous: publisher.status()`（未配置时 `{configured:false}`）。
- 撤销路由（约 :2979）：先 `const key = registry.peekRendezvousKey(id)`，再 `registry.revoke(id)`，成功后 `publisher.retire(key)`（key 存在才调）。
- 手机请求帧分发：在 `ws.on('message')` 的 else-if 链里新增 `rendezvous-config` 分支（别忘了：不进 `handleQuery`，自己同步回帧即可）。

### 6.6 插件测试

新增 `test/rendezvous.test.mjs` 并加进 `package.json` 的 `test` 脚本：

- 加密层向量（§4.2）与负向量；`rev` 单调（时钟回拨、同毫秒多次发布）。
- `devices.js`：`ensureRendezvousKey` 幂等；**load→save→load 往返后 key 仍在**；`publicDevice`/`list` 不含 key；重配对保留 key；撤销后 `rendezvousEntries` 不含它。
- 发布器（fake fetch）：启动即发布；地址变化触发；无变化不发；超过 `republishMs` 重发；PUT 失败记 `lastError` 且下个 tick 重试；
  写密钥只出现在 `Authorization` 头；撤销与在途 PUT 的顺序（PUT 延迟中 `retire` → DELETE 在 PUT 之后、不会再发新 PUT）；超限时截尾。
- 帧：未认证报错；未启用报错；认证后返回 url/key/gatewayId 且 requestId 回显；**两次请求返回同一把 key**；
  `capabilities` 在未配置时与今天完全一致，配置后仅对已认证设备多一项。

## 7. App 改动（本仓库）

分层规则照旧：纯函数放 `src/protocol/`（不许 import `react-native`），网络放 `src/transport/`，持久化放 `src/storage/`。

### 7.1 依赖

```bash
npx expo install @noble/hashes @noble/ciphers   # 需固定到 2.4.0（已用该版本验证过向量）
```

`@noble` 2.x 是纯 ESM，`jest` 需要把它加入转换白名单：在 `package.json` 的 `jest` 配置里添加
`transformIgnorePatterns`（沿用 jest-expo 默认规则并放行 `@noble`），然后确认 `npx jest` 能跑通。
手机端**只解密**，不需要随机数，Hermes 下无需 polyfill。

### 7.2 存储（`src/storage/gateway-store.ts`）

```ts
export interface RendezvousConfig {
  url: string;        // Worker origin，如 https://dsh-rendezvous.x.workers.dev（已规范化，无末尾斜杠）
  key: string;        // 43 字符 base64url
  gatewayId: string;  // 来自配置响应，用于校验 blob
  seenRev?: number;   // 已接纳的最大 rev
}
// SavedGateway 增加：rendezvous?: RendezvousConfig
```

- **串行化写入**：给模块内所有写 SecureStore 的函数加一个简单的 promise 队列（`withLock`），避免并发读改写互相覆盖。
- 新增 `patchGatewayIfExists(id, patch | (current)=>patch): Promise<SavedGateway | null>`：
  在锁内**重新读取**存储里的最新记录再合并；记录不存在返回 `null`、**不新建**；**不改 `ACTIVE_KEY`**。
- 现有 `App.tsx` 里 hello 补 `gatewayName` 的那处（约 :603-609）改成走 `patchGatewayIfExists`，不再 `upsertGateway`；
  `upsertGateway` 只保留给用户主动动作（配对、切换）。
- **重新配对会整条替换记录从而清掉旧 `rendezvous`——这是有意为之**：换 `gatewayId`（换了一台网关）时仍需要重新配对；同一 `gatewayId` 下的 Worker 迁移由下文的 `migrate` 自动处理。

### 7.3 纯函数 `src/protocol/rendezvous.ts`

导出（全部可单测）：

- `normalizeWorkerUrl(raw): string | null`：必须 `https:`、无 userinfo、path 仅 `/`、无 query/hash、主机名含点且不是 IP 字面量；返回 `origin`。
- `parseRendezvousConfigFrame(frame): {url, key, gatewayId} | null`：校验 `kind==='rendezvous-config'`、`key` 匹配 `^[A-Za-z0-9_-]{43}$`、`gatewayId` 非空字符串、`url` 通过上面规范化。
- `deriveLocator(key): {path, aesKey}`（用 `@noble/hashes` 的 hkdf+sha256，info 字符串见 §4.1）。
- `decodeAddressBook({ body, config, now }): { rev, endpoints } | null`：执行 §4.4 的 1~6 步。
- `pickGatewayUrl(endpoints): string`：第一个 `wss://`，否则第一项（与 `pairWithText` 现有规则一致，`pairWithText` 可顺手复用它）。
- `decideAdoption(local: RendezvousConfig | undefined, incoming): 'adopt' | 'rotate-key' | 'migrate' | 'same' | 'conflict'`：

| 本地状态 | 收到的配置 | 结果 | 动作 |
|---|---|---|---|
| 无 | 合法 | `adopt` | 保存，`seenRev` 留空 |
| 有 | `url` 相同、`key` 相同、`gatewayId` 相同 | `same` | 什么都不做 |
| 有 | `url` 相同、`key` 不同 | `rotate-key` | 更新 key，**清空 `seenRev`**（新 key 是新的 rev 作用域） |
| 有 | `url` 不同、`gatewayId` 相同 | `migrate` | 更新 url/key，**清空 `seenRev`**（新 Worker 是新的 rev 作用域） |
| 有 | `gatewayId` 与本地记录里的 `gatewayId`（配对载荷来的，如有）不同 | `conflict` | 整帧丢弃，触发 §7.4 提示 |

> `url`/`key` 变化都来自已认证连接，冒充者没有设备 token；同一 `gatewayId` 下采纳它们是安全的。
> 不能用「url 不同」拒绝：手动→托管、停用再启用、部署失败重试都会产生新 Worker，拒绝等于把用户逼回重新扫码。
> 只有 `gatewayId` 变化才说明换了一台网关，需要重新配对。

### 7.4 冲突时的唯一提示

- 内存里记一个 `rendezvousConflict: Set<gatewayId>`，**不持久化**。
- 在网关列表中该条目的副标题处显示一行灰字：「网关身份已变化，重新扫码后可恢复自动找回」。
- 不弹窗、不阻断连接、不影响正常使用。用户重新配对后记录被整条替换，下次连接自然 `adopt`，提示消失。
- 找不到合适的列表位置时，先只 `console.warn` 并把这一条列为待办，**不要**为它新建页面。

### 7.5 网络与刷新 `src/transport/rendezvous.ts`

- `fetchAddressBook(config, { timeoutMs = 5000 }): Promise<string | null>`：
  `GET {url}/r/{path}`，`AbortController` 超时；`credentials: 'omit'`；状态非 200 返回 `null`；读完后再检查长度 ≤ 8192。
  **不要写 `redirect:'error'`、`cache:'no-store'`**：RN 的 `whatwg-fetch` 不支持前者，后者只是给 URL 追加时间戳参数；
  响应体在 fetch resolve 前已全部缓冲，所以体积限制只能是「读后丢弃」，代码注释里写清楚，别暗示它能限制内存。
  Worker 是用户自己的，这两项不构成实质风险。
- `createUrlRefresher(deps)`：返回 `(gatewayId: string) => Promise<string | undefined>`（返回「现在应该连的 URL」，无变化/无数据时返回 `undefined`）。
  - **按 `gatewayId` 单飞**：同一网关已有在途请求时直接返回同一个 promise（`client` 与 `control` 两条连接会同时调用）。
  - 流程：从 `savedRef.current` 读取 `{id, rendezvous}`（**调用时读取，别用闭包快照**）→ 记下 `{id, key}` →
    `fetchAddressBook` → 每个 `await` 之后确认 `savedRef.current?.id === id && savedRef.current.rendezvous?.key === key`，不满足就丢弃结果 →
    `decodeAddressBook` → `pickGatewayUrl` → `patchGatewayIfExists(id, { url, endpoints, rendezvous: {...旧, seenRev: rev} })`
    （`url`、`endpoints`、`seenRev` **同一次写入**；写失败则不推进 `seenRev`、返回 `undefined`）→ 写成功后更新 `savedRef`/`setSaved`/`setGateways` → 返回新 `url`。
  - `rev <= seenRev` 时**不报错**：直接返回 `undefined`。
  - 全程不抛异常到调用方；失败一律 `undefined`。

### 7.6 `GatewayClient` 改动（`src/transport/gateway-client.ts`）

在 `ConnectOptions` 增加：

```ts
/** 连续失败后向上层要一个可能更新过的地址；返回新 URL 或 undefined。 */
refreshUrl?: () => Promise<string | undefined>;
```

在 `scheduleReconnect()`（约 :246）里，**在原有的「配对码直接停」判断之后**：

- 触发条件（全部满足才调）：`options.refreshUrl` 存在、`this.attempt >= REFRESH_AFTER_FAILURES - 1`（即连续第 2 次失败起）、
  `this.online`、`Date.now() - this.lastRefreshAt >= REFRESH_COOLDOWN_MS`、当前没有在途刷新、`!this.stopped`。
- 触发后先写 `lastRefreshAt = now`（**尝试开始时**就计冷却，离线重试也不会被打爆），记下 `const captured = this.options`，不阻塞原有重连定时器，异步调用 `refreshUrl()`。
- 返回后：若 `this.stopped` 或 `this.options !== captured`（期间被 `connect()` 换掉）→ 丢弃；
  若返回了与 `captured.url` 不同的 URL → `this.options = { ...captured, url }`，`clearTimeout(this.reconnectTimer)`，`this.attempt = 0`，立即 `this.open()`。
- 4003/4004 已把 `stopped` 置 true，所以**天然不会触发**；一次性配对码连接在更早的分支已 return，也不会触发。不要匹配中文错误文案。

`connection-policy.ts` 增加常量（与现有候选值同口径，注释写明「候选值，真机后再调」）：
`REFRESH_AFTER_FAILURES = 2`、`REFRESH_COOLDOWN_MS = 60_000`。

### 7.7 `App.tsx` 接线

1. **领取配置**：`control` 连接的 `hello` 帧到达且 `authenticated` 且 `capabilities` 含 `rendezvous-v1` 时，发 `{type:'rendezvous-config', requestId}`。
   收到 `kind:'rendezvous-config'` 且 `requestId` 匹配 → `parseRendezvousConfigFrame` → `decideAdoption`（§7.3）→ 按表执行。
   每次 control 连上都问一次（一帧很便宜），好处是能发现 `rotate-key`/`conflict`，也能补回丢失的本地配置。
   收到 `error` 帧（`rendezvous/disabled` 等）直接忽略。**不要**把这个错误显示成会话失败。
2. **挂刷新器**：`connectWith`（约 :998）和 `startControl`（约 :326）调用 `connect()` 时都传
   `refreshUrl: () => refresher(gateway.id)`。仅当该网关已有 `rendezvous` 时才传（没有就不传）。
3. **不要**在 `onState` 里做任何地址簿逻辑。
4. `pairWithText` / `paired` / 一次性配对流程**一行不改**（配置通过 §7.7.1 稍后领取）。
5. 如果记录没有 `gatewayId`（老配对没带），领取时不做 `gatewayId` 与本地记录的比较，直接信任响应里的（已认证连接），并存入 `rendezvous.gatewayId`。

### 7.8 App 单测

- `src/protocol/__tests__/rendezvous.test.ts`：§4.2 向量解密（含「忽略 `ts`/`name`」）；§4.4 的 6 步各自的负例；
  `rev` 未来 7 天以上被拒；`decideAdoption` 决策表每一行；`normalizeWorkerUrl` 的拒绝项（http、带路径、userinfo、IP 字面量、localhost）；`pickGatewayUrl`。
- `src/transport/__tests__/`：`patchGatewayIfExists` 不新建、不激活；并发写不丢字段；
  `createUrlRefresher` 单飞；await 期间切换网关/重新配对 → 结果被丢弃且不写存储；写失败不推进 `seenRev`。
- `GatewayClient` 刷新：连续失败后调用一次；冷却内不重复；4003 之后不调用；期间 `connect()` 换了 options → 丢弃结果；
  返回新 URL → 立即用新 URL 重连并 `attempt` 归零；返回相同 URL → 不动。
  （参照 `src/transport/__tests__` 里现有对 `GatewayClient` 的 mock 方式；`expo-network` 需要 mock。）

## 8. 验收旅程（真机/本机网关走一遍，别只测函数）

本机网关的起法见 `AGENTS.md`「本机网关」一节；需要的话在 `docs/tools/fake-gateway.mjs` 里加上 `rendezvous-v1` 与 `rendezvous-config` 响应，
并在本地起一个最小的假 Worker（Node `http`，实现 §5.1 的 GET/PUT/DELETE + 写密钥）来做不依赖 Cloudflare 的回归。

| 旅程 | 步骤 | 预期 |
|---|---|---|
| J1 新用户 | 网关已配置 → 扫码配对 → 进会话列表 | 无任何额外提示；本地记录里出现 `rendezvous` |
| J2 老用户升级 | 老设备（已配对、本地无 `rendezvous`）→ 网关启用地址簿 → 打开 App | 连上后自动领取配置，**未重扫** |
| J3 隧道重启 | 杀掉并重启 cloudflared/dsh（URL 变）→ 手机在前台等待 | ≤约 3 分钟内自动恢复；横幅自行消失；无弹窗 |
| J4 换网 | 手机 WiFi↔蜂窝，旧入口不可达 | 同 J3 |
| J5 撤销 | 网关撤销该设备 | 手机收到 4003 → **停止重连、不触发刷新**；Worker 里该记录被删（或至少不再更新） |
| J6 换 Worker（同 `gatewayId`） | 手动↔托管、停用再启用、重新部署 → 手机连上 | `migrate`：更新 url/key、清空 `seenRev`，不扫码；连接照常 |
| J6b 换网关 | 手机连到另一台网关（`gatewayId` 不同） | `conflict`：保持原配置、连接照常、列表里出现一行灰字；重新扫码后恢复 |
| J7 Worker 挂了/记录丢了 | 停掉 Worker 或手动删记录，再让 URL 失效 | 行为与今天完全一致（只是重连不成功）；Worker 恢复且网关 30 分钟内重发后自愈 |
| J8 切网关竞态 | 网关 A 连不上，刷新进行中切到网关 B | B 保持激活，A 的迟到结果被丢弃，不写存储、不重连 |
| J9 兼容 | 旧 App × 新网关；新 App × 旧网关（无 `rendezvous-v1`） | 两者行为与今天一致；新 App 不发 `rendezvous-config`，不显示任何新提示 |
| J10 重启 App | 冷启动 | `rendezvous` 与 `seenRev` 仍在；无需重新领取 |

记录心流（有没有被打断）、是否出现任何弹窗/多余点击；结论按「源码确认 / 真机实测 / 仍是假设」分级。

## 9. 实现顺序（每步可独立验证、可独立回退）

1. **加密层**：App 的 `deriveLocator` + `decodeAddressBook`、网关的加密函数，两边都先用 §4.2 向量跑通（这是互操作的地基）。
2. **Worker**：§5，本地 `wrangler dev` 测试通过，写 `README` 与 `npm run setup`。
3. **网关**：§6，`npm test` 全绿，且「未配置时 hello capabilities 与今天一致」。
4. **App 纯逻辑与存储**：§7.2、§7.3、§7.5（先不接 UI/连接）。
5. **`GatewayClient` 刷新钩子**：§7.6。
6. **`App.tsx` 接线 + 提示**：§7.7、§7.4。
7. **本机网关 + 假 Worker 走 §8 旅程**，再用真网关/真 Worker 抽查 J1、J2、J3、J6。

完成前必须通过：`npx jest`、`npx tsc --noEmit`、`npx expo lint`（App）；`npm test`（网关）；Worker 自己的测试。

## 10. 风险与回退

- 全部功能默认关闭；网关不配置 `rendezvousUrl`，协议行为与今天逐字节一致。
- App 侧：没有 `rendezvous` 配置就不传 `refreshUrl`，`GatewayClient` 行为不变；所有失败路径都退化为「今天的样子」。
- 回退：网关去掉两行配置并重启即可停用；App 单个 commit 可 revert（存储里多出的 `rendezvous` 字段会被忽略）。
- 已知残留：见 §1.3；`rev` 取墙钟意味着网关时钟被改到未来后再改回，手机会拒绝较小的 `rev`（`rotate-key` 或重新配对可恢复）。

## 11. 代码锚点（实现前先确认行号，上游可能已变）

网关（`dsh-plugin-mobile-gateway`）：
`lib/index.mjs`：`Config` :221；`advertisedEndpoints` ~:2436；`/mgw/status` ~:2826；`/mgw/pair` ~:2947；撤销路由 ~:2979；
`ws.on('message')` 分发与 `PLUGIN_REQUEST_TYPES` 认证写法 ~:3086-3195；`hello` 与 `capabilities` ~:3222-3256。
`lib/devices.js`：`digest` :16；`load()` 逐字段重建 ~:65-84；`claimPairing` ~:137；`revoke` ~:214。
`test/auth.test.mjs:309-333`（capabilities 快照断言）；`package.json` 的 `test` 脚本。

App（本仓库）：
`App.tsx`：`startControl` ~:320、`hello` 处理 ~:588、`paired` ~:613、`connectWith` ~:984、`pairWithText` ~:1015。
`src/transport/gateway-client.ts`：`ConnectOptions` :16、`scheduleReconnect` ~:246、`classifyClose` 在 `connection-policy.ts`。
`src/storage/gateway-store.ts`：`upsertGateway`（会激活并可重建记录，**别用于后台更新**）。
`src/protocol/pairing.ts`：`isPairingUrlAllowed`、`parsePairingPayload`。
