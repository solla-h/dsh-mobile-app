# AGENTS

This file is for **developing the app**. If you are a DSH agent asked to install or configure the
mobile gateway on a host, stop here and use [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md) plus
[`compatibility.json`](compatibility.json) instead.

## Project snapshot

- Expo SDK 58 (`expo ~58.0.23`), React Native 0.88.1, React 19.3.0, TypeScript ~6.0.3.
  Node.js 22.13+ and npm.
- **No Expo Router.** `App.tsx` is a single state-driven navigator: unpaired → session list →
  session screen. Do not add routes, `_layout.tsx` files, or template navigation advice.
- The app is an Android-first public alpha. iOS is deferred and unverified. The UI ships in Chinese and
  English: `src/i18n/keys.ts` holds the Chinese key set and `src/i18n/en.ts` the English dictionary; with no
  saved preference the app follows the system locale (non-Chinese → English). Chinese and English READMEs are
  still maintained separately.
- The server is the DSH Mobile maintained fork of the third-party plugin
  [`solla-h/dsh-plugin-mobile-gateway`](https://github.com/solla-h/dsh-plugin-mobile-gateway)
  (protocol `dsh-mobile-v1`). Its upstream is `Clarklevis1995/dsh-plugin-mobile-gateway`.
  Install the exact GitHub tag in `compatibility.json`; the upstream npm package is a different release line.
- Version lock: the app release is bound to the exact combination in
  [`compatibility.json`](compatibility.json). Currently DSH `0.2.1-rc.5`, gateway `0.12.0-rdv.3`,
  protocol v3, voice bundle `0.2.1-rc.5`. Never use `@latest` as a default, and never mix a local
  checkout into a release test.
- Gateway checkout, tagged package and installed process can differ. Verify the actual installed package
  and fully restarted host when behavior matters; source inspection alone is not deployment evidence.
- Expo/React Native APIs change every SDK release. Before writing code that touches Expo, EAS, or
  React Native, read the versioned docs for the installed major:
  `https://docs.expo.dev/versions/v58.0.0/` and
  `https://reactnative.dev/docs/0.88/getting-started-without-a-framework`. Do not answer from memory.

## Working agreement

- **Align before non-trivial work.** Describe the approach and get confirmation before a
  non-trivial edit, and keep the change inside that agreed scope. Do not add abstractions, flags or
  config for a case that does not exist yet — reuse what is already here (see
  **Engineering invariants**) or say why that does not fit.
- **Verify through the user journey, and grade the evidence.** The path to walk, the actions to
  enumerate (success, failure, cancel, leaving midway) and the three levels — source/test
  confirmed, real-device observed, still a hypothesis — are in **Testing and evidence**. Never
  write a real-device or "verified" claim that was not actually run.
- **Finish with the full check set.** `npm test`, `npm run typecheck`, `npm run lint`; add
  `npx expo-doctor` when dependencies or app config change. A docs-only change needs the
  relative-link check instead of a device run (see **Commands**).
- **Route new UI text through `tr()`** with the Chinese text as the key; regenerate dictionaries via
  `node scripts/i18n-extract.mjs && node scripts/i18n-build-dict.mjs` — `satisfies` makes a missing
  English key a typecheck error.
- **This repository is public.** Never put host names, account IDs, worker or tunnel URLs, pairing
  payloads, tokens, gateway or device identifiers, private session content, or screenshots
  containing any of those into the tree — code, tests, fixtures, docs, release assets, commit
  messages, or issue/PR text. Keep collaboration notes, status diaries and private host records
  out of the repository; a capability or decision belongs in tracked documentation (for example
  [docs/ROADMAP.md](docs/ROADMAP.md)) without the private context around it.

## Gateway coordination

- Read [Gateway maintenance](docs/GATEWAY-MAINTENANCE.md) before changing the recommended backend,
  setup checks, wire protocol or gateway-dependent behavior. In the gateway repository, read its own
  `AGENTS.md` and maintainer guide; this app repository does not own gateway runtime code.
- Keep `compatibility.json` as the app's recommendation source. Upstream updates and gateway `main`
  are candidates until the exact release package has passed the documented compatibility journey.
- Review upstream changes in a separate PR; never silently upgrade DSH or voice while syncing the fork.
  Equal protocol numbers do not prove equal host/plugin compatibility.
- Preserve package/plugin identity, saved pairing, gateway identity and rendezvous state during upgrades.
  Do not install the upstream and maintained gateway together or rewrite a released tag.
- Update Chinese/English setup docs with source/version changes. Keep prior real-device evidence attached
  to its original build; app fixture tests and gateway package tests do not establish a real-host journey.

## Actual structure

```
App.tsx                   gateway pairing, session list, multi-gateway switch, global pending work
src/protocol/             pure functions: frames -> app models (unit-testable; no react-native imports)
src/transport/            WebSocket client, file upload/download, offline outbox
src/storage/              SecureStore / FileSystem persistence (gateways, drafts, state)
src/i18n/                 zh/en dictionaries, tr(), LanguageProvider (Chinese text is the key)
src/ui/                   screens and components
src/theme/                color, type, and motion tokens
app.json                  Expo config and config plugins (native dirs are generated)
docs/                     user, setup, compatibility, development, and historical records
```

Keep non-route code out of `App.tsx` when a smaller module already fits. Reuse the existing state
machine, storage helpers, and transport abstractions before adding a flag or a branch.

## Commands

```bash
npm ci
npm start                 # Expo dev server
npm test                  # Jest: protocol, transport, pure UI logic
npm run test:node         # setup-script tests
npm run test:all
npm run typecheck
npm run lint
npx expo-doctor
npx expo install <pkg>    # always use this for native dependencies
```

Run Jest, typecheck, and lint before declaring a code task done. Run `expo-doctor` when dependencies
or app config change. Docs-only changes need a relative-link check instead of a device run.

## Release rules

Official Android APKs use [`.github/workflows/android-release.yml`](.github/workflows/android-release.yml):

```
quality checks -> Expo prebuild -> Gradle on ubuntu-24.04 -> sign/verify -> signed APK journey -> draft Release -> publish
```

- This public-repository path does **not** use EAS cloud quota or an Expo token. EAS projects in the
  README are an optional personal preview path only; do not describe EAS as the official release
  mechanism.
- Signing secrets belong only to the `android-release` environment. Never commit, print, or copy them.
- The release tag must point at a commit already merged to `master`. Never move a published release
  tag or replace its assets.
- Increase `expo.android.versionCode` in `app.json` for each new APK release.
- `android/` and `ios/` are generated by Continuous Native Generation and are untracked. Never edit
  them by hand; configure native behavior in `app.json` and config plugins.

## Protocol constraints (`dsh-mobile-v1`)

Read the gateway's `PROTOCOL.md` and `lib/index.mjs` before guessing a frame name or field. These
are the constraints that have already caused bugs:

- A connection with `X-DSH-Channel: conversation` accepts only
  `message`/`history`/`subscribe`/`unsubscribe`. `tasks`/`goal`/`fork`/`agent-presets`/
  `session-agent-preset` are **control-only**. This app's session connection is legacy (no channel
  header), so it can send both; do not add the channel header casually.
- `goal` responses are double-nested: `goal.goal.{id,revision,...}`. Write responses do not echo
  `sessionId`/`requestId`; re-query the whole goal to get the new revision.
- `ref.revision` must be a positive integer. If no valid revision can be read, treat the goal as
  absent (`mapGoal` already implements this).
- `fork` with `atSeq` must also send `historyFormatVersion: 4`, otherwise it returns
  `history-format-mismatch`. The response `sessionId` is the **new** session's id.
- File-download `offset` is **decoded** bytes. Next page = server offset + base64-decoded length.
- `agent-preset` becomes `locked` after a session completes one turn; it never unlocks.
- `assistant-stream` start/end pairs are **per model step**, not per turn. The turn boundary is only
  the `turn/end` event.
- `rendezvous-config` has two forms: request/response carries `requestId`; a config-change push does
  **not**. Accept both. Otherwise a Worker switch or redeploy waits for the next reconnect, or gets
  stuck if the old Worker is gone.
- Under the same `gatewayId`, a URL/key change is a normal migration (manual ↔ managed, disable and
  re-enable, redeploy). Update the config and clear `seenRev`; reject only when `gatewayId` does not
  match the pairing record.
- A managed Worker's name derives from the gateway state's `deploySalt` + `gatewayId` (16 hex).
  Disable-with-retention keeps the file but sets `active:false`; `configured` checks `active`, not
  “the state file exists”.
- `file-upload-v1` is open → chunk → finish, then `message.files:[{receiptId}]`. Chunks must be a
  multiple of 4 bytes; the final chunk has `=` padding. Accumulate the offset from decoded bytes
  (`decodedBytesOf()`), never `chars/4*3`. Uploads are bound to the connection that created them, so
  files cannot be sent offline. Local cap: 24 MB.
- App “voice not enabled” means `hasReadyProvider()` returned false (`available` with no
  `ready`/`standby` provider). Inspect `speech-catalog.providers[].preparation.phase`; the phase is
  under `preparation`, not the provider root.

## Engineering invariants

- **Single state-driven navigator.** `App.tsx` owns pairing, the active gateway, the session list,
  running state, and global pending work. Keep callback identities stable; do not split navigation
  into a router without an approved design.
- **The session screen unmounts only when no session is selected.** Render on `active`, not
  `connected && active`. Unmounting on disconnect loses history, drafts, attachments, and scroll
  position, and drops the user back to the pairing page.
- After a gateway has been paired (`saved`), never show the pairing page again. On disconnect, stay
  on the list with a tappable reconnect hint.
- While the app is backgrounded, JS timers stop and `lastFrameAt` freezes. On foreground,
  `GatewayClient.watchForeground()` resets the baseline and sends a ping; otherwise a healthy
  connection is declared dead on the first heartbeat.
- The Android config plugin permits app-wide cleartext traffic so private LAN/Tailscale/USB
  `ws://` gateways work. `isPairingUrlAllowed` enforces the gateway endpoint restriction; preserve
  its rejection of public cleartext addresses. Keep the generated-manifest regression check.
- Offline sends go to the persisted `outbox` and flush in order after `ready`. File sends are
  online-only because the receipt is bound to the connection.
- Cache sessions per gateway (`sessions-<gatewayId>.json`). Cold start reads the cache before
  connecting so an offline list never becomes a QR page.
- **Never use `scrollToEnd` to pin chat to the bottom.** Use
  `scrollToOffset({ offset: <height measured this pass> })`; native clamps overshoot. Follow only
  while pinned, and on `turn/end` while pinned anchor the last user message to the first visible row.
- Plugin management uses the control connection and correlates by `requestId`, not frame kind.
  Never auto-approve `pendingBuilds`. Disabling or uninstalling `dsh-plugin-mobile-gateway` cuts the
  current connection: warn first and mark the result “pending reconnect confirmation”.
- Keep the render path free of expensive work per streamed token; reuse the existing batching and
  memoized row components.

Detailed real-device recipes, local gateway setup, approval probes, plugin UI notes, and gesture
gotchas are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Testing and evidence

Pure logic in `src/protocol/` gets a unit test. UI and connection changes need a user-journey check,
not an isolated component tap:

1. Describe the real situation: why the user opens the app, in what state (offline, backgrounded,
   new approval, just paired, …).
2. Walk the actual path from launch: pairing/cold start → list → session → the target action.
3. Enumerate the actions on that path: success, failure, cancel, leaving midway. Check each.
4. Walk the exit: what the user does next, how they return to the list/home, how they quit. There
   must be no dead end.
5. Record flow interruptions, thumb travel, and operation complexity.

Grade every conclusion as **source/test confirmed**, **real-device observed**, or **still a
hypothesis**. Do not claim a real-device run, screenshot, or completed refactor that did not happen.
The fake gateway (`docs/tools/fake-gateway.mjs`) can deterministically produce `no-ack`,
`no-hello`, `half-open`, `no-history`, and `no-create`; use it for slow or silent windows.

## Documentation map

Current install, compatibility, and user documents:

- [README](README.md) / [README.en](README.en.md) / [README.zh-CN](README.zh-CN.md)
- [User guide](docs/USER-GUIDE.md) / [使用说明](docs/USER-GUIDE.zh-CN.md)
- [Agent setup](docs/AGENT-SETUP.md) and [`compatibility.json`](compatibility.json)
- [Compatibility](docs/COMPATIBILITY.md), [gateway maintenance](docs/GATEWAY-MAINTENANCE.md), and [releasing](docs/RELEASING.md)

Development references:

- [Development and real-device notes](docs/DEVELOPMENT.md)
- [i18n and terminology (Chinese)](docs/i18n/README.md) — dictionary shape, official term table, version basis, and test evidence
- [Protocol coverage (Chinese)](docs/protocol-coverage.md) and [Rendezvous design (Chinese)](docs/rendezvous-design.md)
- [Design principles (Chinese)](docs/DESIGN.md) and [release validation status (Chinese)](docs/OPEN-SOURCE-READINESS.md)
- [Roadmap and candidate pool (Chinese)](docs/ROADMAP.md) — planned, half-done, and deliberately-not-done capabilities

Public documentation records current contracts and reproducible procedures. Keep raw agent prompts,
collaboration notes, status diaries, private host records, and obsolete design drafts outside this repository.

Contribution and security:

- [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md)
