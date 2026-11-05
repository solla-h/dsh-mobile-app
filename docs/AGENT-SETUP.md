# DSH Agent Setup Guide

This page is written for a **DSH agent** that has shell access to the machine running DSH Web, when the user
asks it to “install the mobile gateway from this repository”.

The agent can install the plugin, restart DSH Web, enable the gateway, and prepare a pairing payload. It cannot
scan the phone's camera or complete a Cloudflare browser login. Those are human steps.

## What the agent can and cannot do

The agent can:

- install `dsh-plugin-mobile-gateway` into the `web` profile;
- restart DSH Web when it has permission to do so;
- enable the gateway and verify its local status;
- choose a reachable endpoint and create a pairing payload;
- verify that the phone appears as a trusted device after the user scans or pastes the payload.

The agent cannot:

- approve the phone's camera permission or scan the QR code for the user;
- complete Cloudflare device authorization for the optional address book;
- expose ports or change firewall rules without the user's explicit approval;
- safely restart DSH Web if that would kill the agent's own session without a supervisor.

If a step requires sudo, a browser authorization, a firewall change, or a restart that would terminate the
agent, stop and ask the user.

## Recommended user prompt

Give the agent the repository path (or a URL to this file), then use a prompt like:

```text
请先阅读仓库里的 docs/AGENT-SETUP.md，然后按其中的步骤在这台机器上安装并启用
dsh-plugin-mobile-gateway。

先做 Step 0 的检查。任何需要 sudo、重启 dsh web、开放端口、Cloudflare 登录/隧道、
批准原生构建的步骤，都先停下来告诉我你要执行什么。

不要打印或保存配对 token；不要把 3080/3081 暴露到公网。完成后告诉我：
手机应该扫码，还是复制哪段 pairing payload。
```

## Step 0 — inspect the host

Run these first; do not install blindly:

```bash
dsh --version
dsh plugin --profile web list
curl -s http://127.0.0.1:3080/mgw/status
```

Interpretation:

- `dsh` missing: DSH is not installed for this shell. Stop and ask the user for the correct host/shell.
- `dsh plugin ... list` does not show the plugin: install it in Step 1.
- `/mgw/status` returns JSON: the gateway is installed and loaded; skip the installation, go to Step 2.
- `/mgw/status` returns 404: the plugin is not loaded; install and restart.

Check for an existing DSH Web process before starting another one:

```bash
# Linux
ss -ltnp | grep -E ':(3080|3081)\b' || true

# macOS
lsof -nP -iTCP:3080 -iTCP:3081 -sTCP:LISTEN || true

# Windows PowerShell
Get-NetTCPConnection -State Listen -LocalPort 3080,3081 -ErrorAction SilentlyContinue
```

If `3080` is already in use, use that instance. Do not start a second `dsh web`.

## Step 1 — install the plugin and restart Web

Use the upstream plugin for the core gateway:

```bash
dsh plugin --profile web add dsh-plugin-mobile-gateway@latest
```

Use the fork only when the user wants the optional address book:

```bash
dsh plugin --profile web add github:solla-h/dsh-plugin-mobile-gateway#v0.12.0-rdv.1
```

The plugin must be loaded by DSH Web. Restart it using the mechanism already in place:

- If DSH Web is a system service, restart that unit (for example `sudo systemctl restart dsh-web`), but only
  after confirming the unit exists and the user allows sudo.
- If the user launched `dsh web` in a terminal, ask the user to stop and restart it. Do not kill a process that
  is hosting your own session.
- Do not run a second `dsh web` while one is listening on 3080.

Verify after restart:

```bash
curl -s http://127.0.0.1:3080/mgw/status
```

The response must include a `version` and `gatewayId`. If it returns 404, the plugin is not loaded; check the
profile name and the restart.

## Step 2 — enable the gateway

The management API is loopback-only and requires no extra token when called from the DSH host. Do not expose
`/mgw` or port `3081` to the public internet.

```bash
curl -s -X POST http://127.0.0.1:3080/mgw/gateway \
  -H 'content-type: application/json' \
  -d '{"mode":"persistent"}'
```

`mode` may be `persistent`, `temporary`, or `disabled`. Use `persistent` for normal use and `temporary` for a
short test.

Verify:

```bash
curl -s http://127.0.0.1:3080/mgw/status
```

Look for `"gatewayEnabled": true` and `"lan": {"listening": true, "port": 3081, ...}`.

## Step 3 — choose a phone-reachable endpoint

The app requires:

- a private/LAN address or Tailscale address for `ws://`;
- `wss://` for a public address.

A public IP with plain `ws://` is rejected by design. Do not work around that by disabling the check.

### Same LAN

Find a private address of the DSH host reachable from the phone:

```bash
# Linux
hostname -I
ip -4 addr

# macOS
ipconfig getifaddr en0
ipconfig getifaddr en1
```

Use an address in a private range such as `10.0.0.0/8`, `172.16.0.0/12`, or `192.168.0.0/16`:

```text
ws://<private-lan-ip>:3081/ws/mobile
```

If the host only has a public address, or the phone and host are on different networks, do not use `ws://`.
Use a Cloudflare tunnel or Tailscale WSS/private endpoint instead.

### Public access

For a remote phone, use the gateway's public route:

```text
wss://<public-host>/ws/mobile
```

The agent must not enable a Cloudflare Quick Tunnel or named Tunnel without the user's approval. A Quick Tunnel
creates a public URL; a named Tunnel requires the user's Cloudflare configuration. Ask first.

## Step 4 — create the pairing payload

Preferred path for a human at the DSH Web UI:

1. Ask the user to open **Mobile devices → Connection & pairing**.
2. Enable the gateway if it is not already enabled.
3. Generate the pairing QR code and scan it with the phone.

If the user wants a payload for manual paste, or cannot use the QR panel, create one from the host:

```bash
curl -s -X POST http://127.0.0.1:3080/mgw/pair \
  -H 'content-type: application/json' \
  -d '{"publicUrl":"ws://<private-lan-ip>:3081/ws/mobile"}'
```

The response contains:

- `payload` — the decoded pairing object;
- `qrPayload` — the Base64URL string accepted by the app's **手动粘贴配对串** / manual paste path;
- `svg` — a QR image if the agent can display it.

The payload is single-use and expires in five minutes by default. Treat it like a password: do not paste it into
a public issue, log, or screenshot.

After the user pairs, verify:

```bash
curl -s http://127.0.0.1:3080/mgw/devices
```

The new device should be listed; the gateway panel should show it as online after the app connects.

## Optional — address book

The address book is optional and needs a Cloudflare account. It cannot be completed by an agent alone:

1. The user opens **Mobile devices → Connection & pairing → Address book**.
2. The user completes the Cloudflare device login in a browser.
3. The plugin deploys the Worker and stores the write secret on the host.

Do not run `wrangler login` in the agent shell unless the user explicitly asks. It is an interactive
authorization and must be visible to the user. After the user enables it, the agent may check:

```bash
curl -s http://127.0.0.1:3080/mgw/rendezvous
```

Do not print the write secret or any pairing token.

## Failure branches

| Symptom | What to do |
| --- | --- |
| `/mgw/status` 404 | Plugin not loaded. Check the `web` profile and restart DSH Web. |
| `3080` already in use | Use the existing DSH Web process; do not start another one. |
| `publicUrl must use wss://` | The host IP is public or the phone is remote. Use a private LAN/Tailscale `ws://` or a `wss://` tunnel. |
| Plugin installed but no Mobile devices panel | Restart DSH Web and check the profile's bundle list. |
| Voice plugins disabled after upgrading DSH | Optional. The core gateway works; fix speech compatibility separately only if the user asks. |
| Cloudflare authorization requested | Stop and hand the browser step to the user. |

## Safety rules

- Never expose `3080`, `3081`, or `/mgw` to the public internet.
- Never print pairing codes, device tokens, write secrets, or private keys in chat or logs.
- Never change firewall rules, system services, or SSH configuration without explicit approval.
- Never disable device authentication to “make pairing easier”.
- Do not uninstall or disable other plugins while setting up the gateway.
- If a command would restart the DSH process running the agent, stop and ask the user.
