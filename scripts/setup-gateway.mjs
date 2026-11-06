#!/usr/bin/env node
/**
 * Safe setup entry point for dsh-plugin-mobile-gateway.
 *
 * Usage:
 *   node scripts/setup-gateway.mjs check   [--profile web] [--port 3080] [--json]
 *   node scripts/setup-gateway.mjs handoff [--voice|--no-voice]
 *                                          [--pair-url wss://HOST/ws/mobile] [--out FILE]
 *   node scripts/setup-gateway.mjs install [--profile web] [--yes] [--voice|--no-voice]
 *                                          [--stop-web] [--restart-web]
 *                                          [--tunnel quick] [--pair] [--url URL]
 *                                          [--open] [--dry-run]
 *   node scripts/setup-gateway.mjs enable  [--port 3080]
 *   node scripts/setup-gateway.mjs tunnel  [--port 3080] [--wait SECONDS]
 *   node scripts/setup-gateway.mjs pair    [--port 3080] [--url URL] [--out FILE] [--open]
 *
 * `check` and `handoff` are read-only and safe for an agent. `handoff` writes
 * the one-command plan to a file and prints it, so the user never loses the
 * remaining steps when DSH Web stops.
 *
 * `install` is for the user in a normal shell: installing into a running Web
 * process hot-reloads the plugin tree and can leave sessionController
 * unavailable until a full process restart. With --stop-web --restart-web it
 * captures the running command, stops the whole process tree, installs, and
 * starts DSH Web again in the background. --tunnel quick and --pair finish the
 * setup without opening the Web UI.
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
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MANIFEST_FILE = path.join(ROOT, 'compatibility.json');
const PROFILE = arg('profile', 'web');
const PORT = Number(arg('port', '3080'));
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const PLUGIN_NAME = 'dsh-plugin-mobile-gateway';
const DRY_RUN = flag('dry-run');
const LOG_DIR = path.join(os.homedir(), '.dsh', 'logs');

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

/**
 * Split a Windows command line the way CommandLineToArgvW does.
 *
 * The restart path needs the real executable and argv: spawning cmd.exe with a
 * quoted command line is fragile (and produces a visible console on Windows).
 * This handles quoted paths, spaces, empty arguments, and backslash-escaped
 * quotes.
 */
export function parseWindowsCommandLine(commandLine) {
  const args = [];
  let current = '';
  let started = false;
  let inQuotes = false;
  let backslashes = 0;

  for (const character of commandLine) {
    if (character === '\\') {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      current += '\\'.repeat(Math.floor(backslashes / 2));
      if (backslashes % 2 === 1) {
        current += '"';
      } else {
        inQuotes = !inQuotes;
      }
      backslashes = 0;
      started = true;
      continue;
    }
    current += '\\'.repeat(backslashes);
    backslashes = 0;
    if (!inQuotes && (character === ' ' || character === '\t')) {
      if (started) {
        args.push(current);
        current = '';
        started = false;
      }
    } else {
      current += character;
      started = true;
    }
  }

  current += '\\'.repeat(backslashes);
  if (started) args.push(current);
  return args;
}

function fail(message) {
  throw new SetupError(message);
}

async function confirm(question, defaultYes = true) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function runCapture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
  };
}

/** 找监听端口的 PID；找不到返回 null，由调用方决定是失败还是让用户手动处理。 */
function findListenerPid(port) {
  if (process.platform === 'win32') {
    const result = runCapture('netstat', ['-ano', '-p', 'tcp']);
    for (const line of result.stdout.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5 && parts[3] === 'LISTENING' && parts[1].endsWith(`:${port}`)) {
        return Number(parts[4]) || null;
      }
    }
    return null;
  }
  const lsof = runCapture('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  if (lsof.status === 0 && lsof.stdout.trim()) {
    return Number(lsof.stdout.trim().split(/\s+/)[0]) || null;
  }
  const ss = runCapture('ss', ['-ltnp', `sport = :${port}`]);
  const match = /pid=(\d+)/.exec(ss.stdout);
  return match ? Number(match[1]) : null;
}

/**
 * 捕获 DSH Web 的启动方式，供安装后重启。
 * Linux 读 /proc 拿 argv/cwd/env（最准）；Windows 只能拿命令行，cwd 用安装器
 * 当前目录，env 用安装器自己的环境——所以要在原来启动 dsh web 的终端里运行。
 */
function captureProcess(pid) {
  const info = {
    pid: pid ?? null,
    commandLine: null,
    argv: null,
    cwd: null,
    env: null,
    systemdUnit: null,
  };
  if (!pid) return info;

  if (process.platform === 'win32') {
    const ps = runCapture('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
    ]);
    info.commandLine = ps.stdout.trim() || null;
    info.cwd = process.cwd();
    info.env = { ...process.env };
    return info;
  }

  if (process.platform === 'linux') {
    const unit = runCapture('systemctl', ['show', '-p', 'LoadState', '--value', 'dsh-web']);
    if (unit.status === 0 && unit.stdout.trim() === 'loaded') {
      const main = runCapture('systemctl', ['show', '-p', 'MainPID', '--value', 'dsh-web']);
      const mainPid = Number(main.stdout.trim());
      if (!mainPid || mainPid === pid) info.systemdUnit = 'dsh-web';
    }
    try {
      const raw = fs.readFileSync(`/proc/${pid}/cmdline`);
      info.argv = raw.toString('utf8').split('\0').filter(Boolean);
      info.commandLine = info.argv.join(' ');
    } catch {
      // /proc 可能因权限不可读；回退到 ps。
      const ps = runCapture('ps', ['-p', String(pid), '-o', 'command=']);
      info.commandLine = ps.stdout.trim() || null;
    }
    try {
      info.cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      info.cwd = process.cwd();
    }
    try {
      const raw = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
      info.env = {};
      for (const entry of raw.split('\0')) {
        const index = entry.indexOf('=');
        if (index > 0) info.env[entry.slice(0, index)] = entry.slice(index + 1);
      }
    } catch {
      info.env = { ...process.env };
    }
    return info;
  }

  const ps = runCapture('ps', ['-p', String(pid), '-o', 'command=']);
  info.commandLine = ps.stdout.trim() || null;
  const lsof = runCapture('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const cwdLine = lsof.stdout.split(/\r?\n/).find((line) => line.startsWith('n'));
  info.cwd = cwdLine ? cwdLine.slice(1) : process.cwd();
  info.env = { ...process.env };
  return info;
}

async function stopWeb(info) {
  if (info.systemdUnit) {
    if (DRY_RUN) {
      console.log(`  would run: sudo -n systemctl stop ${info.systemdUnit}`);
      return;
    }
    const result = spawnSync('sudo', ['-n', 'systemctl', 'stop', info.systemdUnit], {
      stdio: 'inherit',
    });
    if (result.error) fail(`cannot run sudo: ${result.error.message}`);
    if (result.status !== 0) {
      fail(
        `cannot stop ${info.systemdUnit} without a sudo prompt. Run ` +
          `"sudo systemctl stop ${info.systemdUnit}" manually, then rerun without --stop-web.`,
      );
    }
  } else {
    if (!info.pid) fail(`cannot find the process listening on ${PORT}; stop DSH Web manually.`);
    if (DRY_RUN) {
      console.log(`  would stop pid ${info.pid}${info.commandLine ? `: ${info.commandLine}` : ''}`);
      return;
    }
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill', ['/PID', String(info.pid), '/T', '/F'], {
        stdio: 'inherit',
      });
      if (result.status !== 0) fail(`taskkill failed for pid ${info.pid}; stop DSH Web manually.`);
    } else {
      try {
        process.kill(info.pid, 'SIGTERM');
      } catch (error) {
        fail(`cannot stop pid ${info.pid}: ${error.message}`);
      }
      const termDeadline = Date.now() + 8000;
      while (Date.now() < termDeadline && (await isListening(PORT))) await sleep(250);
      if (await isListening(PORT)) {
        try {
          process.kill(info.pid, 'SIGKILL');
        } catch {
          // 已经退出就无所谓。
        }
      }
    }
  }

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && (await isListening(PORT))) await sleep(250);
  if (await isListening(PORT)) fail(`port ${PORT} is still listening after stopping DSH Web.`);
}

async function restartWeb(info) {
  let logFile = null;
  if (info.systemdUnit) {
    if (DRY_RUN) {
      console.log(`  would run: sudo -n systemctl start ${info.systemdUnit}`);
      return;
    }
    const result = spawnSync('sudo', ['-n', 'systemctl', 'start', info.systemdUnit], {
      stdio: 'inherit',
    });
    if (result.error) fail(`cannot run sudo: ${result.error.message}`);
    if (result.status !== 0) {
      fail(
        `cannot start ${info.systemdUnit}. Run "sudo systemctl start ${info.systemdUnit}" ` +
          'manually, then run "node scripts/setup-gateway.mjs enable --tunnel quick --pair".',
      );
    }
  } else if (info.commandLine) {
    logFile = path.join(LOG_DIR, `dsh-web-${timestamp()}.log`);
    if (DRY_RUN) {
      console.log(`  would restart: ${info.commandLine}`);
      console.log(`  log: ${logFile}`);
      return;
    }
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const fd = fs.openSync(logFile, 'a');
    const env = { ...process.env, ...(info.env ?? {}) };
    const common = {
      cwd: info.cwd ?? process.cwd(),
      env,
      detached: true,
      stdio: ['ignore', fd, fd],
    };
    let child;
    if (process.platform === 'win32') {
      const [executable, ...args] = parseWindowsCommandLine(info.commandLine);
      if (!executable) {
        fs.closeSync(fd);
        fail('cannot parse the DSH Web command line; start DSH Web manually and rerun.');
      }
      // Spawn the captured executable directly so Windows does not create a
      // visible console and stdout/stderr go to the log file. Only fall back to
      // cmd.exe for batch shims, where the quoting has to stay verbatim.
      const batch = /\.(cmd|bat)$/i.test(executable);
      child = spawn(
        batch ? 'cmd.exe' : executable,
        batch ? ['/d', '/s', '/c', `"${info.commandLine}"`] : args,
        {
          ...common,
          windowsHide: true,
          ...(batch ? { windowsVerbatimArguments: true } : {}),
        },
      );
    } else if (info.argv?.length) {
      child = spawn(info.argv[0], info.argv.slice(1), common);
    } else {
      child = spawn('/bin/sh', ['-c', info.commandLine], common);
    }
    child.once('error', (error) => {
      console.error(`restart failed: ${error.message}; log: ${logFile}`);
    });
    child.unref();
    fs.closeSync(fd);
    console.log(`dsh web restarted in the background; log: ${logFile}`);
  } else {
    fail(
      'cannot determine how DSH Web was started. Start it with your normal command, then run ' +
        '"node scripts/setup-gateway.mjs enable --tunnel quick --pair".',
    );
  }

  const started = await waitForStatus(() => true, 60000);
  if (!started?.ok) {
    if (logFile) console.error(`check the restart log: ${logFile}`);
    fail('DSH Web did not come back within 60s; start it manually and rerun the remaining steps.');
  }
  console.log(`dsh web is back on ${BASE}.`);
}

/** 只做尺寸预检，避免每次 --voice 都对 241 MB 模型做 SHA-256。 */
function voiceAssetsReady(voice) {
  if (!voice?.name || installedPackageVersion(voice.name) !== voice.version) return false;
  try {
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
    const assets = JSON.parse(fs.readFileSync(assetsFile, 'utf8'));
    const dataRoot = path.join(os.homedir(), '.dsh', 'speech-to-text', 'sensevoice');
    const modelRoot = path.join(dataRoot, 'models', 'sensevoice-onnx');
    const vadRoot = path.join(dataRoot, 'models', 'silero');
    const present = (file, asset) => {
      try {
        return Boolean(asset?.bytes) && fs.statSync(file).size === asset.bytes;
      } catch {
        return false;
      }
    };
    return (
      present(path.join(modelRoot, assets.models?.int8?.name ?? ''), assets.models?.int8) &&
      present(path.join(modelRoot, assets.tokens?.name ?? ''), assets.tokens) &&
      present(path.join(vadRoot, assets.vad?.name ?? ''), assets.vad)
    );
  } catch {
    return false;
  }
}

async function cmdTunnel(mode) {
  if (mode !== 'quick') {
    fail('only "--tunnel quick" is supported by this script; use the Web UI for a named Tunnel.');
  }
  const status = await fetchStatus();
  if (!status.ok) fail(`DSH Web is not reachable on ${BASE} (${status.error}); start it first.`);
  if (!status.data.gatewayEnabled) {
    const code = await cmdEnable();
    if (code !== 0) return code;
  }

  const response = await fetch(`${BASE}/mgw/cloudflare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, mode: 'quick' }),
  });
  if (!response.ok) {
    const body = await response.text();
    fail(`Quick Tunnel setup failed: HTTP ${response.status} ${body}`);
  }
  let snapshot = await response.json();
  const waitMs = Number(arg('wait', '120')) * 1000;
  const onlineDeadline = Date.now() + waitMs;
  while (Date.now() < onlineDeadline) {
    if (snapshot.cloudflare?.state === 'online' && snapshot.cloudflare?.publicUrl) break;
    await sleep(1000);
    const next = await fetchStatus();
    if (next.ok) snapshot = next.data;
  }
  if (!snapshot.cloudflare?.publicUrl) {
    fail(
      `Quick Tunnel did not come online within ${Math.round(waitMs / 1000)}s; ` +
        'check the DSH Web log or run "node scripts/setup-gateway.mjs check".',
    );
  }
  console.log(`public: ${snapshot.cloudflare.publicUrl}`);

  let ready = snapshot.cloudflare.publicReady === true;
  const readyDeadline = Date.now() + Math.min(waitMs, 120000);
  let attempt = 0;
  while (!ready && Date.now() < readyDeadline) {
    attempt += 1;
    console.log(`checking public endpoint (attempt ${attempt})...`);
    const check = await fetch(`${BASE}/mgw/cloudflare/check`, { method: 'POST' });
    if (check.ok) {
      snapshot = await check.json();
      ready = snapshot.cloudflare?.publicReady === true;
    }
    if (!ready) await sleep(attempt < 2 ? 2000 : 5000);
  }
  console.log(`public endpoint: ${ready ? 'ready' : 'not ready (the phone may still resolve it)'}`);
  if (!ready) {
    console.log(
      'note: DNS may still be propagating or the host DNS is filtered; the QR page can still work ' +
        'if the phone resolves the hostname.',
    );
  }
  return 0;
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

export function requirePnpm(runCommand = spawnSync) {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm --version'] : ['--version'];
  const result = runCommand(command, args, { encoding: 'utf8', timeout: 15000 });
  if (result.error || result.status !== 0) {
    fail('pnpm is unavailable on PATH; install pnpm@11.9.0 first. DSH Web has not been stopped.');
  }
}

export async function installGatewayRelease(spec, { install = runDsh, check = runChecker, restart } = {}) {
  try {
    if (install(['plugin', '--profile', PROFILE, 'add', spec]) !== 0) {
      fail('dsh plugin add failed; the profile may be partially changed.');
    }
    const after = check();
    if (after.code !== 0) {
      for (const error of after.parsed?.errors ?? []) console.error(`  - ${error}`);
      fail('compatibility check failed after install');
    }
  } catch (error) {
    if (restart) {
      try {
        await restart();
        console.error('DSH Web restarted after the failed installation; resolve the install error before pairing.');
      } catch (restartError) {
        console.error(`Automatic restart failed: ${restartError.message}`);
        console.error('Use your normal DSH Web command to restore the host and inspect the installation.');
      }
    } else {
      console.error('If the host is stopped, use your normal DSH Web command to restore it after resolving the install error.');
    }
    throw error;
  }
}

async function cmdInstall(yes) {
  const manifest = readManifest();
  const pinned = manifest.recommended.gateway;
  const spec = pinned.source ?? '';
  if (!spec.startsWith(`github:solla-h/${PLUGIN_NAME}#v`) || !spec.endsWith(`#v${pinned.version}`)) {
    fail(`unexpected gateway source in compatibility.json: ${spec || '(missing)'}`);
  }
  if (flag('voice') && flag('no-voice')) fail('--voice and --no-voice cannot be combined.');

  const voice = manifest.recommended.voice;
  const voiceFlag = flag('voice') ? true : flag('no-voice') ? false : null;
  const wantStop = flag('stop-web');
  const wantRestart = flag('restart-web');

  const before = runChecker();
  if (!before.parsed) {
    fail('compatibility checker did not return JSON; run "node scripts/check-compat.mjs --profile web"');
  }
  const gatewayInstalled = before.code === 0;
  if (!gatewayInstalled) {
    if (!before.parsed.dsh) {
      fail('cannot determine the DSH version; install DSH or run this in the shell where dsh is available.');
    }
    if (hasDshMismatch(before)) {
      console.error('setup-gateway: DSH does not match compatibility.json:');
      for (const error of before.parsed.errors ?? []) console.error(`  - ${error}`);
      fail('refusing to install; stop and ask the user. Do not upgrade DSH automatically.');
    }
  }

  const needGateway = !gatewayInstalled;
  const needVoice = Boolean(voice && voiceFlag === true && !voiceAssetsReady(voice));
  const needStop = needGateway || needVoice;
  const listening = await isListening(PORT);
  const listenerPid = listening ? findListenerPid(PORT) : null;
  const processInfo = listening ? captureProcess(listenerPid) : null;
  if (processInfo && arg('cwd', null)) processInfo.cwd = path.resolve(arg('cwd', null));
  const canRestart = Boolean(processInfo?.systemdUnit || processInfo?.commandLine);

  if (wantRestart && needStop && !wantStop) {
    fail('--restart-web needs --stop-web so the script can capture how DSH Web was started.');
  }
  if (needStop && listening && !wantStop) {
    fail(
      `DSH Web is listening on ${PORT}. Installing now hot-reloads the plugin tree and can leave ` +
        'sessionController unavailable. Re-run with --stop-web --restart-web to stop and restart it ' +
        'in one command, or stop it manually and run install without --stop-web.',
    );
  }

  if (DRY_RUN) {
    console.log(
      `plan: gateway ${needGateway ? 'install' : 'already installed'}` +
        `${needVoice ? ', voice install' : ''}` +
        `${needStop && listening ? ', stop DSH Web' : ''}` +
        `${needStop && wantRestart ? ', restart DSH Web' : ''}` +
        `${flag('tunnel') ? `, tunnel ${arg('tunnel', null) ?? '(missing mode)'}` : ''}` +
        `${flag('pair') ? ', pairing page' : ''}`,
    );
    if (needStop && listening) {
      console.log(`  DSH Web: pid ${listenerPid ?? '?'}${processInfo?.systemdUnit ? ` (systemd ${processInfo.systemdUnit})` : ''}`);
      if (processInfo?.commandLine) console.log(`  command: ${processInfo.commandLine}`);
      console.log(`  restart: ${wantRestart ? (canRestart ? 'yes' : 'cannot capture the command') : 'no'}`);
    } else if (needStop) {
      console.log('  DSH Web: not running; it cannot be restarted automatically after install.');
    }
    return 0;
  }

  if (needStop && !yes) {
    console.log(`This will install ${spec} into profile "${PROFILE}".`);
    console.log('Run again with --yes. Add --stop-web --restart-web for the one-command path.');
    return 1;
  }

  if (needStop) requirePnpm();

  if (needStop && listening) {
    if (!listenerPid) {
      fail(`DSH Web is listening on ${PORT} but the owning process was not found; stop it manually.`);
    }
    console.log(
      `stopping DSH Web (pid ${listenerPid}` +
        `${processInfo?.systemdUnit ? `, systemd ${processInfo.systemdUnit}` : ''})...`,
    );
    await stopWeb(processInfo);
  } else if (needStop) {
    console.log('DSH Web is not running; continuing without stopping it.');
  } else if (wantStop) {
    console.log('nothing to install; keeping DSH Web running.');
  }

  if (needGateway) {
    console.log(`installing ${spec} into profile "${PROFILE}"...`);
    await installGatewayRelease(spec, {
      restart: listening && wantRestart && canRestart ? () => restartWeb(processInfo) : null,
    });
    console.log('compat: PASS');
  } else {
    console.log(`setup-gateway: ${PLUGIN_NAME}@${pinned.version} is already installed; skipping install.`);
  }

  let enableVoice = false;
  if (voice && voiceFlag === true) {
    enableVoice = needVoice;
    if (!needVoice) console.log('voice: already installed and the model files are present.');
  } else if (voice && voiceFlag === false) {
    if (needGateway) {
      console.log(
        'voice input skipped (--no-voice); later: stop DSH Web, then run ' +
          '"node scripts/setup-gateway.mjs voice".',
      );
    }
  } else if (voice && needGateway) {
    const modelBytes = voice.model?.bytes ?? 241357257;
    enableVoice = await confirm(
      `Enable voice input now? Installs ${voice.source} and downloads ` +
        `~${Math.round(modelBytes / 1_000_000)} MB. [Y/n] `,
    );
    if (!enableVoice) {
      console.log(
        'voice input skipped; later: stop DSH Web, then run "node scripts/setup-gateway.mjs voice".',
      );
    }
  }
  if (enableVoice) {
    try {
      await cmdVoice(true, true);
    } catch (error) {
      console.error(`voice setup failed: ${error.message}`);
      console.error('The gateway is installed; start DSH Web and retry voice later with it stopped.');
    }
  }

  if (needStop) {
    if (wantRestart && canRestart) {
      await restartWeb(processInfo);
    } else {
      console.log(
        'install complete. DSH Web is stopped; start it with your normal command, then run:',
      );
      console.log(
        '  node scripts/setup-gateway.mjs enable' +
          (flag('tunnel') ? ` --tunnel ${arg('tunnel', null) ?? 'quick'}` : '') +
          (flag('pair') ? ' --pair' : ''),
      );
      return 0;
    }
  } else if (!listening && (flag('tunnel') || flag('pair'))) {
    fail('DSH Web is not running; start it first, then rerun with --tunnel/--pair.');
  }

  if (flag('tunnel')) {
    const code = await cmdTunnel(arg('tunnel', null));
    if (code !== 0) return code;
  }
  if (flag('pair')) {
    const code = await cmdPair({ open: flag('open') });
    if (code !== 0) return code;
  }
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

async function cmdPair(options = {}) {
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
  const publicUrl =
    options.publicUrl ??
    arg('url', null) ??
    current.data.publicUrl ??
    current.data.cloudflare?.publicUrl;
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
  const output = path.resolve(
    options.output ?? arg('out', path.join(os.tmpdir(), 'dsh-mobile-pair.html')),
  );
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
  if (!options.publicUrl && !arg('url', null) && current.data.cloudflare?.publicReady === false) {
    console.log(
      'note: the host endpoint check did not pass; the tunnel can still work if the phone can resolve the hostname.',
    );
  }
  console.log('Open the page and scan the QR. Do not paste the code into chat, logs, or screenshots.');
  if (options.open ?? flag('open')) openFile(output);
  return 0;
}

async function cmdHandoff() {
  if (flag('voice') && flag('no-voice')) fail('--voice and --no-voice cannot be combined.');
  const manifest = readManifest();
  const voice = manifest.recommended.voice;
  const voiceFlag = flag('voice') ? ' --voice' : flag('no-voice') ? ' --no-voice' : '';
  const scriptPath = path.join(HERE, 'setup-gateway.mjs');
  const pairUrl = arg('pair-url', null) ?? arg('url', null);
  if ((flag('pair-url') || flag('url')) && pairUrl === null) {
    fail('--pair-url needs a ws:// or wss:// WebSocket URL');
  }
  if (pairUrl !== null) {
    let parsed;
    try {
      parsed = new URL(pairUrl);
    } catch {
      fail('--pair-url must be a ws:// or wss:// WebSocket URL');
    }
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      fail('--pair-url must be a ws:// or wss:// WebSocket URL');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      fail('--pair-url must not contain credentials, query parameters, or a fragment');
    }
  }
  const command = pairUrl
    ? `node "${scriptPath}" install --yes --stop-web --restart-web ` +
      `--pair --open --url "${pairUrl}"${voiceFlag}`
    : `node "${scriptPath}" install --yes --stop-web --restart-web ` +
      `--tunnel quick --pair --open${voiceFlag}`;
  const output = path.resolve(
    arg('out', path.join(process.cwd(), 'DSH-MOBILE-NEXT-STEPS.md')),
  );
  const text = `# DSH Mobile setup — next steps

Run this **in a normal terminal, not inside the DSH Web session**:

\`\`\`bash
${command}
\`\`\`

What it does, in order:

1. captures how DSH Web was started, then stops it (the DSH session UI disappears);
2. installs ${manifest.recommended.gateway.version} into profile "${PROFILE}";
3. installs the optional voice bundle and models when --voice is used;
4. starts DSH Web again in the background (log path is printed);
5. enables the mobile gateway;
${
  pairUrl
    ? `6. pairs through the existing named-tunnel endpoint ${pairUrl} (no Quick Tunnel is started);`
    : '6. opens a Quick Tunnel and waits for the public endpoint;'
}
7. writes and opens the pairing QR page.

After the command, scan the QR with the DSH Mobile app. The original DSH session
is still in the session list after restart; open it again instead of starting over.

${
  pairUrl
    ? `The endpoint ${pairUrl} must be reachable from the phone, route only to the
gateway's WebSocket listener, and have Cloudflare Access disabled (the app cannot
complete a browser login). Prefer the dedicated tunnel proxy on 3082, or the
WS-only LAN listener on 3081. Never point it at the DSH Web UI or /mgw.
`
    : ''
}
If restart fails, the script prints the restart log path. Start DSH Web with your
normal command, then run:

\`\`\`bash
${
  pairUrl
    ? `node scripts/setup-gateway.mjs enable --pair --open --url "${pairUrl}"`
    : 'node scripts/setup-gateway.mjs enable --tunnel quick --pair --open'
}
\`\`\`

If a model turn reports MISSING_CREDENTIAL, the provider key was not available
to the restarted process. Save it in ~/.dsh/.credentials.yaml under \`refs\`
(the credentials store is watched and reloads without a restart), or start
DSH Web with the provider environment variable set.

Do not paste the QR payload, pairing code, device token, or this page into chat,
logs, issues, or screenshots.
`;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, text, { mode: 0o600 });
  console.log(`handoff: ${output}`);
  console.log('Run this in a normal terminal (not inside the DSH Web session):');
  console.log(`  ${command}`);
  return 0;
}

function usage() {
  console.log(`usage:
  node scripts/setup-gateway.mjs check   [--profile web] [--port 3080] [--json]
  node scripts/setup-gateway.mjs handoff [--voice|--no-voice]
                                         [--pair-url wss://HOST/ws/mobile] [--out FILE]
  node scripts/setup-gateway.mjs install [--profile web] [--yes] [--voice|--no-voice]
                                         [--stop-web] [--restart-web]
                                         [--tunnel quick] [--pair] [--url URL] [--open] [--dry-run]
  node scripts/setup-gateway.mjs enable  [--port 3080]
  node scripts/setup-gateway.mjs tunnel  [--port 3080] [--wait SECONDS]
  node scripts/setup-gateway.mjs pair    [--port 3080] [--url URL] [--out FILE] [--open]
  node scripts/setup-gateway.mjs voice   [--profile web] [--yes] [--no-download]

check and handoff are read-only and safe for an agent. handoff writes the
one-command plan to a file and prints it, so the remaining steps survive the
DSH Web stop. install and voice must be run by the user in a normal shell;
install refuses to touch a running DSH Web unless --stop-web is given.`);
}

async function main() {
  const command = process.argv[2] ?? 'check';
  if (command === 'help' || flag('help')) {
    usage();
    return 0;
  }
  if (command === 'check') return cmdCheck(flag('json'));
  if (command === 'handoff') return cmdHandoff();
  if (command === 'install') return cmdInstall(flag('yes'));
  if (command === 'enable') return cmdEnable();
  if (command === 'tunnel') return cmdTunnel(arg('tunnel', 'quick'));
  if (command === 'pair') return cmdPair();
  if (command === 'voice') return cmdVoice(flag('yes'), !flag('no-download'));
  usage();
  return 2;
}

const invokedDirectly = process.argv[1] && fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
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
}
