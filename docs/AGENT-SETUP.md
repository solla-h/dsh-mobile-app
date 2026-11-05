# DSH Agent Setup Guide

This page is written for a **DSH agent** that has shell access to the machine running DSH Web, when the user
asks it to “install the mobile gateway from this repository”.

The setup surface is one script, [`scripts/setup-gateway.mjs`](../scripts/setup-gateway.mjs). The agent runs the
read-only `check` and the safe `enable`/`pair` steps; the user runs `install` and `voice` in a normal shell with
DSH Web stopped. This split is intentional: installing a bundle into a running Web process hot-reloads the
plugin tree and can leave `sessionController` unavailable until the OS process is restarted.

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
- run `enable` after the user has restarted DSH Web;
- run `pair` after the gateway is enabled. `pair` writes a local QR page and prints only its path and expiry;
  it never prints the pairing payload.

The agent cannot:

- run `install` or `voice` while DSH Web is hosting the agent. The script refuses while port 3080 is listening,
  but the agent must also not try to work around the refusal;
- approve the phone's camera permission or scan the QR code for the user;
- complete Cloudflare device authorization for the optional address book;
- expose ports or change firewall rules without the user's explicit approval;
- read `docs/HANDOFF.md`, `docs/STATUS-*`, `docs/BACKLOG.md`, `docs/RISK-PATCHES.md`, `docs/home-*`,
  `credentials.json`, `keys/`, `.scratch/`, profile backups, or DSH logs. They are unrelated to setup and
  contain host or account details.

## Recommended user prompt

Give the agent the repository path (or a URL to this file), then use a prompt like:

```text
请先阅读仓库里的 docs/AGENT-SETUP.md 和 compatibility.json，然后只运行：
node scripts/setup-gateway.mjs check
不要运行 install 或 voice，不要直接运行 dsh plugin add，不要修改 profile / cordis.patch.yml，
不要克隆或使用本机的网关源码 checkout，也不要使用 @latest 或 Web 插件面板。
不要读 docs/HANDOFF.md、docs/STATUS-*、docs/BACKLOG.md、docs/RISK-PATCHES.md、docs/home-*、
credentials.json、keys/、.scratch/、profile 备份或 DSH 日志。

check 通过后，如需启用网关，运行 enable；需要配对时运行 pair --open，只把二维码页面的本地路径告诉我，
不要把二维码内容、pairing token 或设备 ID 打印到聊天里。
如果 check 报版本不匹配、DSH Web 正在监听 3080，或需要重启 DSH Web，停下来把 install/voice 交给
我在普通终端里执行。不要为了绕过沙箱去申请 danger-full-access，也不要把 3080/3081 暴露到公网。
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

The user must stop DSH Web first. Examples:

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

The script:

1. refuses if port 3080 is listening — this is the guard against the hot-install `sessionController` failure;
2. checks the DSH version against `compatibility.json`;
3. installs exactly the pinned GitHub tag from `compatibility.json`;
4. re-runs the checker and fails if the installed package version is wrong.

Do **not** use the Web plugin panel or `dsh plugin add` directly for this release: the panel’s catalog entry
is not pinned to the recommended tag. Do **not** “just try it” while DSH Web is running; a page refresh or a
soft plugin reload is not a process restart.

If the user wants voice input, keep DSH Web stopped and run the optional step below before starting it again.

## Optional — enable voice input (user runs this)

The app supports voice input; the host needs the matching official bundle. The script installs the exact
version from `compatibility.json` (currently `@deepseek-ai/dsh-experimental-voice-input-bundle@0.2.1-rc.5`)
and pre-downloads the SenseVoice model (about 241 MB) to the DSH home. The model is required: the app shows
“语音未启用” until a provider is `ready`/`standby`, and the mobile app has no “prepare model” button.

With DSH Web still stopped:

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
| `install` refuses “DSH Web is listening on 3080” | Intentional. Stop DSH Web, then run `install --yes` in a normal shell. Do not bypass the guard. |
| `check` says `plugin not installed` or installed version mismatch | Stop DSH Web; run `install --yes`. Do not use the Web plugin panel, a local checkout, or `@latest`. |
| `check` says `DSH ... != recommended ...` | Stop and ask. Do not upgrade DSH automatically. |
| `/mgw/status` 404 | The plugin is not loaded. Restart DSH Web and check the profile bundle list. |
| `publicReady:false`, `dns-error` | Host DNS false negative; the tunnel may be live. Use `pair`; if the phone cannot resolve the hostname, use VPN/Private DNS, Tailscale, or a named Tunnel. |
| `ws://192.10.x.x` rejected, `lan.urls` empty | The address is not RFC1918/Tailscale. Use Tailscale or a `wss://` tunnel. |
| Voice bundle disabled after upgrading DSH | Install the matching `0.2.1-rc.5` bundle; do not use `0.1.7-alpha.1`. |
| App shows 语音未启用 after voice install | The model is not ready. Stop DSH Web, run `voice --yes` to download and verify it, then start DSH Web; check `speech-catalog` `providers[].preparation.phase`. |
| Cloudflare authorization requested | Stop and hand the browser step to the user. |

## Safety rules

- Never expose `3080`, `3081`, or `/mgw` to the public internet.
- Never print pairing codes, device tokens, write secrets, or private keys in chat or logs. `pair` writes them
  to a local page; do not echo the page’s payload.
- Never read `credentials.json`, `keys/`, `.scratch/`, profile backups, or DSH logs.
- Never read `docs/HANDOFF.md`, `docs/STATUS-*`, `docs/BACKLOG.md`, `docs/RISK-PATCHES.md`, or `docs/home-*`;
  they are internal working notes and may contain host details. The setup surface is README, AGENT-SETUP,
  COMPATIBILITY, compatibility.json, the two setup scripts, and the gateway’s own `PROTOCOL.md`.
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
