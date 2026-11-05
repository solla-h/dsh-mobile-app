# DSH Mobile — User Guide

DSH Mobile is a phone client for a DeepSeek Harness (DSH) host. It does not run an agent on the phone; it
connects to a DSH host through the `dsh-plugin-mobile-gateway` plugin, so the host must be running and reachable.

This guide walks through the full user journey: pairing, daily use, approvals, attachments, voice, multiple
gateways, the optional address book, offline behavior, and troubleshooting.

> The app is experimental and not affiliated with DeepSeek or Expo. Pair it with a compatible gateway version.

## 1. Before you start

You need:

- A machine running DSH Web.
- `dsh-plugin-mobile-gateway` installed in the DSH profile that runs Web.
- A network path from the phone to the gateway:
  - the same Wi-Fi (LAN direct), or
  - a Cloudflare Quick Tunnel / named Tunnel, or
  - another reachable endpoint (for example Tailscale).
- The DSH Mobile app installed on the phone.

The gateway panel is the source of truth for connection status, paired devices, and the optional address book.

## 2. Pair the phone

### 2.1 Install and enable the gateway plugin

On the DSH host:

```bash
# upstream plugin
dsh plugin --profile web add dsh-plugin-mobile-gateway@latest

# or the fork release with the address book feature
dsh plugin --profile web add github:solla-h/dsh-plugin-mobile-gateway#v0.12.0-rdv.1
```

Restart DSH Web:

```bash
dsh web
```

Open the DSH Web UI → **Mobile devices → Connection & pairing** (移动设备 → 连接与配对), enable the gateway,
and choose how the phone should reach it. For a first test on the same Wi-Fi, LAN direct is the shortest path.
For use outside the LAN, enable a tunnel and wait until its public address is ready.

### 2.2 Generate a pairing code

Click the pairing button in the same panel. The panel shows a QR code and the pairing payload. If the host
provides the `dsh-pair` helper, it prints the same payload in the terminal; it is valid for five minutes by
default.

Pairing payloads contain a one-time device token. Do not screenshot or share a live QR code.

### 2.3 Scan or paste

1. Open DSH Mobile.
2. Tap **Scan pairing code** (扫码配对).
3. Grant camera permission when asked.
4. Point the camera at the QR code.

If the camera is unavailable or permission was denied, tap **Paste pairing payload manually** (手动粘贴配对串),
paste the text, and tap **Pair and connect** (配对并连接).

A pairing code can only be used once and expires after about five minutes. If it expires, generate a new one on
the host. Pairing succeeds only after the app receives a long-lived device token; the token is stored in the
phone's secure storage.

### 2.4 Add more devices or gateways

- Each phone pairs separately. Revoking one phone does not affect the others.
- To add another gateway: tap the gateway name at the top of the home screen → **Add gateway** (＋ 添加网关),
  then scan or paste.
- To switch: open the same menu and tap a saved gateway. Each gateway keeps its own session list, workspace
  selection, drafts, and outbox.
- To remove a gateway from the phone: open the menu → **Remove current gateway** (移除当前网关). This deletes the
  local record and token; it does **not** revoke the device on the server. Revoke the device in the gateway panel
  if you want the token invalidated.

## 3. The home screen

The bottom bar has four tabs:

| Tab | What it is for |
| --- | --- |
| **聚焦** (Focus) | What is running and what is waiting for you |
| **全部会话** (All sessions) | Every session, grouped by workspace |
| **定时任务** (Schedules) | Scheduled tasks created by the agent |
| **插件** (Plugins) | Gateway-side plugin management |

### 3.1 Focus

Focus shows up to four of your most recent sessions, ranked with sessions that need attention first: pending
approvals/questions, then running sessions, then recently active sessions. Each card shows the title,
directory, latest reply summary, and a badge for pending items or unsent messages.

- **Tap** a card to open the session.
- **Long-press** a card to speak a reply to that session. Keep holding, speak, then release to send.
- The workspace selector above the grid controls where **new** sessions are created. It does not move existing
  sessions. You can choose a registered workspace, the gateway's default directory, or create a `mobile`
  workspace under the host home directory.
- The voice orb below the grid starts a **new** session message: hold, speak, release. Swipe up while holding to
  cancel.
- Double-tapping the pet starts a new session. A horizontal swipe moves it out of the way.
- If voice is not available, the orb reports it instead of silently failing.

### 3.2 All sessions

- Search narrows the list to matching sessions.
- Sessions are grouped by workspace; archived sessions are hidden by default. Use the archived row at the
  bottom to show or hide them.
- Badges indicate a draft, queued messages, or pending items.
- Tap a session to open it. The overflow menu on a row offers **Rename**, **Archive/Unarchive**, and **Fork from
  the latest turn** (从最近一轮分叉).
- Unread markers are cleared when you open a session.

### 3.3 Schedules

The catalog is created by the agent using DSH's scheduling tools; the phone is primarily a read-only view.
Open an entry to see its schedule, prompt, status, and run history. Depending on what the gateway supports, you
can rename or delete an entry. Deleting a schedule does not recall messages that were already delivered.

### 3.4 Plugins

This tab manages plugins in the **DSH profile behind the gateway**, not plugins inside the phone app. You can
inspect the gateway's capabilities, browse the plugin catalog, install bundles, edit settings, enable/disable,
and uninstall.

Two cautions:

- Disabling or uninstalling `dsh-plugin-mobile-gateway` itself cuts the phone connection immediately. Recover it
  from DSH Web or the CLI on the host. The app marks the operation as “pending confirmation” rather than
  claiming success.
- Installing a plugin may require approving native builds for that specific package. Read the package names
  before approving; do not approve builds you do not recognize.

## 4. Working in a session

### 4.1 Streaming and trajectory

Responses stream into the conversation. Thinking blocks, tool calls, and tool outputs are grouped into
collapsible rows; tap a group to expand it. When a turn ends, the last user message is anchored near the top of
the viewport if you were already at the bottom, so you can read the answer without chasing the scroll.

You can scroll up freely while a response is streaming: the app only follows new output while you are at the
bottom.

### 4.2 Reading and copying

- Long-press text to select it and open the selection sheet.
- Code blocks and tool outputs can be copied; code blocks can also be quoted into the composer.
- Markdown renders headings, lists, tables, links, and fenced code. Very long tool output is truncated by the
  gateway and labeled as such.

### 4.3 Model, permission, and agent preset

The bar above the composer shows the current model and permission mode, and (when the gateway supports it) the
agent preset for the session. You can change them there.

- The available models and permission modes come from the host; the app does not invent them.
- An agent preset is usually **locked after the session's first turn**. The chip shows the lock. Create a new
  session to choose a different preset.
- Higher permission levels let the agent do more without asking. Use the lowest level that still works.

### 4.4 Commands, tasks, and goals

- Type `/` in the composer to open the command palette. Commands are supplied by the host and depend on the
  session and gateway version.
- A **Tasks** (任务) chip shows completed/total tasks for the current session; tap it to open the task sheet.
- A **Goal** (目标) chip appears when the session has a goal. Open it to pause, resume, or clear the goal. Goal
  edits use the revision the app last read; if another client changed it, the app refreshes instead of
  overwriting.
- A **Turns** (轮次) chip opens the turn outline; tap a turn to jump to it.

### 4.5 Sending while the agent is busy

When the agent is running, the composer offers two modes:

- **排队 (Queue)**: send after the current turn finishes.
- **插话 (Steer)**: insert into the current turn and take effect at the next model step.

Queued messages appear above the composer. You can edit or withdraw one before it starts. If the composer is
empty and a turn is running, the main button becomes a stop button; tap it to cancel the current turn.

### 4.6 Message delivery states

Each outgoing message has a state:

- **Sending** — waiting for the gateway receipt.
- **Queued** — accepted for a later turn, or waiting behind earlier queued messages.
- **Not confirmed** — the connection dropped before a receipt arrived. The app does not silently resend;
  retry or remove it.
- **Failed** — the gateway rejected it, or it could not be delivered. Retry, edit, or remove it from the
  message menu.

If you send while offline, text messages go to the outbox and are sent in order after reconnection. Attachments
cannot be sent offline: uploads are bound to the connection that created them.

## 5. Approvals and questions

DSH may pause a tool call for human approval, or ask the agent's question. Both appear inline in the
conversation and count toward the Focus badge.

### 5.1 Approvals

An approval card shows what is being requested: the command or tool, the target file, a diff when available,
the reason, and a risk label. Read the actual command, not just the summary.

- **Allow** / **Deny** sends your decision to the gateway.
- High-risk approvals replace the quick allow button with a **hold for about half a second** button. The fill
  and vibration confirm the hold.
- After you decide, a small undo pill appears for a few seconds. The decision is sent when the countdown ends;
  tap undo before that to withdraw it. If you leave the screen or the app goes to the background during the
  countdown, the decision is sent rather than lost.
- If the gateway no longer has the approval (it was withdrawn or answered elsewhere), the app tells you instead
  of pretending it succeeded.

Approvals cannot be decided offline. The app keeps the card visible and asks you to decide again after
reconnection.

### 5.2 Questions

A question card shows the agent's question and its options. Choose an option or type an answer. **Skip** sends
a cancellation to the agent and records no answer; use it when you do not want the agent to proceed on that
question.

### 5.3 Approvals raised while you were away

They remain on the gateway and appear when you open the session or refresh the Focus tab. The app does not
auto-approve anything. A voice reply on the Focus tab never approves an item: if the target session has pending
approvals or questions, the app opens the session and highlights the item so you can decide on the card.

## 6. Attachments

Tap **+** in the composer and choose:

- **Take photo** (拍照) — opens the camera.
- **Choose from library** (从相册选择) — opens the photo picker.
- **File** (文件) — opens the system file picker.

### 6.1 Images

- The gateway advertises its image limits. Defaults are 20 MB per image and 200 MB total per message; the
  maximum number of images per message also comes from the gateway.
- Images are compressed and resized before upload when needed; the app re-checks the resulting bytes.
- Images are attached to the message and sent together with the text.

### 6.2 Files

Files use the gateway's `file-upload-v1` flow: open, chunk, finish, then attach the upload receipt to the
message.

- The app's local limit is 24 MB per file. The gateway may allow much larger files, but the phone reads the
  file into memory for upload; 24 MB keeps that safe.
- The SHA-256 is computed and sent with the open request.
- The file is uploaded before the message is sent. If the upload fails, the message is not sent with a broken
  attachment.
- You must be online. Offline messages cannot carry files.

### 6.3 Downloading files

When a message contains a file card, tap it to download and open it. Downloads are resumable by offset and are
cached locally. If the gateway has file downloads disabled, the app does not draw a dead button.

## 7. Voice input

Voice appears only when the gateway exposes `speech-input-v1` **and** has a ready speech provider. “Voice not
enabled” (语音未启用) means no provider is ready — for example, the model has not finished downloading — not
necessarily that the gateway disabled the feature.

### 7.1 In a conversation

- Hold the microphone button, speak, and release. The transcript is sent as a message.
- Swipe up while holding to cancel the recording.
- If the recording reaches the provider's limit, recording stops automatically and the transcript is placed in
  the composer instead of being sent half a sentence. Edit it, then send.
- While a hold is being transcribed, the app shows a transcribing state; wait for it to finish before starting
  another hold.
- A tap that is too short is ignored with a hint, so a stray tap does not send an empty message.

### 7.2 On Focus

- **Hold the voice orb** to start a new session message; release sends it.
- **Long-press a Focus card** to speak a reply to that session.
- Swipe up to cancel. The same recording limit applies.
- The result is not used to approve or answer a pending item. The app opens the item for you.

Voice audio is sent to the gateway's speech provider configured on the host. The phone does not run speech
recognition locally.

## 8. Multiple gateways and changing addresses

### 8.1 Multiple gateways

Each saved gateway has its own:

- device token and gateway identity,
- session list cache,
- workspace selection,
- drafts and outbox.

Switching gateways clears the previous gateway's in-memory session state before connecting the next one. A
queued message is only sent to the gateway that owns it.

### 8.2 When the gateway address changes

Quick Tunnel URLs and LAN IP addresses can change when the tunnel restarts or the host moves networks.

- If the app is connected when the gateway pushes a config change, it adopts the new address automatically.
- If the app cannot connect, it retries. Without an address book, you must generate a new QR code and pair
  again after the public URL changes.
- With the optional address book, the app fetches the latest encrypted address and retries without a new scan.

A change of `gatewayId` is different from a change of address. The app treats a different gateway identity as a
conflict and asks for a new scan; it will not silently adopt a different gateway.

## 9. Address book (optional)

The address book is for one problem: you paired once, the gateway's public address changed, and you do not want
to walk back to the host to scan a new QR code.

### 9.1 Enable it on the gateway

1. Open DSH Web → **Mobile devices → Connection & pairing → Address book** (地址簿 · 免重扫).
2. Click **Enable address book** (启用地址簿).
3. Follow the Cloudflare device login: open the printed URL or scan the login QR and authorize the account.
   A free Cloudflare account is enough.
4. The plugin deploys a Worker and stores the write secret on the host. The panel shows the deployment log and
   the resulting Worker address.

The plugin uses `npx -y wrangler@<version>`, so a global `wrangler` install is not required. The first deploy
downloads Wrangler and may take a while.

### 9.2 What the phone receives

After pairing, an authenticated connection receives the address-book configuration and a per-device key. The
gateway publishes its current endpoint list encrypted with AES-256-GCM. The Worker stores ciphertext only.

When the app cannot connect, it queries the Worker, decrypts the latest record with the device key, and retries
the new address. Recovery typically takes one to three minutes, not seconds. The app keeps retrying while it
is open.

One Worker belongs to one gateway. If you run DSH on several machines, pair each gateway separately; each can
have its own address book. The address book does not combine several hosts into one pairing.

### 9.3 Disable, re-enable, or use an existing Worker

- **Disable** (停用地址簿) stops publishing. The panel offers an option to delete the Worker from Cloudflare as
  well; deleting is irreversible. If you keep the Worker, the host keeps the write secret and re-enabling can
  reuse the same address.
- Re-enabling without deleting reuses the retained Worker.
- If you already have a Worker, expand **Use an existing Worker** (使用已有 Worker), enter its address and write
  secret, and connect. Switching between manual and managed configuration is adopted by the phone over the
  authenticated connection.

### 9.4 Authentication and privacy

- The Worker URL is public, but the records are encrypted. Cloudflare can see request metadata (path, IP, time,
  ciphertext length), not the endpoint or the device key.
- The write secret stays on the host; the read key is delivered only to paired devices over an authenticated
  connection.
- Revoking a device removes its address-book record.
- If `workers.dev` is unreachable from your network (this can happen in mainland China or with some VPN/DNS
  setups), use a custom domain, a named Tunnel, or Tailscale. The address book is optional; the core app does
  not depend on it.

## 10. Offline and reconnection

- The session list is cached per gateway, so a cold start with no network still shows the last known list. A
  gateway that has never been paired shows the pairing screen instead.
- Drafts are saved locally. Leaving a session does not discard what you typed.
- Text messages written while offline enter the outbox and are sent in order after reconnection. A message
  that was already in flight when the connection dropped may show **Not confirmed**; retry it manually.
- File uploads and approval decisions require a live connection. They are not queued.
- The app reconnects automatically. If the top banner says the connection is down, tap the hint to retry
  immediately. In the background, the app suspends timers; on return it probes the connection and reconnects if
  needed.
- A revoked or expired device token stops automatic reconnection and asks for a new pairing.

## 11. Security and privacy

- Pairing tokens and device identity are stored with `expo-secure-store`.
- Public endpoints must use `wss://`. The app rejects a public plaintext `ws://` endpoint in a pairing payload,
  because the token would travel in the clear.
- Session history, drafts, attachment metadata, and downloaded files are cached on the phone. Anyone with
  unlocked access to the phone can read the app's cached data.
- The app has no third-party analytics SDK. The gateway, DSH host, Cloudflare, and Expo runtime may keep their
  own logs; review those separately.
- To cut a lost phone off: revoke its device in the gateway panel. Removing the gateway on another phone does
  not revoke the lost phone.

## 12. Limits

| Item | Limit |
| --- | --- |
| Pairing payload | About 5 minutes, one use |
| File upload | 24 MB per file (local app limit) |
| Image | 20 MB per image, 200 MB per message (gateway defaults; count also gateway-defined) |
| Voice recording | Provider-defined, often around 2 minutes |
| Offline file send | Not supported |
| Address book recovery | Typically 1–3 minutes |
| Address book retry | Depends on the Worker and the phone network |

## 13. Troubleshooting

### The QR code is rejected

- The code may have expired; generate a new one.
- Make sure you are scanning the pairing code, not a generic URL.
- If the phone's camera cannot focus, use manual paste instead.

### The app connects but immediately drops

- Check that the host is still running `dsh web` and the gateway is enabled.
- Quick Tunnel can take a few seconds to become ready; wait and retry.
- A VPN or DNS proxy may break `workers.dev` or the tunnel hostname. Try another network.
- In the app, tap the connection hint to retry; otherwise wait for the automatic backoff.

### The address book does not recover the gateway

- Confirm the gateway panel shows the address book as configured and publishing successfully.
- Wait up to a few minutes; recovery is not instant.
- Check whether the Worker URL is reachable from the phone's browser. If not, use a custom domain or another
  tunnel.
- If the gateway identity changed (not just its address), the app shows a conflict and requires a new scan.

### “Voice not enabled” appears

- The gateway has no ready speech provider. On the host, check the speech plugin and model download state.
- The capability may exist while the model is still `unprepared`; the app requires a ready/standby provider.

### A message is stuck at “Not confirmed”

- The connection dropped before the gateway receipt arrived. Retry from the message menu; do not assume it was
  delivered.
- If you are offline, wait for reconnection and then retry.

### An attachment fails

- Check the size: 24 MB for files; 20 MB per image and 200 MB per message by default.
- Make sure the connection is live; offline file sends are rejected.
- If the gateway rejects the upload, check the gateway's file-upload settings.

### The Plugins tab disconnects after an operation

If you disabled or uninstalled the mobile gateway itself, the phone cannot reconnect by design. Restore the
plugin from DSH Web or the CLI on the host, then pair again if the device token was invalidated.

## 14. Removing the app and revoking access

1. Revoke the phone in the gateway panel if you no longer trust it.
2. On the phone, remove the gateway from the top-bar menu to delete local state.
3. Uninstall the app.
4. If you enabled the address book and no longer need it, disable it on the gateway. Deleting the Worker is
   optional and irreversible.

## 15. Getting help

When reporting a problem, include:

- app version and build type (preview APK / development build),
- gateway plugin version,
- DSH version,
- the exact step and what you expected,
- whether the phone was on Wi-Fi, cellular, or a VPN.

Do not include pairing QR codes, device tokens, gateway write secrets, or unredacted screenshots of private
sessions.
