#!/usr/bin/env node
/**
 * Check a DSH profile against compatibility.json.
 *
 * Usage:
 *   node scripts/check-compat.mjs --profile web
 *   node scripts/check-compat.mjs --plugin 0.12.0-rdv.1 --dsh 0.2.1-rc.5 --protocol 3
 *   node scripts/check-compat.mjs --manifest /tmp/compatibility.json --profile web
 *
 * The profile dependency must be the pinned GitHub release source in
 * compatibility.json, not merely a package whose version string happens to
 * match. Equivalent GitHub spellings of the same owner/repository/tag are
 * accepted; registry ranges, npm aliases, mutable refs, and local paths are
 * rejected. This is a source-name check, not cryptographic verification of the
 * downloaded archive.
 *
 * Exit code 0 = exact verified combination; 1 = mismatch or missing data.
 * The script is dependency-free (see docs/AGENT-SETUP.md for the standalone
 * two-file checker / three-file setup contract) and never reads tokens,
 * credentials or pairing data.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = path.resolve(HERE, '..', 'compatibility.json');
const PLUGIN_NAME = 'dsh-plugin-mobile-gateway';
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const GITHUB_REPO = /^[A-Za-z0-9._-]+$/;

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

/** Truncate and strip control characters from values that came from the host. */
function safeLabel(value, max = 80) {
  if (value === null || value === undefined) return null;
  let text = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ');
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return text;
}

/**
 * Remove credentials and long arbitrary content before echoing a dependency
 * spec. The result is informational only; parsing never uses it.
 */
export function sanitizeSpec(spec) {
  if (spec === null || spec === undefined) return null;
  let text = String(spec).trim();
  text = text.replace(
    /^((?:git\+)?[a-z][a-z0-9+.-]*:\/\/)([^/]*@)/i,
    (_match, prefix, userinfo) =>
      userinfo.toLowerCase() === 'git@' ? `${prefix}${userinfo}` : `${prefix}***@`,
  );
  text = text.replace(/\?.*$/, '?…');
  if (text.length > 160) text = `${text.slice(0, 159)}…`;
  return text;
}

function versionFromRef(ref) {
  if (!ref) return null;
  const match = ref.match(/^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
  return match ? match[1] : null;
}

/**
 * Parse a GitHub dependency source into one canonical form.
 *
 * Accepted: github:OWNER/REPO[.git]#REF, OWNER/REPO[.git]#REF, and the git
 * HTTPS/SSH spellings with a github.com host. A ref is required so a default
 * branch cannot stand in for a release. Other hosts, subpaths, tarball URLs,
 * userinfo credentials, and semver ranges are rejected.
 */
function parseGitHubSource(spec) {
  if (typeof spec !== 'string') return null;
  let text = spec.trim();
  if (!text || /\s/.test(text)) return null;

  let ref = null;
  const hash = text.indexOf('#');
  if (hash >= 0) {
    ref = text.slice(hash + 1);
    text = text.slice(0, hash);
    if (!ref || ref.includes('#') || /^semver:/i.test(ref)) return null;
  }

  const prefixes = [
    'github:',
    'git+https://github.com/',
    'https://github.com/',
    'git+ssh://git@github.com/',
    'ssh://git@github.com/',
    'git@github.com:',
  ];
  let ownerRepo = null;
  const lower = text.toLowerCase();
  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      ownerRepo = text.slice(prefix.length);
      break;
    }
  }
  if (ownerRepo === null && /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+(?:\.git)?$/.test(text)) {
    ownerRepo = text;
  }
  if (ownerRepo === null) return null;
  if (ownerRepo.includes('?') || ownerRepo.includes('@')) return null;

  const parts = ownerRepo.split('/');
  if (parts.length !== 2) return null;
  let [owner, repo] = parts;
  if (repo.toLowerCase().endsWith('.git')) repo = repo.slice(0, -4);
  if (!GITHUB_OWNER.test(owner) || !GITHUB_REPO.test(repo)) return null;

  let decodedRef = null;
  if (ref !== null) {
    try {
      decodedRef = decodeURIComponent(ref);
    } catch {
      return null;
    }
    if (!decodedRef || /[\s#?]/.test(decodedRef)) return null;
  }

  const canonicalOwner = owner.toLowerCase();
  const canonicalRepo = repo.toLowerCase();
  return {
    host: 'github.com',
    owner: canonicalOwner,
    repo: canonicalRepo,
    ref: decodedRef,
    canonical: `github:${canonicalOwner}/${canonicalRepo}${
      decodedRef ? `#${decodedRef}` : ''
    }`,
  };
}

/**
 * Classify a dependency value from a profile package.json or --plugin.
 * `kind` is one of missing, local, version, source, unsupported.
 */
export function normalizePluginSpec(spec) {
  if (!spec) {
    return { raw: null, kind: 'missing', version: null, local: false, source: null };
  }
  const text = String(spec).trim();
  if (
    /^(?:file|link|workspace|portal|catalog):/i.test(text) ||
    /^(?:\.{1,2}[\\/]|[A-Za-z]:[\\/]|\\\\|~[\\/])/.test(text) ||
    text.startsWith('/')
  ) {
    return { raw: spec, kind: 'local', version: null, local: true, source: null };
  }
  if (EXACT_VERSION.test(text)) {
    return { raw: spec, kind: 'version', version: text, local: false, source: null };
  }
  const source = parseGitHubSource(text);
  if (source) {
    return {
      raw: spec,
      kind: 'source',
      version: versionFromRef(source.ref),
      local: false,
      source,
    };
  }
  return { raw: spec, kind: 'unsupported', version: null, local: false, source: null };
}

/**
 * Evaluate a plugin dependency against the pinned release.
 *
 * `allowVersionOnly` is for the explicit --plugin VERSION form only. A profile
 * dependency must carry the GitHub source; an exact registry version is not
 * equivalent to the fork release.
 */
export function checkPlugin({
  spec,
  installedVersion = null,
  expectedSource,
  expectedVersion,
  allowVersionOnly = false,
  profile = 'web',
  profileFile = null,
} = {}) {
  const errors = [];
  const plugin = normalizePluginSpec(spec);
  const expected = parseGitHubSource(expectedSource);
  const expectedRefVersion = expected ? versionFromRef(expected.ref) : null;
  const manifestOk = Boolean(expected && expected.ref && expectedRefVersion && expectedVersion);
  if (expectedSource !== `github:solla-h/${PLUGIN_NAME}#v${expectedVersion}`) {
    errors.push('compatibility.json must use the canonical github: source required by the installer');
  }

  if (!expected || !expected.ref || !expectedRefVersion) {
    errors.push('compatibility.json recommended gateway source is not a pinned GitHub release');
  } else if (!expectedVersion) {
    errors.push('compatibility.json has no recommended gateway version');
  } else if (expectedRefVersion !== expectedVersion) {
    errors.push(
      `compatibility.json gateway source tag ${expected.ref} does not match recommended ${expectedVersion}`,
    );
  }

  if (!plugin.raw) {
    errors.push(
      `plugin not installed in profile "${profile}"${profileFile ? ` (${profileFile})` : ''}`,
    );
  } else if (plugin.local) {
    errors.push('local plugin spec is not allowed; install the pinned GitHub release');
  } else if (plugin.source) {
    if (manifestOk && plugin.source.canonical !== expected.canonical) {
      errors.push(
        `plugin source is not the recommended GitHub release: expected ${expected.canonical}`,
      );
    }
    if (!plugin.version) {
      errors.push('cannot determine an exact plugin version from the configured plugin source');
    }
  } else if (plugin.kind === 'version' && allowVersionOnly) {
    if (expectedVersion && plugin.version !== expectedVersion) {
      errors.push(`plugin ${plugin.version} != recommended ${expectedVersion}`);
    }
  } else {
    errors.push(
      'plugin source is not a pinned GitHub release; use the source from compatibility.json',
    );
  }

  if (
    plugin.kind === 'source' &&
    plugin.version &&
    expectedVersion &&
    plugin.version !== expectedVersion
  ) {
    errors.push(`plugin ${plugin.version} != recommended ${expectedVersion}`);
  }

  if (plugin.raw && !plugin.local) {
    if (!installedVersion) {
      errors.push(`installed package not found for profile "${profile}"; run the pinned install`);
    } else if (installedVersion !== expectedVersion) {
      errors.push(
        `installed plugin ${safeLabel(installedVersion)} != recommended ${expectedVersion}`,
      );
    }
  }

  return { errors, plugin, expected };
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
    return versionOf(output);
  } catch {
    return null;
  }
}

function main() {
  if (flag('help')) {
    console.log(
      'usage: node scripts/check-compat.mjs [--manifest FILE] [--profile web] ' +
        '[--plugin VERSION|SOURCE] [--dsh VERSION] [--protocol N] [--json]',
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

  const expected = manifest.recommended;
  const fromProfile = readPluginSpec(profile);
  const pluginSpec = explicitPlugin ?? fromProfile.spec;

  const checks = checkPlugin({
    spec: pluginSpec,
    installedVersion: fromProfile.installedVersion,
    expectedSource: expected.gateway.source,
    expectedVersion: expected.gateway.version,
    allowVersionOnly: explicitPlugin !== null,
    profile,
    profileFile: fromProfile.packageFile,
  });
  const errors = [...checks.errors];

  // Every override still requires the actual profile's pinned source.
  if (explicitPlugin !== null && !fromProfile.spec) {
    errors.push('cannot verify plugin source: the profile dependency is missing');
  }

  if (explicitPlugin !== null && fromProfile.spec) {
    const profileChecks = checkPlugin({
      spec: fromProfile.spec,
      installedVersion: fromProfile.installedVersion,
      expectedSource: expected.gateway.source,
      expectedVersion: expected.gateway.version,
      allowVersionOnly: false,
      profile,
      profileFile: fromProfile.packageFile,
    });
    for (const error of profileChecks.errors) {
      if (!errors.includes(error)) errors.push(error);
    }
  }

  const plugin = checks.plugin;
  const dsh = versionOf(explicitDsh ?? readDshVersion());
  const protocol = explicitProtocol === null ? null : Number(explicitProtocol);

  if (!dsh) {
    errors.push('cannot determine DSH version (pass --dsh VERSION)');
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
      spec: sanitizeSpec(plugin.raw),
      version: plugin.version,
      installedVersion: safeLabel(fromProfile.installedVersion),
      local: plugin.local,
      source: plugin.source ? sanitizeSpec(plugin.source.canonical) : null,
    },
    dsh,
    expected: {
      plugin: expected.gateway.version,
      dsh: expected.dsh.version,
      protocol: manifest.protocol.version,
    },
    profileFile: fromProfile.packageFile,
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

const invokedDirectly = process.argv[1] && fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exitCode = main();
}
