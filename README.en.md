# DSH Mobile

[Website](https://fatwhale.app/en/) · [简体中文](README.md) · [Download Android APK](https://github.com/solla-h/dsh-mobile-app/releases) ·
[User guide](docs/USER-GUIDE.md) · [Compatibility](docs/COMPATIBILITY.md)

[![CI](https://github.com/solla-h/dsh-mobile-app/actions/workflows/ci.yml/badge.svg)](https://github.com/solla-h/dsh-mobile-app/actions/workflows/ci.yml)
[![Code: MIT](https://img.shields.io/badge/Code-MIT-yellow.svg)](LICENSE)

**Check DSH progress, respond to approvals, and continue conversations from your phone.**

DSH Mobile is a third-party, open-source Android client for **DeepSeek Harness (DSH)** that connects to your own
DSH host. The agent runs on the host; the phone keeps three things at hand: what is running, what is waiting
for me, and what I want to say next.

> **Public Android alpha.** [`v0.1.0-alpha.5`](https://github.com/solla-h/dsh-mobile-app/releases/tag/v0.1.0-alpha.5)
> is published. It is built and signed by the release pipeline; the signed APK passes the complete local-fixture emulator
> journey plus independent download/signature checks, and nothing is published if any stage fails.
> Physical-device re-verification is pending: the 2026-11-07 Android 16 journey was on an earlier build (including the
> failures recorded there) and does not transfer to alpha.5. See the verification table below.
> iOS is deferred and unverified; there is no app-store release. This project is not affiliated with DeepSeek or Expo.

> [!IMPORTANT]
> **For DSH / AI agents:** when the user asks you to install or configure the mobile gateway, read
> [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md) and [`compatibility.json`](compatibility.json) first, then follow
> their handoff flow. Use only the pinned DSH/gateway versions; never use `@latest`, a local checkout, or a
> profile backup, and do not build the app unless the user asks.

## What it is for

A phone does not need a shrunken desktop page. It needs three actions:

- **See at a glance** — Focus shows running sessions, pending approvals/questions, and recent sessions first;
  the top bar switches between saved gateways.
- **Say one thing** — streamed replies, thinking/tool trajectories, Markdown and code, approval and question
  cards all live in the conversation. The composer supports text, images, files, queued messages, steering,
  and stop; when gateway voice is ready, hold to talk.
- **Leave and come back** — session lists, drafts, and attachment metadata are cached locally. Text messages
  go to an offline outbox and flush in order after reconnect; attachments require a connection. If a public address changes, the optional
  address book (`rendezvous-v1`) helps a paired phone recover the endpoint without a new QR scan.

## Screenshots

| Session list | Receiving a reply |
| --- | --- |
| <img src="docs/images/session-list.png" width="280" alt="Sessions grouped by workspace, using synthetic fixture data"> | <img src="docs/images/session-reply.png" width="280" alt="A sent message and the fixture gateway's reply, with the keyboard open"> |

Captured during the [passing Android emulator journey](https://github.com/solla-h/dsh-mobile-app/actions/workflows/android-journey.yml)
using a local fake gateway and synthetic conversations. No real account or pairing credentials are shown.
The app interface is currently primarily Chinese.

## Quick start

### Ask Codex / a DSH agent to help

Give this prompt to an agent **with terminal access to the target DSH host**. A repository URL alone does not
say whether you want to configure the gateway or develop the app.

```text
Help me configure DSH Mobile: https://github.com/solla-h/dsh-mobile-app
Read docs/AGENT-SETUP.md and compatibility.json first. Prepare the pinned host version and run the read-only check.
If installation or a restart is needed, run handoff first and give me the complete handoff file and one install command to run in a normal terminal.
Then continue checking, enable the gateway and generate a local pairing page. Report only its path, never pairing credentials.
Do not build the app or upgrade an existing DSH without approval. I will handle account authorization, phone installation and scanning.
```

The agent can handle inspection and most configuration steps. You still provide a working model configuration,
run the handoff command, and install/scan on the phone. An agent running inside DSH Web must not stop the Web
process hosting it. See the [Agent setup guide](docs/AGENT-SETUP.md) for the exact boundaries.

### 1. Prepare your own DSH host and gateway

DSH Mobile does not bundle a model or host DSH for you. You need a machine running **DSH Web** with
`dsh-plugin-mobile-gateway` installed in the matching profile. This release is pinned to **DSH `0.2.1-rc.5` +
gateway `0.12.0-rdv.3`**; see [`compatibility.json`](compatibility.json) and
[Compatibility](docs/COMPATIBILITY.md).

**Use the [DSH Mobile maintained gateway](https://github.com/solla-h/dsh-plugin-mobile-gateway)**, a fork of
[the upstream project](https://github.com/Clarklevis1995/dsh-plugin-mobile-gateway). The setup script selects
our exact GitHub tag. The same-named npm package belongs to the upstream release line; do not substitute
`npm install dsh-plugin-mobile-gateway` or `@latest`. You do not need to clone or build the gateway.

For a new DSH host, follow [first-time host setup](docs/USER-GUIDE.md#1-before-you-start), including one
working conversation in DSH Web. On an existing host, obtain the setup tools and run the read-only check:

```bash
git clone https://github.com/solla-h/dsh-mobile-app.git
cd dsh-mobile-app
node scripts/setup-gateway.mjs check
```

These scripts do not require `npm ci` or building the mobile app; plugin installation needs `pnpm` on the
host (version and preparation steps are in the user guide). Complete installation with the
[User guide](docs/USER-GUIDE.md) or [Agent setup guide](docs/AGENT-SETUP.md). Installation
briefly stops and restarts DSH Web. If an AI agent is doing it, give it the agent notice above together with
the guide. Voice is optional: the host needs the matching voice plugin and a prepared recognition model.

### 2. Download and install the APK

Open [Releases](https://github.com/solla-h/dsh-mobile-app/releases) and download
[`dsh-mobile-v0.1.0-alpha.5.apk`](https://github.com/solla-h/dsh-mobile-app/releases/download/v0.1.0-alpha.5/dsh-mobile-v0.1.0-alpha.5.apk)
from the **Assets** of `v0.1.0-alpha.5`. Allow your browser or file manager to install it; no Expo account or
development server is needed. The same release provides `SHA256SUMS` and `build-info.json` for download and
signature verification; see the [release runbook](docs/RELEASING.md). To update, install over the existing app
to keep pairings and drafts; do not uninstall first.

### 3. Generate a pairing code and scan it

After installing the gateway and restarting DSH Web, enable the gateway from this repository on the host and create a pairing code:

```bash
node scripts/setup-gateway.mjs enable
node scripts/setup-gateway.mjs pair --open
```

Or open DSH Web → **Mobile devices → Connection & pairing** (移动设备 → 连接与配对). The pairing code is
single-use and valid for five minutes by default. Open the app and scan it, or paste the payload manually.
Public endpoints must use `wss://`; the app rejects plain `ws://` for public addresses. Treat the QR code like
a password.

See the [User guide](docs/USER-GUIDE.md) for the full journey (LAN/tunnel, troubleshooting, multiple devices).

## Verified scope and limits

| Item | Status |
| --- | --- |
| APK-declared installation minimum | Android 7.0 / API 24; this does not establish coverage of every OS version or device |
| Android 16 device, earlier preview build | Verified: pairing, session list, text reply, hold-to-talk voice |
| `v0.1.0-alpha.5` APK | Published only after the release pipeline (CI, signed-APK emulator journey, independent download/signature checks) passes. Physical-device re-verification of alpha.5 is pending; the 2026-11-07 Android 16 journey belongs to an earlier build — see [validation status](docs/OPEN-SOURCE-READINESS.md) for what passed and what did not |
| iOS | Deferred; not verified |
| App stores | None; sideload the APK or use a development build |

- Versions must match: this release covers only DSH `0.2.1-rc.5` + gateway `0.12.0-rdv.3`; stop and ask for
  any other combination.
- The phone needs a reachable path to the host: same Wi-Fi, Quick Tunnel, a named Tunnel, or Tailscale. Quick
  Tunnel is best-effort and has no uptime guarantee.
- Voice needs the host-side provider to be ready. The address book needs a gateway with `rendezvous-v1` and the
  user's own Cloudflare account; recovery usually takes one to three minutes, and `workers.dev` may be affected
  by DNS pollution on some networks.
- The protocol and UI are still evolving; see [release validation status](docs/OPEN-SOURCE-READINESS.md) for
  the distinction between automated checks and physical-device evidence.

## Documentation map

| Document | Content |
| --- | --- |
| [User guide](docs/USER-GUIDE.md) / [使用说明（中文）](docs/USER-GUIDE.zh-CN.md) | Pairing, daily use, approvals, attachments, voice, offline behavior, troubleshooting |
| [Agent setup guide](docs/AGENT-SETUP.md) | Handoff contract for AI agents, safe/unsafe steps, human approval points |
| [`compatibility.json`](compatibility.json) / [Compatibility](docs/COMPATIBILITY.md) | Pinned versions, verified combination, runtime protocol checks |
| [Gateway maintenance](docs/GATEWAY-MAINTENANCE.md) | Maintained fork, upstream synchronization, version selection, joint verification and Agent constraints |
| [Release runbook](docs/RELEASING.md) | APK build, signing, download verification, failure handling |
| [Development and validation](docs/DEVELOPMENT.md) / [Design principles (Chinese)](docs/DESIGN.md) | Code responsibilities, test journeys, accessibility and interaction conventions |
| [Release validation status (Chinese)](docs/OPEN-SOURCE-READINESS.md) | Automated and device evidence, known limits and deferred scope |
| [Website](https://fatwhale.app/en/) / [Website repository](https://github.com/solla-h/dsh-mobile-site) | Product overview, downloads and setup entry points; independent website development and deployment |
| [Rendezvous design (Chinese)](docs/rendezvous-design.md) | Encryption and recovery for `rendezvous-v1` |
| [CONTRIBUTING](CONTRIBUTING.md) · [SECURITY](SECURITY.md) · [CHANGELOG](CHANGELOG.md) · [AGENTS](AGENTS.md) | Contributions, vulnerability reports, change log, repository conventions |

## Contributing

Node.js 22.13+ is required. Before submitting a change, run:

```bash
npm ci
npm test             # Jest: protocol, transport and app journeys
npm run test:node    # setup-script tests
npm run typecheck
npm run lint
npx expo-doctor
```

Keep protocol logic in `src/protocol/` as pure functions with tests; do not hand-edit the generated `android/`
or `ios/` directories. See [CONTRIBUTING.md](CONTRIBUTING.md) for more.

<details>
<summary>Development details: EAS, local builds, fake gateway</summary>

**EAS preview (optional)**

```bash
npm install
npx eas-cli login
npx eas-cli init --account <your-expo-account>
npx eas-cli build --platform android --profile preview
```

`preview` produces an installable APK; `preview-local` uses a local `credentials.json` and keystore (both
gitignored). After forking, run `npx eas-cli init --account <your-account> --force` to link your own project.

**Local native build**

```bash
npm install
npx expo run:android   # requires JDK 17+ and the Android SDK
```

`android/` and `ios/` are generated by Expo Continuous Native Generation; do not commit or edit them. Expo Go
is useful for UI work, but native behavior (camera, secure storage, audio, background reconnect) should be
verified in a development or preview build.

**Fake gateway without a DSH host**

```bash
node docs/tools/fake-gateway.mjs
# USB: adb reverse tcp:3999 tcp:3999, then open http://127.0.0.1:3999/pair?host=usb
# LAN: LAN_HOST=<your-lan-ip> node docs/tools/fake-gateway.mjs
#      then open http://<your-lan-ip>:3999/pair?host=lan
```

The fake supports `normal`, `no-ack`, `reject`, `no-hello`, `half-open`, `no-history`, and `no-create`; see the
file header. The app deliberately has no Expo Router: screens are rendered by the `App.tsx` state machine.
See [AGENTS.md](AGENTS.md) for the repository layout.

</details>

## Privacy and security

- Pairing tokens and device identity are stored in `expo-secure-store`, not in plain files.
- Public endpoints must use `wss://`; plain `ws://` is accepted only for private/LAN addresses.
- Session history, drafts, and attachment metadata are cached locally. Revoking a device in the gateway panel
  invalidates its token; the app stops reconnecting and asks for a new pairing.
- The app code contains no third-party analytics SDK; the gateway and Expo runtime may still produce their own
  logs.
- Address-book content is end-to-end encrypted between the gateway and each phone; the Worker stores ciphertext
  and request metadata only.
- Do not post a pairing QR, a gateway write secret, or a device token in public issues. Redact hostnames and
  account IDs from screenshots.

## License

The source code is MIT; see [LICENSE](LICENSE). The Expo template notice and the non-commercial pet assets are
in [NOTICE](NOTICE). The animated assets in `assets/pet/` are CC BY-NC-SA 4.0 and may not be used for
commercial purposes.

## Friends

- [LINUX DO](https://linux.do/) — an open, friendly Chinese-speaking developer community.
