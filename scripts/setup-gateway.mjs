#!/usr/bin/env node
/**
 * Safe setup entry point for dsh-plugin-mobile-gateway.
 *
 * Usage:
 *   node scripts/setup-gateway.mjs check   [--profile web] [--port 3080] [--json]
 *   node scripts/setup-gateway.mjs install [--profile web] [--yes]
 *   node scripts/setup-gateway.mjs enable  [--port 3080]
 *   node scripts/setup-gateway.mjs pair    [--port 3080] [--url URL] [--out FILE] [--open]
 *
 * `check` is read-only and is the only command an agent should run.
 * `install` is for the user in a normal shell with DSH Web stopped: installing
 * into a running Web process hot-reloads the plugin tree and can leave
 * sessionController unavailable until a full process restart.
 *
 * The script never prints pairing tokens. `pair` writes them to a local
 * single-use QR page and prints only the file path and expiry.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MANIFEST_FILE = path.join(ROOT, 'compatibility.json');
const PROFILE = arg('profile', 'web');
const PORT = Number(arg('port', '3080'));
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const PLUGIN_NAME = 'dsh-plugin-mobile-gateway';

class SetupError extends Error {}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function fail(message) {
  throw new SetupError(message);
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_FILE)) fail(`compatibility.json not found: ${MANIFEST_FILE}`);
  return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) fail(`cannot run ${command}: ${result.error.message}`);
  return result.status ?? 1;
}

function runDsh(args) {
  if (process.platform === 'win32') {
    return run('cmd.exe', ['/d', '/s', '/c', ['dsh', ...args].join(' ')]);
  }
  return run('dsh', args);
}

function runChecker() {
  const result = spawnSync(
    process.execPath,
    [path.join(HERE, 'check-compat.mjs'), '--profile', PROFILE, '--json'],
    { encoding: 'utf8' },
  );
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = null;
  }
  return {
    code: result.status ?? 1,
    parsed,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function checkerView(result) {
  const parsed = result.parsed;
  if (!parsed) return { ok: false, raw: `${result.stdout}${result.stderr}`.trim() };
  return {
    ok: parsed.ok === true,
    app: parsed.app,
    protocol: parsed.protocol,
    plugin: parsed.plugin,
    dsh: parsed.dsh,
    errors: parsed.errors ?? [],
  };
}

function fetchStatus() {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    fetch(`${BASE}/mgw/status`, { signal: controller.signal })
      .then(async (response) => {
        clearTimeout(timer);
        if (!response.ok) {
          resolve({ ok: false, error: `HTTP ${response.status}` });
          return;
        }
        resolve({ ok: true, data: await response.json() });
      })
      .catch((error) => {
        clearTimeout(timer);
        resolve({ ok: false, error: error?.name === 'AbortError' ? 'timeout' : String(error) });
      });
  });
}

function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(600, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function statusView(status, redact = false) {
  if (!status.ok) return { running: false, error: status.error };
  const data = status.data;
  return {
    running: true,
    pid: data.webPid ?? null,
    version: data.version ?? null,
    gatewayEnabled: data.gatewayEnabled === true,
    gatewayMode: data.gatewayMode ?? null,
    connectedClients: data.connectedClients ?? 0,
    publicUrl: data.publicUrl ? (redact ? '(configured)' : data.publicUrl) : null,
    publicReady: data.cloudflare?.publicReady ?? null,
    endpointHealth: data.cloudflare?.endpointHealth?.state ?? null,
    lanUrls: data.lan?.urls ?? [],
    tailscaleUrls: data.tailscale?.urls ?? [],
  };
}

function printStatus(status) {
  const view = statusView(status);
  if (!view.running) {
    console.log(`dsh web: not reachable on ${BASE} (${view.error})`);
    return;
  }
  console.log(`dsh web: running on ${PORT} (pid ${view.pid ?? '?'})`);
  console.log(
    `  gateway: ${view.version ?? '?'} ${view.gatewayEnabled ? 'enabled' : 'disabled'}` +
      (view.gatewayMode ? ` (${view.gatewayMode})` : ''),
  );
  console.log(`  clients: ${view.connectedClients}`);
  console.log(
    `  public:  ${view.publicUrl ?? '(none)'} ` +
      (view.publicReady ? 'ready' : `not-ready (${view.endpointHealth ?? 'unknown'})`),
  );
  console.log(`  lan:     ${view.lanUrls.length ? view.lanUrls.join(', ') : '(no private URLs)'}`);
  if (view.tailscaleUrls.length) {
    console.log(`  tailscale: ${view.tailscaleUrls.join(', ')}`);
  }
}

function installedPackageVersion(name) {
  const file = path.join(
    os.homedir(),
    '.dsh',
    'profiles',
    PROFILE,
    'node_modules',
    name,
    'package.json',
  );
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

async function waitForStatus(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fetchStatus();
    if (last.ok && predicate(last.data)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return last;
}

function hasDshMismatch(result) {
  const errors = result.parsed?.errors ?? [];
  return errors.some((error) => error.startsWith('DSH '));
}

async function cmdCheck(asJson) {
  const result = runChecker();
  const checker = checkerView(result);
  const status = await fetchStatus();
  const ok = result.code === 0;
  const manifest = readManifest();
  const voice = manifest.recommended.voice;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok,
          checker,
          dshWeb: statusView(status, true),
          voice: voice
            ? { expected: voice.version, installed: installedPackageVersion(voice.name) }
            : null,
        },
        null,
        2,
      ),
    );
    return ok ? 0 : 1;
  }

  console.log(
    `setup-gateway: app ${manifest.app.version} / gateway ${manifest.recommended.gateway.version} / ` +
      `DSH ${manifest.recommended.dsh.version}`,
  );
  if (checker.raw) {
    console.log('compat: FAIL (checker did not return JSON)');
    if (checker.raw) console.log(checker.raw);
  } else if (ok) {
    console.log(`compat: PASS (installed ${checker.plugin?.installedVersion ?? '?'})`);
  } else {
    console.log('compat: FAIL');
    for (const error of checker.errors ?? []) console.log(`  - ${error}`);
  }

  printStatus(status);
  if (voice) {
    const installedVoice = installedPackageVersion(voice.name);
    console.log(
      `voice:   ${installedVoice ? `${voice.name}@${installedVoice} installed` : 'not installed (optional)'}`,
    );
  }

  if (!ok) {
    const dshMissing = (checker.errors ?? []).some((error) =>
      error.startsWith('cannot determine DSH'),
    );
    if (dshMissing) {
      console.log('next: dsh is not available in this shell; stop and ask the user for the correct host/shell.');
    } else if (hasDshMismatch(result)) {
      console.log(
        'next: DSH does not match compatibility.json; stop and ask the user. Do not upgrade DSH automatically.',
      );
    } else if (await isListening(PORT)) {
      console.log(
        'next: stop DSH Web, then run install in a normal shell. The agent must not run install.',
      );
    } else {
      console.log('next: run install in a normal shell; it refuses while DSH Web is up.');
    }
  } else if (!status.ok) {
    console.log('next: start DSH Web, then run enable.');
  } else if (!status.data.gatewayEnabled) {
    console.log('next: run enable.');
  } else {
    console.log('next: run pair to create a QR page; scan it with the app.');
  }
  return ok ? 0 : 1;
}

async function cmdInstall(yes) {
  const manifest = readManifest();
  const pinned = manifest.recommended.gateway;
  const spec = pinned.source ?? '';
  if (!spec.startsWith(`github:solla-h/${PLUGIN_NAME}#v`) || !spec.endsWith(`#v${pinned.version}`)) {
    fail(`unexpected gateway source in compatibility.json: ${spec || '(missing)'}`);
  }

  const before = runChecker();
  if (before.code === 0) {
    console.log(`setup-gateway: ${PLUGIN_NAME}@${pinned.version} is already installed; nothing to do.`);
    console.log('next: if you just changed the profile, restart DSH Web; then run enable and pair.');
    return 0;
  }
  if (!before.parsed) {
    fail('compatibility checker did not return JSON; run "node scripts/check-compat.mjs --profile web"');
  }
  if (!before.parsed.dsh) {
    fail('cannot determine the DSH version; install DSH or run this in the shell where dsh is available.');
  }
  if (hasDshMismatch(before)) {
    console.error('setup-gateway: DSH does not match compatibility.json:');
    for (const error of before.parsed.errors ?? []) console.error(`  - ${error}`);
    fail('refusing to install; stop and ask the user. Do not upgrade DSH automatically.');
  }
  if (await isListening(PORT)) {
    fail(
      `DSH Web is listening on ${PORT}. Installing now hot-reloads the plugin tree and can leave ` +
        'sessionController unavailable. Stop DSH Web first (the agent session will end), then run ' +
        'this command in a normal shell.',
    );
  }
  if (!yes) {
    console.log(`This will install ${spec} into profile "${PROFILE}".`);
    console.log('Run again with --yes after you have stopped DSH Web.');
    return 1;
  }

  console.log(`installing ${spec} into profile "${PROFILE}"...`);
  if (runDsh(['plugin', '--profile', PROFILE, 'add', spec]) !== 0) {
    fail('dsh plugin add failed; nothing else was changed.');
  }

  const after = runChecker();
  if (after.code !== 0) {
    console.error('setup-gateway: compatibility check failed after install:');
    for (const error of after.parsed?.errors ?? []) console.error(`  - ${error}`);
    return 1;
  }
  console.log('compat: PASS');
  console.log(
    'optional: voice input is available. Keep DSH Web stopped, then run ' +
      '"node scripts/setup-gateway.mjs voice"; it asks for confirmation and downloads the model.',
  );
  console.log('next: start DSH Web with your normal command, then run enable and pair.');
  return 0;
}

async function cmdEnable() {
  const status = await fetchStatus();
  if (!status.ok) {
    fail(`DSH Web is not reachable on ${BASE} (${status.error}); start it first.`);
  }
  if (status.data.gatewayEnabled) {
    console.log('setup-gateway: gateway already enabled.');
    printStatus(status);
    return 0;
  }

  const response = await fetch(`${BASE}/mgw/gateway`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'persistent' }),
  });
  if (!response.ok) {
    const body = await response.text();
    fail(`enable failed: HTTP ${response.status} ${body}`);
  }

  const after = await waitForStatus((data) => data.gatewayEnabled === true);
  if (!after?.ok || after.data.gatewayEnabled !== true) {
    fail('enable request was accepted but the gateway did not become enabled; check the DSH Web log.');
  }
  console.log('setup-gateway: gateway enabled.');
  printStatus(after);
  return 0;
}

function assetMatches(file, asset) {
  try {
    const info = fs.statSync(file);
    if (!info.isFile() || info.size !== asset.bytes) return false;
    const digest = createHash('sha256');
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
      let read = 0;
      while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
        digest.update(buffer.subarray(0, read));
      }
    } finally {
      fs.closeSync(fd);
    }
    return digest.digest('hex') === asset.sha256;
  } catch {
    return false;
  }
}

async function downloadAsset(asset, destination, origin) {
  if (!asset?.url || !asset?.name || !asset?.bytes || !asset?.sha256) {
    fail('installed voice package has an incomplete runtime/assets.json');
  }
  if (assetMatches(destination, asset)) {
    console.log(`  cached ${asset.name}`);
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const partial = `${destination}.part`;
  fs.rmSync(partial, { force: true });
  const source = new URL(asset.url);
  source.protocol = 'https:';
  source.hostname = new URL(origin).hostname;
  console.log(
    `  downloading ${asset.name} (${Math.round(asset.bytes / 1024 / 1024)} MB) from ${source.origin}`,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30 * 60 * 1000);
  try {
    const response = await fetch(source, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status} for ${source}`);
    }
    const hash = createHash('sha256');
    let received = 0;
    let lastReport = 0;
    await pipeline(
      Readable.fromWeb(response.body),
      new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk);
          received += chunk.length;
          if (received - lastReport >= 25 * 1024 * 1024) {
            lastReport = received;
            console.log(
              `    ${Math.round(received / 1024 / 1024)} / ${Math.round(asset.bytes / 1024 / 1024)} MB`,
            );
          }
          callback(null, chunk);
        },
      }),
      fs.createWriteStream(partial),
    );
    if (received !== asset.bytes) {
      throw new Error(`size ${received} != ${asset.bytes}`);
    }
    const digest = hash.digest('hex');
    if (digest !== asset.sha256) {
      throw new Error(`sha256 ${digest} != ${asset.sha256}`);
    }
    fs.rmSync(destination, { force: true });
    fs.renameSync(partial, destination);
    console.log(`  verified ${asset.name}`);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadAssetWithFallback(asset, destination, origins) {
  let lastError = null;
  for (const origin of origins) {
    try {
      await downloadAsset(asset, destination, origin);
      return;
    } catch (error) {
      lastError = error;
      console.log(`  ${origin} failed: ${error.message}`);
    }
  }
  throw lastError ?? new Error('no model origin available');
}

async function cmdVoice(yes, download) {
  const manifest = readManifest();
  const voice = manifest.recommended.voice;
  if (!voice?.name || !voice?.version || !voice?.source) {
    fail('compatibility.json has no recommended.voice');
  }

  const compat = runChecker();
  const dsh = compat.parsed?.dsh;
  if (!dsh) {
    fail('cannot determine the DSH version; run this in the shell where dsh is available.');
  }
  if (dsh !== manifest.recommended.dsh.version) {
    fail(`DSH ${dsh} != recommended ${manifest.recommended.dsh.version}; refusing to install voice.`);
  }

  const installed = installedPackageVersion(voice.name);
  if (installed && installed !== voice.version) {
    fail(
      `voice bundle ${installed} is installed but ${voice.version} is expected; ` +
        'remove or replace it manually, then retry.',
    );
  }
  if (await isListening(PORT)) {
    fail(
      `DSH Web is listening on ${PORT}. Stop it before installing voice or downloading the model; ` +
        'adding a bundle to a running Web process has the same hot-reload problem as the gateway.',
    );
  }

  const modelBytes = voice.model?.bytes ?? 241357257;
  if (!yes) {
    console.log(`This will install ${voice.source} into profile "${PROFILE}".`);
    console.log(
      `It also downloads the SenseVoice model (~${Math.round(modelBytes / 1_000_000)} MB) ` +
        'to your DSH home from the configured mirror.',
    );
    console.log('Run again with --yes after you have stopped DSH Web. Use --no-download to skip the model.');
    return 1;
  }

  if (!installed) {
    console.log(`installing ${voice.source} into profile "${PROFILE}"...`);
    if (runDsh(['plugin', '--profile', PROFILE, 'add', voice.source]) !== 0) {
      fail('dsh plugin add failed; nothing else was changed.');
    }
    const after = installedPackageVersion(voice.name);
    if (after !== voice.version) {
      fail(`installed voice bundle is ${after ?? 'missing'}, expected ${voice.version}.`);
    }
    console.log(`voice bundle: ${voice.version}`);
  } else {
    console.log(`voice bundle ${voice.version} already installed.`);
  }

  if (download) {
    const assetsFile = path.join(
      os.homedir(),
      '.dsh',
      'profiles',
      PROFILE,
      'node_modules',
      '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice',
      'runtime',
      'assets.json',
    );
    if (!fs.existsSync(assetsFile)) {
      fail(`voice package assets not found: ${assetsFile}`);
    }
    const assets = JSON.parse(fs.readFileSync(assetsFile, 'utf8'));
    const dataRoot = path.join(os.homedir(), '.dsh', 'speech-to-text', 'sensevoice');
    const modelRoot = path.join(dataRoot, 'models', 'sensevoice-onnx');
    const vadRoot = path.join(dataRoot, 'models', 'silero');
    const origins = [
      ...new Set([voice.model?.origin ?? 'https://hf-mirror.com', 'https://huggingface.co']),
    ];
    console.log(`model directory: ${dataRoot}`);
    await downloadAssetWithFallback(
      assets.models?.int8,
      path.join(modelRoot, assets.models?.int8?.name ?? ''),
      origins,
    );
    await downloadAssetWithFallback(
      assets.tokens,
      path.join(modelRoot, assets.tokens?.name ?? ''),
      origins,
    );
    await downloadAssetWithFallback(
      assets.vad,
      path.join(vadRoot, assets.vad?.name ?? ''),
      origins,
    );
  } else {
    console.log('model download skipped; the app will show 语音未启用 until the model is prepared.');
  }

  console.log('next: start DSH Web; the voice provider should report ready/standby.');
  console.log(
    'note: if your profile patch overrides speech-to-text-sensevoice dataRoot, put the files there instead.',
  );
  return 0;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
  });
}

function openFile(file) {
  if (process.platform === 'win32') {
    spawn('explorer.exe', [file], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [file], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [file], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function cmdPair() {
  const status = await fetchStatus();
  if (!status.ok) {
    fail(`DSH Web is not reachable on ${BASE} (${status.error}); start it first.`);
  }
  if (!status.data.gatewayEnabled) {
    const code = await cmdEnable();
    if (code !== 0) return code;
  }

  const current = await fetchStatus();
  if (!current.ok) fail(`DSH Web stopped responding (${current.error}).`);
  const publicUrl = arg('url', null) ?? current.data.publicUrl ?? current.data.cloudflare?.publicUrl;
  if (!publicUrl) {
    fail('no publicUrl is configured; start a tunnel or pass --url <ws://...|wss://...>.');
  }

  const response = await fetch(`${BASE}/mgw/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicUrl }),
  });
  if (!response.ok) {
    const body = await response.text();
    fail(`pair failed: HTTP ${response.status} ${body}`);
  }
  const data = await response.json();
  const expiresAt = new Date(data.pairing.expiresAt).toISOString();
  const output = path.resolve(arg('out', path.join(os.tmpdir(), 'dsh-mobile-pair.html')));
  fs.mkdirSync(path.dirname(output), { recursive: true });

  const html = `<!doctype html>
<meta charset="utf-8">
<title>DSH mobile pairing</title>
<body style="font:16px system-ui;background:#111;color:#eee;display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px">
<h2 style="margin:0">Scan with the DSH app</h2>
<div style="background:#fff;padding:12px;border-radius:12px;width:min(82vw,420px)">${data.svg}</div>
<p style="margin:0;color:#9ca3af">${escapeHtml(publicUrl)}</p>
<p style="margin:0;color:#f59e0b">One-time code; expires ${escapeHtml(expiresAt)}</p>
<details style="max-width:640px;width:100%">
  <summary style="cursor:pointer;color:#9ca3af">Manual paste (treat as a password)</summary>
  <textarea readonly style="width:100%;height:140px;margin-top:8px;background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:8px;padding:8px">${escapeHtml(data.qrPayload)}</textarea>
</details>
</body>`;
  fs.writeFileSync(output, html, { mode: 0o600 });

  console.log(`pairing page: ${output}`);
  console.log(`expires: ${expiresAt}`);
  if (current.data.cloudflare?.publicReady === false) {
    console.log(
      'note: the host endpoint check did not pass; the tunnel can still work if the phone can resolve the hostname.',
    );
  }
  console.log('Open the page and scan the QR. Do not paste the code into chat, logs, or screenshots.');
  if (flag('open')) openFile(output);
  return 0;
}

function usage() {
  console.log(`usage:
  node scripts/setup-gateway.mjs check   [--profile web] [--port 3080] [--json]
  node scripts/setup-gateway.mjs install [--profile web] [--yes]
  node scripts/setup-gateway.mjs enable  [--port 3080]
  node scripts/setup-gateway.mjs pair    [--port 3080] [--url URL] [--out FILE] [--open]
  node scripts/setup-gateway.mjs voice   [--profile web] [--yes] [--no-download]

check is read-only and safe for an agent. install and voice must be run by the
user in a normal shell with DSH Web stopped; they refuse while the port is
listening.`);
}

async function main() {
  const command = process.argv[2] ?? 'check';
  if (command === 'help' || flag('help')) {
    usage();
    return 0;
  }
  if (command === 'check') return cmdCheck(flag('json'));
  if (command === 'install') return cmdInstall(flag('yes'));
  if (command === 'enable') return cmdEnable();
  if (command === 'pair') return cmdPair();
  if (command === 'voice') return cmdVoice(flag('yes'), !flag('no-download'));
  usage();
  return 2;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof SetupError) {
    console.error(`setup-gateway: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}
