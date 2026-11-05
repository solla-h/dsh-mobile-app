#!/usr/bin/env node
/**
 * Check a DSH profile against compatibility.json.
 *
 * Usage:
 *   node scripts/check-compat.mjs --profile web
 *   node scripts/check-compat.mjs --plugin 0.12.0-rdv.1 --dsh 0.2.1-rc.5 --protocol 3
 *   node scripts/check-compat.mjs --manifest /tmp/compatibility.json --profile web
 *
 * Exit code 0 = exact verified combination; 1 = mismatch or missing data.
 * The script is dependency-free and never reads tokens, credentials or pairing data.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = path.resolve(HERE, '..', 'compatibility.json');
const PLUGIN_NAME = 'dsh-plugin-mobile-gateway';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function versionOf(value) {
  const match = String(value ?? '').match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match ? match[0] : null;
}

function normalizePluginSpec(spec) {
  if (!spec) return { raw: null, version: null, local: false };
  if (spec.startsWith('link:') || spec.startsWith('file:')) {
    return { raw: spec, version: null, local: true };
  }
  let candidate = spec;
  if (candidate.startsWith('github:') || candidate.startsWith('git+') || candidate.includes('#')) {
    const hash = candidate.lastIndexOf('#');
    candidate = hash >= 0 ? candidate.slice(hash + 1) : candidate;
  }
  return { raw: spec, version: versionOf(candidate), local: false };
}

function readPluginSpec(profile) {
  const profileDir = path.join(os.homedir(), '.dsh', 'profiles', profile);
  const packageFile = path.join(profileDir, 'package.json');
  const installedFile = path.join(profileDir, 'node_modules', PLUGIN_NAME, 'package.json');
  let installedVersion = null;
  if (fs.existsSync(installedFile)) {
    try {
      installedVersion = readJson(installedFile).version ?? null;
    } catch {
      installedVersion = null;
    }
  }
  if (!fs.existsSync(packageFile)) {
    return { spec: null, packageFile, installedFile, installedVersion };
  }
  const pkg = readJson(packageFile);
  const spec =
    pkg.dependencies?.[PLUGIN_NAME] ??
    pkg.devDependencies?.[PLUGIN_NAME] ??
    null;
  return { spec, packageFile, installedFile, installedVersion };
}

function readDshVersion() {
  try {
    const command = process.platform === 'win32' ? 'cmd.exe' : 'dsh';
    const args =
      process.platform === 'win32' ? ['/c', 'dsh --version'] : ['--version'];
    const output = execFileSync(command, args, {
      encoding: 'utf8',
      timeout: 15000,
    });
    return versionOf(output) ?? output.trim() ?? null;
  } catch {
    return null;
  }
}

function main() {
  if (flag('help')) {
    console.log(
      'usage: node scripts/check-compat.mjs [--manifest FILE] [--profile web] ' +
        '[--plugin VERSION] [--dsh VERSION] [--protocol N] [--json]',
    );
    return 0;
  }

  const manifestFile = path.resolve(arg('manifest', DEFAULT_MANIFEST));
  if (!fs.existsSync(manifestFile)) {
    console.error(`FAIL manifest not found: ${manifestFile}`);
    return 1;
  }
  const manifest = readJson(manifestFile);

  const profile = arg('profile', 'web');
  const explicitPlugin = arg('plugin', null);
  const explicitDsh = arg('dsh', null);
  const explicitProtocol = arg('protocol', null);

  let pluginSpec = explicitPlugin;
  let profileFile = null;
  let installedVersion = null;
  if (!pluginSpec) {
    const fromProfile = readPluginSpec(profile);
    pluginSpec = fromProfile.spec;
    profileFile = fromProfile.packageFile;
    installedVersion = fromProfile.installedVersion;
  }
  const plugin = normalizePluginSpec(pluginSpec);
  const dsh = versionOf(explicitDsh ?? readDshVersion());
  const protocol = explicitProtocol === null ? null : Number(explicitProtocol);

  const errors = [];
  if (!plugin.raw) {
    errors.push(`plugin not installed in profile "${profile}"${profileFile ? ` (${profileFile})` : ''}`);
  } else if (plugin.local) {
    errors.push(`local plugin spec is not allowed: ${plugin.raw}`);
  } else if (!plugin.version) {
    errors.push(`cannot determine an exact plugin version from: ${plugin.raw}`);
  }

  if (!dsh) {
    errors.push('cannot determine DSH version (pass --dsh VERSION)');
  }

  const expected = manifest.recommended;
  if (plugin.version && plugin.version !== expected.gateway.version) {
    errors.push(`plugin ${plugin.version} != recommended ${expected.gateway.version}`);
  }
  if (plugin.raw && !plugin.local && !installedVersion) {
    errors.push(`installed package not found for profile "${profile}"; run the pinned install`);
  } else if (installedVersion && installedVersion !== expected.gateway.version) {
    errors.push(`installed plugin ${installedVersion} != recommended ${expected.gateway.version}`);
  }
  if (dsh && dsh !== expected.dsh.version) {
    errors.push(`DSH ${dsh} != recommended ${expected.dsh.version}`);
  }

  if (protocol !== null && protocol !== manifest.protocol.version) {
    errors.push(`protocol ${protocol} != supported ${manifest.protocol.version}`);
  }

  // Keep the manifest honest about the app it describes.
  const appJsonFile = path.resolve(HERE, '..', 'app.json');
  let appVersion = manifest.app.version;
  if (fs.existsSync(appJsonFile)) {
    const appVersionFromFile = readJson(appJsonFile)?.expo?.version;
    if (appVersionFromFile && appVersionFromFile !== manifest.app.version) {
      errors.push(
        `app.json ${appVersionFromFile} != compatibility.json ${manifest.app.version}`,
      );
    }
  }

  const result = {
    ok: errors.length === 0,
    app: appVersion,
    protocol: protocol ?? manifest.protocol.version,
    plugin: {
      spec: plugin.raw,
      version: plugin.version,
      installedVersion,
      local: plugin.local,
    },
    dsh,
    expected: {
      plugin: expected.gateway.version,
      dsh: expected.dsh.version,
      protocol: manifest.protocol.version,
    },
    profileFile,
    errors,
  };

  if (flag('json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(
      `PASS app ${result.app} | gateway ${plugin.version} | DSH ${dsh} | protocol ${result.protocol}`,
    );
  } else {
    console.log(
      `FAIL app ${result.app} | gateway ${plugin.version ?? '?'} | DSH ${dsh ?? '?'} | ` +
        `protocol ${result.protocol}`,
    );
    for (const error of errors) console.log(`  - ${error}`);
    console.log(`  expected: gateway ${expected.gateway.version}, DSH ${expected.dsh.version}`);
  }

  return result.ok ? 0 : 1;
}

process.exitCode = main();
