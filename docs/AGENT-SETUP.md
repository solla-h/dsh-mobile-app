# DSH Agent Setup Guide

This page is written for a **DSH agent** that has shell access to the machine running DSH Web, when the user
asks it to “install the mobile gateway from this repository”.

The setup surface is one script, [`scripts/setup-gateway.mjs`](../scripts/setup-gateway.mjs). The agent runs the
read-only `check` and `handoff` steps plus the safe `enable`/`pair` steps; the user runs `install` and `voice` in a
normal shell. This split is intentional: installing a bundle into a running Web process hot-reloads the plugin
tree and can leave `sessionController` unavailable until the OS process is restarted.

## Handoff first — make the remaining steps survive the stop

**Do not give the user a bare “stop DSH Web” command as the first step.** The DSH Web session is where the agent
is running; once it stops, the chat UI disappears and the user cannot see the rest of your instructions. That
happened in a real test: the user ran `Stop-Process`, came back, and could not find the next command.

Before any stop, run:

```bash
node scripts/setup-gateway.mjs handoff --voice   # or --no-voice
```

It writes `DSH-MOBILE-NEXT-STEPS.md` and prints the absolute one-command path. Give the user that file path **and**
the command in a copyable block. The one-command is:

```bash
node "/absolute/path/to/scripts/setup-gateway.mjs" install --yes --stop-web --restart-web \
  --tunnel quick --pair --open
```

What it does: captures how DSH Web was started → stops the whole process tree → installs the pinned gateway →
optionally installs voice and the model → restarts DSH Web in the background → enables the gateway → starts a
Quick Tunnel and waits for the public endpoint → writes and opens the pairing page. The user only scans the QR.

Tell the user:

- run it **in a normal terminal, not inside the DSH Web session**;
- run it from the directory where they normally start `dsh web` (on Windows the script cannot read the old
  process's working directory; on Linux it reads `/proc` and systemd, so this is automatic);
- after it restarts, the original DSH session is still in the session list — reopen it; do not start a new task;
- if restart fails, the script prints the restart log path; start DSH Web normally, then run
  `enable --tunnel quick --pair`.

If the user prefers the manual path, still give them the complete `NEXT-STEPS.md` before the stop command. Never
put the stop before the install command.

## Version lock — read this first

This app release is bound to the exact gateway plugin, DSH, and optional voice bundle versions in
[`compatibility.json`](../compatibility.json) (human explanation: [COMPATIBILITY.md](COMPATIBILITY.md)).
Use only the `recommended` versions. Do not use `@latest`, a local git checkout, a `link:` dependency, or a
profile backup — even if one exists on the host. If the host's DSH or plugin version differs, stop and ask;
do not auto-upgrade either side.

The gateway's `hello` advertises the protocol number and a build-time DSH version, but not the plugin version;
the app only enforces the protocol. The checker below verifies the profile spec, the **installed package**
version under `node_modules`, and the actual DSH (`dsh --version`).

## Use the setup script

From a clone of this repository:

```bash
node scripts/setup-gateway.mjs check
```

If the agent does not have a clone, download the three files the script needs into a temporary directory:

```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/scripts"
curl -fsSL https://raw.githubusercontent.com/solla-h/dsh-mobile-app/master/compatibility.json \
  -o "$tmp/compatibility.json"
curl -fsSL https://raw.githubusercontent.com/solla-h/dsh-mobile-app/master/scripts/check-compat.mjs \
  -o "$tmp/scripts/check-compat.mjs"
curl -fsSL https://raw.githubusercontent.com/solla-h/dsh-mobile-app/master/scripts/setup-gateway.mjs \
  -o "$tmp/scripts/setup-gateway.mjs"
node "$tmp/scripts/setup-gateway.mjs" check
```

On Windows PowerShell, use `$env:TEMP` and `Invoke-WebRequest` instead of `mktemp`/`curl`.

The script must stay inside the temporary directory; do not copy it into `~/.dsh/profiles` or edit the profile
by hand.

## What the agent can and cannot do

The agent can:

- run `check` (read-only) and report its exact output;
- run `handoff` (writes one local Markdown file + prints the command; it does not stop anything) **before** the
  user stops DSH Web;
- run `enable` after the user has restarted DSH Web;
- run `pair` after the gateway is enabled. `pair` writes a local QR page and prints only its path and expiry;
  it never prints the pairing payload.

The agent cannot:

- run `install` or `voice` while DSH Web is hosting the agent. The script refuses while port 3080 is listening
  unless `--stop-web` is given; the agent must not try to work around the refusal or run the one-command itself;
- approve the phone's camera permission or scan the QR code for the user;
- complete Cloudflare device authorization for the optional address book;
- expose ports or change firewall rules without the user's explicit approval;
- read `docs/HANDOFF.md`, `docs/STATUS-*`, `docs/BACKLOG.md`, `docs/RISK-PATCHES.md`, `docs/home-*`,
  `credentials.json`, `keys/`, `.scratch/`, profile backups, or DSH logs. They are internal engineering
  notes, not part of the setup surface.

## Recommended user prompt

Give the agent the repository path (or a URL to this file), then use a prompt like:

```text
请先阅读仓库里的 docs/AGENT-SETUP.md 和 compatibility.json，然后只运行：
node scripts/setup-gateway.mjs check
不要运行 install 或 voice，不要直接运行 dsh plugin add，不要修改 profile / cordis.patch.yml，
不要克隆或使用本机的网关源码 checkout，也不要使用 @latest 或 Web 插件面板。
不要读 docs/HANDOFF.md、docs/STATUS-*、docs/BACKLOG.md、docs/RISK-PATCHES.md、docs/home-*、
credentials.json、keys/、.scratch/、profile 备份或 DSH 日志。

如果需要安装网关，先运行 handoff（--voice 或 --no-voice），把生成的 DSH-MOBILE-NEXT-STEPS.md
和里面那条 install --stop-web --restart-web --tunnel quick --pair 命令给我；不要先把停 DSH Web
的命令发给我。install/voice 由我在普通终端里执行。
check 通过后，如需启用网关，运行 enable；需要配对时运行 pair --open，只把二维码页面的本地路径告诉我，
不要把二维码内容、pairing token 或设备 ID 打印到聊天里。
如果 check 报版本不匹配或需要重启 DSH Web，停下来把 install/voice 交给我在普通终端里执行。
不要为了绕过沙箱去申请 danger-full-access，也不要把 3080/3081 暴露到公网。
```

## Step 0 — inspect the host

Run:

```bash
node scripts/setup-gateway.mjs check
```

It reports:

- the app, expected gateway, and expected DSH versions;
- `compat: PASS/FAIL` with the installed gateway version;
- the live DSH Web status (gateway enabled, clients, public endpoint, LAN/Tailscale URLs);
- whether the optional voice bundle is installed;
- the exact next command.

Interpretation:

- `compat: PASS`: the exact verified combination is installed. Go to Step 2 if DSH Web is running; if it is not,
  start it first.
- `compat: FAIL` with `plugin not installed` or an installed-version mismatch: stop DSH Web, then run `install`
  (Step 1) in a normal shell.
- `compat: FAIL` with `DSH ... != recommended ...`: stop and ask. Do not upgrade DSH automatically.
- `dsh web: not reachable`: start DSH Web, then re-run `check`.
- `3080` already in use by another process: use that DSH Web instance; do not start a second one.

For a machine-readable result, `check --json` returns `{ ok, checker, dshWeb, voice }`. The public URL is
reported as `(configured)` rather than printed.

**Sandbox note:** when the agent runs inside DSH's default `workspace-write` sandbox, `dsh plugin` may fail
with `EPERM` on `package.json.lock`. That is a permission failure, not “plugin missing”. Do not request
`danger-full-access`; hand the install to the user instead.

## Step 1 — install the gateway (user runs this)

### Preferred: one command, then scan

From the repository clone, in a normal terminal (not the DSH Web chat):

```bash
node scripts/setup-gateway.mjs install --yes --stop-web --restart-web \
  --tunnel quick --pair --open
```

Add `--voice` to install the matching voice bundle and download the model without a prompt, or `--no-voice`
to skip. If neither is given and stdin is a terminal, the script asks the usual
`Enable voice input now? [Y/n]` question.

The one-command path:

1. captures the running DSH Web command (Linux: `/proc` + systemd; Windows: `Win32_Process`); if it is a
   systemd unit, uses `sudo -n systemctl stop/start dsh-web`;
2. stops the whole DSH Web process tree — the current agent session ends here;
3. installs exactly the pinned GitHub tag from `compatibility.json`;
4. re-runs the checker and fails if the installed package version is wrong;
5. optionally installs voice and downloads/verifies the 241 MB SenseVoice model;
6. starts DSH Web again in the background and prints the restart log path;
7. enables the gateway;
8. opens a Quick Tunnel, waits for the public URL, and re-checks DNS/TLS/WebSocket until ready (or prints a
   warning and continues);
9. writes and opens the pairing QR page.

Use `--dry-run` to see the plan (including the captured DSH Web command) without stopping or installing anything.

### Existing named Cloudflare Tunnel

A named tunnel has a stable hostname, so the optional address book is **not** needed. Do not reuse the DSH
Web hostname for the gateway:

- if that hostname has Cloudflare Access, the app's WebSocket cannot complete the browser login;
- a tunnel to `3080` also exposes the Web UI and the management surface (`/mgw`), not just `/ws/mobile`.

Use a dedicated gateway hostname (for example `gw.example.com`). It may point at either:

- `http://127.0.0.1:3082` — the gateway's dedicated tunnel proxy. It serves **only** `/ws/mobile` and never
  the Web UI or `/mgw`. It starts only when the gateway's Cloudflare tunnel mode is enabled; the gateway can
  run its own `cloudflared` connector from the named-tunnel token; or
- `http://127.0.0.1:3081` — the LAN listener. It is also WS-only (HTTP requests get 404) and accepts only
  `/ws/mobile` from private-network/loopback sources; this is the path used by an existing named tunnel.

Never point a public hostname at `3080`; that exposes the Web UI and `/mgw`.

First-time sequence (the tunnel token is a secret; the user enters it, not the agent):

1. Install without creating a Quick Tunnel, in a normal shell:
   ```bash
   node scripts/setup-gateway.mjs install --yes --stop-web --restart-web
   ```
2. In DSH Web → **移动设备 → 连接与配对**, enable the gateway. If the hostname points at `3082`, open the
   Cloudflare Tunnel section, choose the named mode, enter the tunnel token and the gateway hostname, and
   wait until the state is `online`. If it points at `3081`, keep the existing connector and make sure LAN
   mode is enabled.
3. Pair through the named endpoint:
   ```bash
   node scripts/setup-gateway.mjs pair --url wss://gw.example.com/ws/mobile --open
   ```

Once that named setup persists across restarts, an agent can generate the one-command plan without creating
a Quick Tunnel:

```bash
node scripts/setup-gateway.mjs handoff --pair-url wss://gw.example.com/ws/mobile
```

`handoff --pair-url` only changes the generated command; it does not create or validate the tunnel.

### Manual fallback

Stop DSH Web first:

```bash
# Linux systemd
sudo systemctl stop dsh-web

# macOS / manual install
# Ctrl+C the terminal that is running `dsh web`
```

Then, in a normal shell:

```bash
node scripts/setup-gateway.mjs install --yes
```

The manual path refuses if port 3080 is listening — this is the guard against the hot-install
`sessionController` failure. It checks the DSH version, installs the pinned tag, re-runs the checker, and asks
the voice question. After it finishes, start DSH Web with the normal command and run `enable`, `tunnel`, and
`pair`.

If DSH runs as a systemd service under another user (for example the unit runs as `dsh` while you log in as
`ubuntu`), the profile commands must run as that service user, and only `systemctl` needs the login user's
sudo:

```bash
sudo systemctl stop dsh-web
sudo -u dsh -H bash -lc 'cd <repo> && node scripts/setup-gateway.mjs install --yes'
sudo systemctl start dsh-web
sudo -u dsh -H bash -lc 'cd <repo> && node scripts/setup-gateway.mjs enable'
```

Then pair from the DSH Web panel with the named-tunnel URL, or run `pair --url ...` and retrieve the HTML
file. Do not run `install` as root: it would create root-owned files in the service user's profile. Clone the
repository somewhere the service user can read.

Do **not** use the Web plugin panel or `dsh plugin add` directly for this release: the panel’s catalog entry
is not pinned to the recommended tag. Do **not** “just try it” while DSH Web is running; a page refresh or a
soft plugin reload is not a process restart.

### After the restart

The original DSH session is still in the session list. Open it again; it keeps its history, drafts, and
workspace. The chat UI disappears only while DSH Web is down.

If the user wants voice input, keep DSH Web stopped and run the optional step below before starting it again.

## Optional — enable voice input (user runs this)

The app supports voice input; the host needs the matching official bundle. The script installs the exact
version from `compatibility.json` (currently `@deepseek-ai/dsh-experimental-voice-input-bundle@0.2.1-rc.5`)
and pre-downloads the SenseVoice model (about 241 MB) to the DSH home. The model is required: the app shows
“语音未启用” until a provider is `ready`/`standby`, and the mobile app has no “prepare model” button.

`install` offers this as an `Enable voice input now? [Y/n]` prompt. Use the separate command for a later
install; DSH Web must be stopped:

```bash
node scripts/setup-gateway.mjs voice
# reads the plan and asks for confirmation; then:
node scripts/setup-gateway.mjs voice --yes
```

- Use `--no-download` to skip the model download and prepare it later from the Web UI.
- The script verifies the model size and SHA-256. It tries `hf-mirror.com` first and falls back to
  `huggingface.co`; a failed download leaves no partial file behind.
- Do not install `0.1.7-alpha.1` on DSH `0.2.1-rc.5`: that older bundle is disabled by the profile’s
  compatibility exemptions. Use the matching version.
- The optional profile patch for `speech-to-text-sensevoice` only needs `dataRoot` and, in China, the
  `https://hf-mirror.com` model origin. The bundle already supplies the default `dataRoot`; do not edit the
  profile patch by hand.

Start DSH Web with the user’s normal command after the gateway and optional voice steps. Verify:

```bash
node scripts/setup-gateway.mjs check
```

## Step 2 — enable the gateway

The management API is loopback-only. Do not expose `/mgw` or port `3081` to the public internet.

```bash
node scripts/setup-gateway.mjs enable
```

The script posts `{"mode":"persistent"}`, waits for the status to flip, and prints the public, LAN, and
Tailscale URLs. If it reports `HTTP 404`, the plugin is not loaded; restart DSH Web and re-run `check`.

## Step 3 — choose a phone-reachable endpoint

The app requires:

- a private/LAN address or Tailscale address for `ws://`;
- `wss://` for a public address.

A public IP with plain `ws://` is rejected by design. Do not work around that by disabling the check.

Use the URLs printed by `check`/`enable`:

- `lan.urls`: private IPv4 addresses (`10/8`, `172.16/12`, `192.168/16`) and Tailscale `100.64/10`.
  `ws://<address>:3081/ws/mobile`.
- If `lan.urls` is empty, the host has no RFC1918/Tailscale address. Do not force a `ws://` URL: addresses
  such as `192.10.x.x` are not RFC1918, and both the gateway LAN listener and the app reject them.
- `tailscale.urls`: use `ws://100.x.x.x:3081/ws/mobile` when both the host and phone are on Tailscale.
- `publicUrl`: a `wss://` Quick Tunnel or named Tunnel address.

To start a Quick Tunnel and wait for it from the script:

```bash
node scripts/setup-gateway.mjs tunnel --wait 120
```

**Quick Tunnel DNS false negative:** `publicReady:false` with `endpointHealth.state === 'dns-error'` can mean
the host’s local DNS is poisoned or blocked, not that the tunnel is down. The public record can exist and the
tunnel can be live. `pair` still creates a payload in this state. If the phone also cannot resolve the
hostname, enable a VPN or Android Private DNS (DoH) on the phone, or use Tailscale / a named Tunnel with a
custom domain. Do not debug the tunnel by disabling TLS verification or the app’s URL check.

## Step 4 — create the pairing payload

With DSH Web running and the gateway enabled:

```bash
node scripts/setup-gateway.mjs pair --open
```

The script writes a local HTML page containing the QR code, prints the page path and expiry, and opens it if
`--open` is given. On a headless/SSH host, omit `--open` and give the user the path; the page is plain HTML.
The page also contains the manual-paste payload in a collapsed section.

- The pairing code is single-use and expires in five minutes.
- Treat it like a password: do not paste the QR payload, device token, or the page’s textarea into chat, logs,
  issues, or screenshots.
- The agent may report the page path and expiry, but must not print the payload.
- If the Web UI’s QR button is blocked by `publicReady:false`, use this script instead; it calls the same
  `/mgw/pair` API without the misleading readiness gate.

After the user scans the QR, verify:

```bash
node scripts/setup-gateway.mjs check
```

`clients` should become non-zero. The device list is available to the user in the Web UI; the agent should not
print device IDs.

## Failure branches

| Symptom | What to do |
| --- | --- |
| `sessionController is unavailable` after install | The plugin was hot-installed. Stop the **whole** DSH Web process and start it again; a page refresh or soft plugin reload is not enough. The setup script avoids this by refusing while 3080 is listening. |
| `install` refuses “DSH Web is listening on 3080” | Intentional. Use the one-command `--stop-web --restart-web` path, or stop DSH Web manually and run `install --yes` in a normal shell. Do not bypass the guard. |
| `install --stop-web` fails with `sudo: a password is required` | DSH runs as a service user without sudo. Stop/start the unit with the login user's sudo and run the profile commands as the service user; see “Manual fallback”. |
| App turns fail with `MISSING_CREDENTIAL` after restart | The model provider key was not available to the restarted DSH Web. Save it in `~/.dsh/.credentials.yaml` under `refs:` (the store is watched and reloads without a restart), or start DSH Web with the provider environment variable set. This is a host credential issue, not a gateway or pairing issue. |
| `check` says `plugin not installed` or installed version mismatch | Stop DSH Web; run `install --yes`. Do not use the Web plugin panel, a local checkout, or `@latest`. |
| `check` says `DSH ... != recommended ...` | Stop and ask. Do not upgrade DSH automatically. |
| `/mgw/status` 404 | The plugin is not loaded. Restart DSH Web and check the profile bundle list. |
| `publicReady:false`, `dns-error` | Host DNS false negative; the tunnel may be live. Use `pair`; if the phone cannot resolve the hostname, use VPN/Private DNS, Tailscale, or a named Tunnel. |
| Named-tunnel hostname works in a browser but the app cannot connect | Cloudflare Access is probably in front of that hostname. The app cannot complete an Access login; put the gateway on a separate hostname without Access, routed to `127.0.0.1:3082`. |
| DSH Web token page loops or lands on `authentication required` after Cloudflare Access login | Access can strip `?token=...` on the login redirect, and its cross-site return does not send DSH's `SameSite=Strict` cookie on the first request. Refresh once may get in if the cookie exists; otherwise open the current token URL again. The robust fix is not to put Cloudflare Access in front of the DSH Web hostname — DSH's own token is the auth layer. Use Access only on other services. |
| `ws://192.10.x.x` rejected, `lan.urls` empty | The address is not RFC1918/Tailscale. Use Tailscale or a `wss://` tunnel. |
| Voice bundle disabled after upgrading DSH | Install the matching `0.2.1-rc.5` bundle; do not use `0.1.7-alpha.1`. |
| App shows 语音未启用 after voice install | The model is not ready. Stop DSH Web, run `voice --yes` to download and verify it, then start DSH Web; check `speech-catalog` `providers[].preparation.phase`. |
| Cloudflare authorization requested | Stop and hand the browser step to the user. |

## Safety rules

- Never expose `3080` or `/mgw` to the public internet. A tunnel may expose only the gateway's dedicated
  proxy on `127.0.0.1:3082` (serves `/ws/mobile` only) or the WS-only LAN listener on `127.0.0.1:3081`
  (HTTP 404, `/ws/mobile` from private/loopback sources only).
- Never print pairing codes, device tokens, write secrets, or private keys in chat or logs. `pair` writes them
  to a local page; do not echo the page’s payload.
- Never read `credentials.json`, `keys/`, `.scratch/`, profile backups, or DSH logs.
- Never read `docs/HANDOFF.md`, `docs/STATUS-*`, `docs/BACKLOG.md`, `docs/RISK-PATCHES.md`, or `docs/home-*`;
  they are internal engineering notes, not part of the setup surface. The setup surface is README,
  AGENT-SETUP, COMPATIBILITY, compatibility.json, the two setup scripts, and the gateway’s own
  `PROTOCOL.md`.
- Do not request `danger-full-access` for a read-only check or for the install. If the sandbox blocks the
  profile, stop and hand the command to the user.
- Never install from a local path, a `link:` dependency, a profile backup, or `@latest`. Use the pinned
  `compatibility.json` source.
- If the DSH or plugin version does not match `compatibility.json`, stop and ask; do not auto-upgrade.
- Do not build or test the mobile app. The user already has an APK; the task is the gateway, not the app
  development environment.
- Never change firewall rules, system services, or SSH configuration without explicit approval.
- Never disable device authentication to “make pairing easier”.
- Do not uninstall or disable other plugins while setting up the gateway.
- If a command would restart the DSH process running the agent, stop and ask the user.
