import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkPlugin, normalizePluginSpec, sanitizeSpec } from '../check-compat.mjs';

const EXPECTED_SOURCE = 'github:solla-h/dsh-plugin-mobile-gateway#v0.12.0-rdv.3';
const EXPECTED_VERSION = '0.12.0-rdv.3';
const FIXTURE_PROFILE = '__compat_check_fixture_do_not_create__';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function withProfile(spec, callback) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-compat-profile-'));
  try {
    const profile = path.join(tmp, '.dsh', 'profiles', FIXTURE_PROFILE);
    const installed = path.join(profile, 'node_modules', 'dsh-plugin-mobile-gateway');
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ version: EXPECTED_VERSION }));
    if (spec !== null) {
      fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
        dependencies: { 'dsh-plugin-mobile-gateway': spec },
      }));
    }
    const preload = path.join(tmp, 'fixture-home.mjs');
    fs.writeFileSync(preload, "import os from 'node:os'; os.homedir = () => process.env.DSH_COMPAT_FIXTURE_ROOT;\n");
    const run = (override, entry = path.join(ROOT, 'scripts', 'check-compat.mjs')) => spawnSync(
      process.execPath,
      ['--import', pathToFileURL(preload).href, entry, '--manifest', path.join(ROOT, 'compatibility.json'),
        '--profile', FIXTURE_PROFILE, '--dsh', '0.2.1-rc.5', '--json',
        ...(override === null ? [] : ['--plugin', override])],
      { encoding: 'utf8', env: { ...process.env, DSH_COMPAT_FIXTURE_ROOT: tmp } },
    );
    callback(run, tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('manual version override cannot conceal the identical registry dependency', () => {
  withProfile(EXPECTED_VERSION, (run) => {
    const result = run(EXPECTED_VERSION);
    assert.equal(result.status, 1, result.stdout);
    assert.ok(JSON.parse(result.stdout).errors.some(e => e.includes('not a pinned GitHub release')));
  });
});

test('manual source override still requires an actual profile dependency', () => {
  withProfile(null, (run) => {
    const result = run(EXPECTED_SOURCE);
    assert.equal(result.status, 1, result.stdout);
    assert.ok(JSON.parse(result.stdout).errors.some(e => e.includes('profile dependency is missing')));
  });
});

test('manual version override accepts an installed profile from the pinned source', () => {
  withProfile(EXPECTED_SOURCE, (run) => {
    const result = run(EXPECTED_VERSION);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
  });
});

test('a symlinked checker executes and rejects a wrong profile source', () => {
  withProfile('github:other-owner/dsh-plugin-mobile-gateway#v0.12.0-rdv.3', (run, tmp) => {
    const alias = path.join(tmp, 'scripts-alias');
    fs.symlinkSync(path.join(ROOT, 'scripts'), alias, 'junction');
    const result = run(null, path.join(alias, 'check-compat.mjs'));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, false);
  });
});

function errorsFor(spec, options = {}) {
  return checkPlugin({
    spec,
    installedVersion: EXPECTED_VERSION,
    expectedSource: EXPECTED_SOURCE,
    expectedVersion: EXPECTED_VERSION,
    profile: FIXTURE_PROFILE,
    ...options,
  }).errors;
}

test('accepts the pinned source and documented equivalent GitHub spellings', () => {
  const forms = [
    EXPECTED_SOURCE,
    'github:solla-h/dsh-plugin-mobile-gateway.git#v0.12.0-rdv.3',
    'solla-h/dsh-plugin-mobile-gateway#v0.12.0-rdv.3',
    'https://github.com/solla-h/dsh-plugin-mobile-gateway#v0.12.0-rdv.3',
    'https://github.com/solla-h/dsh-plugin-mobile-gateway.git#v0.12.0-rdv.3',
    'git+https://github.com/solla-h/dsh-plugin-mobile-gateway.git#v0.12.0-rdv.3',
    'git+ssh://git@github.com/solla-h/dsh-plugin-mobile-gateway.git#v0.12.0-rdv.3',
    'git@github.com:solla-h/dsh-plugin-mobile-gateway.git#v0.12.0-rdv.3',
  ];
  for (const spec of forms) {
    assert.deepEqual(errorsFor(spec), [], spec);
    assert.equal(normalizePluginSpec(spec).source?.canonical, EXPECTED_SOURCE, spec);
  }
});

test('treats the GitHub owner and repository case-insensitively', () => {
  assert.deepEqual(errorsFor('github:Solla-H/DSH-Plugin-Mobile-Gateway#v0.12.0-rdv.3'), []);
});

test('rejects a same-version plugin from another owner or repository', () => {
  for (const spec of [
    'github:other-owner/dsh-plugin-mobile-gateway#v0.12.0-rdv.3',
    'github:solla-h/other-repository#v0.12.0-rdv.3',
    'git+https://github.com/other-owner/dsh-plugin-mobile-gateway.git#v0.12.0-rdv.3',
  ]) {
    const errors = errorsFor(spec);
    assert.ok(
      errors.some((error) => error.includes('source is not the recommended GitHub release')),
      spec,
    );
    assert.ok(!errors.some((error) => error.includes('installed package not found')), spec);
    assert.equal(normalizePluginSpec(spec).version, EXPECTED_VERSION, spec);
  }
});

test('rejects mutable refs, missing refs, and non-release tags', () => {
  for (const spec of [
    'github:solla-h/dsh-plugin-mobile-gateway#main',
    'github:solla-h/dsh-plugin-mobile-gateway#master',
    'github:solla-h/dsh-plugin-mobile-gateway',
    'git+https://github.com/solla-h/dsh-plugin-mobile-gateway.git',
  ]) {
    const errors = errorsFor(spec);
    assert.ok(
      errors.some((error) => error.includes('source is not the recommended GitHub release')),
      spec,
    );
  }
});

test('rejects npm aliases, ranges, tags, and registry versions in the profile', () => {
  for (const spec of [
    'npm:dsh-plugin-mobile-gateway@0.12.0-rdv.3',
    'dsh-plugin-mobile-gateway@0.12.0-rdv.3',
    '^0.12.0-rdv.3',
    '~0.12.0-rdv.3',
    '0.12.0-rdv.3',
    'latest',
    'github:solla-h/dsh-plugin-mobile-gateway#semver:^0.12.0-rdv.3',
  ]) {
    const errors = errorsFor(spec);
    assert.ok(
      errors.some((error) => error.includes('not a pinned GitHub release')),
      spec,
    );
  }
});

test('rejects local paths and link/file dependencies', () => {
  for (const spec of [
    'file:../dsh-plugin-mobile-gateway',
    'link:../dsh-plugin-mobile-gateway',
    'workspace:*',
    '../dsh-plugin-mobile-gateway',
    'C:\\work\\dsh-plugin-mobile-gateway',
    '/opt/dsh-plugin-mobile-gateway',
  ]) {
    const parsed = normalizePluginSpec(spec);
    assert.equal(parsed.local, true, spec);
    assert.ok(
      errorsFor(spec).some((error) => error.includes('local plugin spec is not allowed')),
      spec,
    );
  }
});

test('accepts a bare exact version only for an explicit --plugin override', () => {
  assert.deepEqual(
    checkPlugin({
      spec: EXPECTED_VERSION,
      allowVersionOnly: true,
      installedVersion: EXPECTED_VERSION,
      expectedSource: EXPECTED_SOURCE,
      expectedVersion: EXPECTED_VERSION,
      profile: FIXTURE_PROFILE,
    }).errors,
    [],
  );
  assert.ok(
    errorsFor('0.12.0-rdv.2', { allowVersionOnly: true }).some((error) =>
      error.includes('plugin 0.12.0-rdv.2 != recommended 0.12.0-rdv.3'),
    ),
  );
});

test('checks the installed package even when --plugin is explicit', () => {
  const base = {
    spec: EXPECTED_VERSION,
    allowVersionOnly: true,
    expectedSource: EXPECTED_SOURCE,
    expectedVersion: EXPECTED_VERSION,
    profile: FIXTURE_PROFILE,
  };
  assert.ok(
    checkPlugin({ ...base, installedVersion: null }).errors.some((error) =>
      error.includes('installed package not found'),
    ),
  );
  assert.ok(
    checkPlugin({ ...base, installedVersion: '0.12.0-rdv.2' }).errors.some((error) =>
      error.includes('installed plugin 0.12.0-rdv.2 != recommended 0.12.0-rdv.3'),
    ),
  );
});

test('manifest retains the canonical source spelling required by the installer', () => {
  const errors = errorsFor(EXPECTED_SOURCE, {
    expectedSource: 'https://github.com/solla-h/dsh-plugin-mobile-gateway.git#v0.12.0-rdv.3',
  });
  assert.ok(errors.some(e => e.includes('canonical github: source')));
});

test('rejects an installed package whose version differs from the release', () => {
  assert.ok(
    errorsFor(EXPECTED_SOURCE, { installedVersion: '0.12.0-rdv.2' }).some((error) =>
      error.includes('installed plugin 0.12.0-rdv.2 != recommended 0.12.0-rdv.3'),
    ),
  );
  assert.ok(
    errorsFor(EXPECTED_SOURCE, { installedVersion: null }).some((error) =>
      error.includes('installed package not found'),
    ),
  );
});

test('rejects a manifest whose source tag does not match its version', () => {
  const { errors } = checkPlugin({
    spec: EXPECTED_SOURCE,
    installedVersion: EXPECTED_VERSION,
    expectedSource: 'github:solla-h/dsh-plugin-mobile-gateway#v0.12.0-rdv.2',
    expectedVersion: EXPECTED_VERSION,
    profile: FIXTURE_PROFILE,
  });
  assert.ok(
    errors.some((error) => error.includes('gateway source tag v0.12.0-rdv.2 does not match')),
  );
});

test('does not leak credential-bearing source strings in diagnostics', () => {
  const secret = 'ghp_test_secret_value';
  const spec = `https://user:${secret}@github.com/solla-h/dsh-plugin-mobile-gateway.git#v0.12.0-rdv.3`;
  for (const error of errorsFor(spec)) {
    assert.ok(!error.includes(secret), error);
  }
  const safe = sanitizeSpec(spec);
  assert.ok(!safe.includes(secret));
  assert.ok(safe.includes('***@'));
  const ssh = 'git+ssh://git@github.com/solla-h/dsh-plugin-mobile-gateway.git#v0.12.0-rdv.3';
  assert.equal(sanitizeSpec(ssh), ssh);
});

test('rejects non-GitHub hosts, subpaths, and tarball URLs', () => {
  for (const spec of [
    'https://gitlab.com/solla-h/dsh-plugin-mobile-gateway.git#v0.12.0-rdv.3',
    'https://github.com.evil.example/solla-h/dsh-plugin-mobile-gateway#v0.12.0-rdv.3',
    'https://github.com/solla-h/dsh-plugin-mobile-gateway/tree/v0.12.0-rdv.3',
    'https://github.com/solla-h/dsh-plugin-mobile-gateway/archive/v0.12.0-rdv.3.tar.gz',
  ]) {
    assert.ok(
      errorsFor(spec).some((error) => error.includes('not a pinned GitHub release')),
      spec,
    );
  }
});

test('standalone checker copy rejects a same-version wrong source over the CLI', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-compat-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'));
    fs.copyFileSync(
      path.join(ROOT, 'compatibility.json'),
      path.join(tmp, 'compatibility.json'),
    );
    fs.copyFileSync(
      path.join(ROOT, 'scripts', 'check-compat.mjs'),
      path.join(tmp, 'scripts', 'check-compat.mjs'),
    );
    const run = (spec) =>
      spawnSync(
        process.execPath,
        [
          path.join(tmp, 'scripts', 'check-compat.mjs'),
          '--profile',
          FIXTURE_PROFILE,
          '--plugin',
          spec,
          '--dsh',
          '0.2.1-rc.5',
          '--protocol',
          '3',
          '--json',
        ],
        { encoding: 'utf8' },
      );

    const wrong = run('github:other-owner/dsh-plugin-mobile-gateway#v0.12.0-rdv.3');
    assert.equal(wrong.status, 1, wrong.stderr);
    const wrongJson = JSON.parse(wrong.stdout);
    assert.equal(wrongJson.plugin.version, EXPECTED_VERSION);
    assert.equal(
      wrongJson.plugin.source,
      'github:other-owner/dsh-plugin-mobile-gateway#v0.12.0-rdv.3',
    );
    assert.ok(
      wrongJson.errors.some((error) =>
        error.includes('source is not the recommended GitHub release'),
      ),
    );

    const right = run(EXPECTED_SOURCE);
    assert.equal(right.status, 1, right.stderr);
    const rightJson = JSON.parse(right.stdout);
    assert.equal(rightJson.plugin.source, EXPECTED_SOURCE);
    assert.ok(
      !rightJson.errors.some((error) => error.includes('source is not the recommended')),
    );
    assert.ok(
      rightJson.errors.some((error) => error.includes('installed package not found')),
    );

    const versionOnly = run(EXPECTED_VERSION);
    assert.equal(versionOnly.status, 1, versionOnly.stderr);
    assert.ok(
      JSON.parse(versionOnly.stdout).errors.some((error) =>
        error.includes('cannot verify plugin source'),
      ),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
