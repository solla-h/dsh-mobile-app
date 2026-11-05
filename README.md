# DSH Mobile

A third-party, open-source mobile client for **DeepSeek Harness (DSH)**. It connects to a DSH host through the
[`dsh-plugin-mobile-gateway`](https://github.com/Clarklevis1995/dsh-plugin-mobile-gateway) plugin over the
`dsh-mobile-v1` WebSocket protocol.

> **Status: experimental / not released.** The app is not on an app store yet, and the protocol and UI are still
> moving. Pair it with a compatible gateway version and expect breaking changes. This project is not affiliated
> with DeepSeek or Expo.

> [!IMPORTANT]
> **For DSH agents / AI agents:** If a user gives you this repository and asks you to install or configure the
> mobile gateway, **read [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md) and [`compatibility.json`](compatibility.json)
> first** and follow them. Use the pinned gateway/DSH versions; never use `@latest`, a local checkout, or a
> profile backup. Do not improvise from the human quick start, and do not build the app unless the user asks.

[简体中文](README.zh-CN.md) · [User guide](docs/USER-GUIDE.md) · [Agent setup](docs/AGENT-SETUP.md) ·
[Compatibility](docs/COMPATIBILITY.md) · [Rendezvous design](docs/rendezvous-design.md)

## Why another client?

DSH's Web UI is excellent on a desktop. On a phone, the useful part is not a shrunken desktop page: it is a
small number of decisions — what is running, what is waiting for me, and what do I say next. DSH Mobile is built
around that loop:

- **Focus first** — running sessions and pending approvals/questions on the first screen.
- **One-hand flow** — a bottom tab bar, a thumb-sized voice button, and a composer that stays out of the way.
- **Phone-native transport** — QR pairing, reconnect and offline queues, image/file sharing, and an optional
  encrypted address book for gateway addresses that change.

## Features

- **Pair once, switch later** — scan a QR code or paste a pairing payload; multiple gateways can be saved and
  switched from the top bar.
- **Focus home** — running sessions, unanswered approvals/questions, recent sessions, and a small status pet.
- **Sessions** — list, search, create, rename, archive, fork from a message, and open parent/subagent sessions.
- **Live conversation** — streaming text, thinking/tool trajectory groups, Markdown and code rendering, copy and
  text selection, re-editing a user message in the composer, queued messages, and “steer” into the current turn.
- **Human in the loop** — approval and question cards, including approvals raised while you are away; stop the
  current turn from the composer.
- **Attachments** — camera/gallery images, file upload with SHA-256 verification (24 MB local limit), file
  download/preview, and image cards in history.
- **Voice input** — hold-to-talk when the gateway has a ready speech provider; the transcript is placed in the
  composer or sent to the selected session.
- **Plugin and schedule views** — inspect gateway capabilities, manage plugins and settings, and browse schedules.
- **Resilient connection** — cached session lists, drafts, an offline outbox, automatic reconnect, and a
  foreground/background-safe heartbeat.
- **Optional address book** — when the gateway supports `rendezvous-v1`, the phone can recover a changed Quick
  Tunnel or LAN address without scanning a new QR code. The Worker stores ciphertext only.

## How it fits together

```text
┌─────────────────────┐        WebSocket (conversation)       ┌──────────────────────────────┐
│  DSH Mobile (Expo)  │ ────────────────────────────────────▶ │ dsh-plugin-mobile-gateway    │
│                     │        WebSocket (control)            │  (runs inside DSH Web)       │
│  App.tsx state      │ ────────────────────────────────────▶ │                              │
└─────────┬───────────┘                                       └──────────────┬───────────────┘
          │                                                                  │
          │ optional: GET encrypted address                               │ PUT encrypted address
          ▼                                                                  ▼
                              Cloudflare Worker (user-owned)
```

The app talks only to the gateway, not to DSH's internal agent protocol. The gateway owns authentication,
device keys, session/event projections, and the optional rendezvous publisher.

## Requirements

- **Node.js 22.13+** for development (Expo SDK 58 / React Native 0.88 requirement).
- A DSH installation with `dsh-plugin-mobile-gateway`. The app speaks `dsh-mobile-v1`.
  This release is verified with **DSH `0.2.1-rc.5`** and the fork release
  [`v0.12.0-rdv.1`](https://github.com/solla-h/dsh-plugin-mobile-gateway/releases/tag/v0.12.0-rdv.1);
  see [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) before installing anything.
- For the optional address book: a gateway build with `rendezvous-v1` and a Cloudflare account for the managed
  Worker deployment. The fork release above includes it; upstream releases are not part of this verified
  combination.
- Camera permission for QR pairing; microphone permission for voice input.

## For DSH agents

If a user gives you this repository and asks you to install or configure the mobile gateway, **do not follow the
human quick start by guessing**. Read [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md) and run only:

```bash
node scripts/setup-gateway.mjs check
```

The user runs `install` and `voice` in a normal shell with DSH Web stopped; the script refuses while port 3080
is listening. Do not call `dsh plugin add` directly, edit the profile, or use a local checkout. `enable` and
`pair` are safe for the agent; `pair` writes a local QR page and never prints the payload.

The release is pinned in [`compatibility.json`](compatibility.json): use its `recommended` versions, never
`@latest` or a local checkout. The task is the gateway, not building or testing the app; a real user already
has the APK installed.

The runbook also contains a copy-paste prompt for the user and the exact places where an agent must stop for
human approval (sudo, DSH Web restart/stop, public tunnel, Cloudflare login).

## Quick start (end users)

### 1. Install the gateway plugin

On the machine that runs DSH, from a clone of this repository. Stop DSH Web first — adding a bundle to a
running Web process hot-reloads the plugin tree and can leave `sessionController` unavailable until a full
process restart:

```bash
# Linux systemd
sudo systemctl stop dsh-web
# or Ctrl+C the terminal that is running `dsh web`

node scripts/setup-gateway.mjs install --yes
```

The script installs the pinned tag from [`compatibility.json`](compatibility.json), refuses while port 3080 is
listening, and re-runs the checker. Do not use `@latest` or the Web plugin panel for this release; see
[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

Optional voice input: with DSH Web still stopped, run `node scripts/setup-gateway.mjs voice --yes`. It installs
the matching `0.2.1-rc.5` voice bundle and pre-downloads the ~241 MB SenseVoice model; the app shows
“语音未启用” until that provider is ready. Do not install the older `0.1.7-alpha.1` bundle on DSH `0.2.1-rc.5`.

Start DSH Web with your normal command, then:

```bash
node scripts/setup-gateway.mjs check
```

### 2. Enable the gateway and show a pairing code

```bash
node scripts/setup-gateway.mjs enable
node scripts/setup-gateway.mjs pair --open
```

Or open DSH Web → **Mobile devices → Connection & pairing** (移动设备 → 连接与配对). The script writes a local
QR page; the pairing code is single-use and expires in five minutes.

If the Web UI says the Quick Tunnel public entry has not passed verification while the tunnel is online, the
host's local DNS may be poisoned; the tunnel can still be live. Use `pair` to create a payload, and if the
phone also cannot resolve the hostname, enable a VPN or Private DNS (DoH) on the phone, or use Tailscale / a
named Tunnel. The app deliberately rejects plain `ws://` for public addresses.

### 3. Install the app

There is no app-store build yet. Build a preview APK from this repository (see [Build](#build)), or use a local
development build. Install it on the phone, open it, grant camera access, and scan the QR code. If the camera is
not available, choose the manual paste path and paste the pairing payload.

The pairing payload is short-lived (five minutes by default) and contains a device token. Treat the QR code like a
password.

### 4. Use it

- **Focus** shows what is running and what is waiting for you.
- **All sessions** lists every session; tap one to open the conversation.
- **Schedules** and **Plugins** expose the gateway's schedule and plugin management surfaces.
- Tap the gateway name at the top to add, switch, or remove a gateway.
- Approvals and questions appear in the conversation and in the Focus tab; answer them there.
- The composer supports text, images, files, queued messages, “steer”, and stop.
- When the connection drops, the app keeps cached sessions and drafts and retries in the background. Messages
  written while offline are queued in the outbox; file uploads require an online connection.

See the [User guide](docs/USER-GUIDE.md) for the full journey and troubleshooting.

## Address book (optional)

The address book solves one specific problem: a gateway's Quick Tunnel URL (or LAN IP) changes, so a paired phone
can no longer reach it. With `rendezvous-v1`:

1. In the gateway panel, open **Address Book** and enable it.
2. The plugin logs in to Cloudflare with `wrangler login --device`, deploys a Worker, and stores the write secret
   locally. The user only authorizes Cloudflare; no manual Worker setup is required.
3. Each paired phone gets a per-device 32-byte key over the authenticated connection. The gateway publishes the
   current endpoint encrypted with AES-256-GCM; the Worker stores only ciphertext.
4. If the app cannot connect, it fetches the latest encrypted record, decrypts it, and retries the new address.
   Recovery is typically within one to three minutes, not instant.

The Worker is user-owned. Cloudflare can see request metadata (path, IP, time, ciphertext length) but not the
endpoint or the key. See [Rendezvous design](docs/rendezvous-design.md).

One Worker belongs to one gateway. If you run DSH on several machines, pair each gateway separately; each can
have its own address book. An address book recovers addresses for its own gateway; it does not combine several
DSH hosts into one pairing.

No address book is required for the core app; without it, a changed public URL still requires a new QR scan.

## Build

### Preview APK with EAS (recommended)

```bash
git clone https://github.com/solla-h/dsh-mobile-app.git
cd dsh-mobile-app
npm install
npx eas-cli login
npx eas-cli init --account <your-expo-account>
npx eas-cli build --platform android --profile preview
```

- `preview` produces an installable APK with EAS-managed Android credentials.
- `preview-local` uses `credentials.json` and a local keystore; it is intended for maintainers who do not want
  EAS to hold signing material. `credentials.json` and `*.jks` are gitignored.
- For iOS, use `--platform ios --profile preview`; an Apple developer account and provisioning are required.

The EAS project in `app.json` is linked to the maintainer's Expo account. If you fork the repository, run
`npx eas-cli init --account <your-account> --force` to link your own project before building.

### Local native build

`android/` and `ios/` are generated by Expo Continuous Native Generation and are not committed.

```bash
npm install
npx expo run:android   # requires JDK 17+ and Android SDK; builds a debug app
```

For a release APK locally, configure a keystore and use Gradle; EAS is the supported path in this repository.

### Development

```bash
npm install
npx expo start        # Expo Go / development build
npm test              # Jest, protocol and transport logic
npm run typecheck     # tsc --noEmit
npm run lint          # expo lint
npx expo-doctor       # dependency and config checks
```

Expo Go is useful for UI work, but native behavior (camera, secure storage, audio, background reconnect) should
be verified in a development or preview build.

## Project layout

| Path | Responsibility |
| --- | --- |
| `App.tsx` | Top-level state machine: pairing → gateway list → session; global pending/offline state |
| `src/protocol/` | Pure parsing and mapping of `dsh-mobile-v1` frames; no `react-native` imports |
| `src/transport/` | WebSocket client, connection policy, history cache, outbox, file transfer, rendezvous refresher |
| `src/storage/` | SecureStore (gateway tokens/device identity) and file-backed caches |
| `src/ui/` | Screens and components; no Expo Router — navigation is state-driven |
| `docs/` | User guide, rendezvous design, and internal working notes |

The app deliberately has **no Expo Router**. Routes would add a second navigation state next to the gateway and
session state machine; screens are rendered from `App.tsx` instead. Keep non-route code out of `App.tsx` and
protocol logic in `src/protocol/`.

## Security and privacy

- Pairing tokens and device identity are stored with `expo-secure-store`, not in plain files.
- Public endpoints must use `wss://`; plain `ws://` is accepted only for private/LAN addresses.
- Session history, drafts, and attachment metadata are cached locally so the app remains useful offline.
  Revoke a device in the gateway panel to invalidate its token; the app then stops reconnecting and asks for a
  new pairing.
- The app code contains no third-party analytics SDK. The gateway and Expo runtime may still produce their own
  logs; review those projects separately.
- Address book content is end-to-end encrypted between the gateway and each phone. The Worker holds ciphertext
  and metadata only.

Do not post a pairing QR, a gateway write secret, or a device token in public issues. Redact hostnames and
account IDs from screenshots.

## Known limitations

- No app-store release; the current flow requires a sideloaded APK or a development build.
- The protocol is still evolving. Match the app and gateway versions; older gateways may not expose newer
  capabilities.
- The address book needs Cloudflare and a gateway build with `rendezvous-v1`; recovery takes one to three minutes
  and depends on the Worker being reachable. In mainland China, `workers.dev` may be affected by DNS pollution;
  use a custom domain or a VPN/DoH path.
- Quick Tunnel is best-effort and has no uptime guarantee.
- iOS builds require an Apple developer account; Windows cannot build iOS locally.

## Contributing

Issues and pull requests are welcome. Before opening a PR:

1. Keep protocol changes in `src/protocol/` as pure functions with tests.
2. Run `npm test`, `npm run typecheck`, `npm run lint`, and `npx expo-doctor`.
3. Do not edit generated `android/` or `ios/` directories; configure native behavior in `app.json` or config
   plugins.
4. If you change pairing, reconnect, or address-book behavior, update the user guide and the rendezvous design
   note.

## License

MIT. See [LICENSE](LICENSE).
