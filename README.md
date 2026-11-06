# DSH Mobile

[![CI](https://github.com/solla-h/dsh-mobile-app/actions/workflows/ci.yml/badge.svg)](https://github.com/solla-h/dsh-mobile-app/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A third-party, open-source mobile client for **DeepSeek Harness (DSH)**. It connects to a DSH host through the
[`dsh-plugin-mobile-gateway`](https://github.com/Clarklevis1995/dsh-plugin-mobile-gateway) plugin over the
`dsh-mobile-v1` WebSocket protocol.

> **Status: public alpha.** Signed Android APKs are distributed through [GitHub Releases](https://github.com/solla-h/dsh-mobile-app/releases).
> Android has been tested on a real device with DSH `0.2.1-rc.5`
> and gateway `0.12.0-rdv.3` (pairing, text reply, and hold-to-talk voice). iOS is not yet verified, and the app
> is not on an app store. The protocol and UI may still change. This project is not affiliated with DeepSeek or
> Expo.

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
  This release is bound to **DSH `0.2.1-rc.5`** and the fork gateway version pinned in
  [`compatibility.json`](compatibility.json); see [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)
  for the last verified combination before installing anything.
- For the optional address book: a gateway build with `rendezvous-v1` and a Cloudflare account for the managed
  Worker deployment. The fork release above includes it; upstream releases are not part of this verified
  combination.
- Camera permission for QR pairing; microphone permission for voice input.

## Tested

| Platform | Status |
| --- | --- |
| Android 16, real device | Verified: pairing, session list, text reply, hold-to-talk voice |
| iOS | Not yet verified |
| Expo Go | Development shell only; native modules may require a development build |

The compatibility table is the release-level record; “not verified” means “stop and ask”, not “try it and see”.
Screenshots/GIFs are not included in this alpha yet; the UI is still moving.

## For DSH agents

If a user gives you this repository and asks you to install or configure the mobile gateway, **do not follow the
human quick start by guessing**. Read [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md) and run only:

```bash
node scripts/setup-gateway.mjs check
```

Before asking the user to stop DSH Web, run `node scripts/setup-gateway.mjs handoff --voice` (or `--no-voice`)
and give them the generated `DSH-MOBILE-NEXT-STEPS.md` plus the one-command inside it. The user runs `install`
and `voice` in a normal shell; the one-command uses `--stop-web --restart-web --tunnel quick --pair` so no step
is lost when the DSH Web session disappears. Do not call `dsh plugin add` directly, edit the profile, or use a
local checkout. `handoff`, `enable`, and `pair` are safe for the agent; `pair` writes a local QR page and never
prints the payload.

The release is pinned in [`compatibility.json`](compatibility.json): use its `recommended` versions, never
`@latest` or a local checkout. The task is the gateway, not building or testing the app; a real user already
has the APK installed.

The runbook also contains a copy-paste prompt for the user and the exact places where an agent must stop for
human approval (sudo, DSH Web restart/stop, public tunnel, Cloudflare login).

## Quick start (end users)

### 1. Install the gateway plugin

On the machine that runs DSH, from a clone of this repository, run this **in a normal terminal** (not in the
DSH Web chat). It stops DSH Web, installs the pinned gateway, optionally installs voice, restarts DSH Web,
enables the gateway, starts a Quick Tunnel, and opens the pairing page:

```bash
node scripts/setup-gateway.mjs install --yes --stop-web --restart-web \
  --tunnel quick --pair --open
```

Add `--voice` to install the matching `0.2.1-rc.5` voice bundle and pre-download the ~241 MB SenseVoice model
without a prompt, or `--no-voice` to skip. If neither is given and stdin is a terminal, the script asks
`Enable voice input now? [Y/n]`. The app shows “语音未启用” until the provider is ready. Do not install the older
`0.1.7-alpha.1` bundle on DSH `0.2.1-rc.5`.

Run it from the directory where you normally start `dsh web` so the restarted process keeps the same working
directory on Windows. The DSH Web session disappears while it restarts; reopen the same session from the session
list afterwards.

Manual fallback: stop DSH Web first (adding a bundle to a running Web process hot-reloads the plugin tree and
can leave `sessionController` unavailable until a full process restart), then run
`node scripts/setup-gateway.mjs install --yes`:

```bash
# Linux systemd
sudo systemctl stop dsh-web
# or Ctrl+C the terminal that is running `dsh web`

node scripts/setup-gateway.mjs install --yes
```

Start DSH Web with your normal command, then run `node scripts/setup-gateway.mjs check`.

The script installs the pinned tag from [`compatibility.json`](compatibility.json), refuses while port 3080 is
listening (unless `--stop-web` is given), and re-runs the checker. Do not use `@latest` or the Web plugin panel
for this release; see [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

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

Open [Releases](https://github.com/solla-h/dsh-mobile-app/releases), select a release with APK assets, and
download `dsh-mobile-v*.apk` from **Assets** (the older alpha.1 is source-only). Allow your browser or file
manager to install that APK on Android, then open DSH Mobile. No Expo account or development server is needed.
Grant camera access and scan the gateway QR code, or use the manual paste path. For an update, install over the
existing app to retain pairings and drafts; do not uninstall first. `SHA256SUMS` and `build-info.json` accompany
the APK; see [download verification](docs/RELEASING.md).

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

### GitHub Actions release builds

Pushing a release tag runs the quality checks, builds with Expo prebuild and Gradle on a standard GitHub Ubuntu
x64 runner, signs the APK, and publishes it with checksums through a draft release. This uses no EAS cloud
builds or Expo token. Standard hosted runners are free for this public repository; paid larger runners are not
used. See [the release runbook](docs/RELEASING.md) for signing secrets, version bumps and retry instructions.

### Preview APK with EAS (optional)

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

The official release path uses Gradle on GitHub Actions; EAS remains an optional personal preview path.
Generated native directories are never committed or edited by the release workflow.

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
be verified in a development or preview build. The package is marked `private` because this is an app, not an
npm library; it is not published to the npm registry.

### Local demo without a DSH host

`docs/tools/fake-gateway.mjs` is a deterministic WebSocket fake for pairing, the session list, message
receipts, and failure modes:

```bash
node docs/tools/fake-gateway.mjs
# USB: adb reverse tcp:3999 tcp:3999, then open http://127.0.0.1:3999/pair?host=usb
# LAN: LAN_HOST=<your-lan-ip> node docs/tools/fake-gateway.mjs
#      then open http://<your-lan-ip>:3999/pair?host=lan
```

Scan the page's QR with the app, or paste the payload. The fake serves one session and supports
`normal`, `no-ack`, `reject`, `no-hello`, `half-open`, `no-history`, and `no-create` modes; see the file header.

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

The source code is MIT; see [LICENSE](LICENSE). The Expo template notice and the non-commercial pet assets are
in [NOTICE](NOTICE). The animated assets in `assets/pet/` are CC BY-NC-SA 4.0 and may not be used for commercial
purposes.
