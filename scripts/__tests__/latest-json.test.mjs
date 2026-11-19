import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLatestManifest } from '../latest-json.mjs';

const ANDROID_PACKAGE = 'app.dshmobile.client';
const DOWNLOAD_BASE =
  'https://github.com/solla-h/dsh-mobile-app/releases/download';
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'latest-json.mjs');

function fullCompatibility(version) {
  return {
    app: { version },
    protocol: { version: 3 },
    recommended: {
      gateway: { version: '0.12.0-rdv.3' },
      dsh: { version: '0.2.1-rc.5' },
      voice: { version: '0.2.1-rc.5' },
    },
  };
}

function input({
  tag = 'v1.2.3',
  version = '1.2.3',
  versionCode = 42,
  compatibility = fullCompatibility(version),
  releaseNotes,
  packageName = ANDROID_PACKAGE,
} = {}) {
  const args = {
    tag,
    packageJson: { version },
    appJson: {
      expo: {
        version,
        android: { package: packageName, versionCode },
      },
    },
    compatibility,
  };
  if (releaseNotes !== undefined) args.releaseNotes = releaseNotes;
  return args;
}

test('builds a complete manifest for stable and prerelease tags', () => {
  const required = {
    gateway: '0.12.0-rdv.3',
    dsh: '0.2.1-rc.5',
    voice: '0.2.1-rc.5',
    protocol: 3,
  };

  for (const tag of ['v1.2.3', 'v1.2.3-alpha.1', 'v1.2.3-rc.2']) {
    const core = tag.slice(1).split('-')[0];
    assert.deepEqual(buildLatestManifest(input({ tag, version: core })), {
      version: core,
      versionCode: 42,
      tag,
      apkUrl: `${DOWNLOAD_BASE}/${tag}/dsh-mobile-${tag}.apk`,
      sha256Url: `${DOWNLOAD_BASE}/${tag}/SHA256SUMS`,
      required,
    });
  }
});

test('publishes identical zh-CN and en release notes when given', () => {
  const notes = '## Changes\n- Fix session reconnect\n';
  assert.deepEqual(
    buildLatestManifest(input({ releaseNotes: notes })).releaseNotes,
    { 'zh-CN': notes, en: notes },
  );
});

test('omits releaseNotes when absent, empty or whitespace only', () => {
  for (const releaseNotes of [undefined, '', '   \n\t']) {
    const manifest = buildLatestManifest(input({ releaseNotes }));
    assert.equal('releaseNotes' in manifest, false, JSON.stringify(releaseNotes));
  }
});

test('maps every required entry from compatibility.json', () => {
  assert.deepEqual(buildLatestManifest(input()).required, {
    gateway: '0.12.0-rdv.3',
    dsh: '0.2.1-rc.5',
    voice: '0.2.1-rc.5',
    protocol: 3,
  });
});

test('omits required entries whose source value is missing', () => {
  const withoutGateway = fullCompatibility('1.2.3');
  delete withoutGateway.recommended.gateway;
  assert.deepEqual(
    buildLatestManifest(input({ compatibility: withoutGateway })).required,
    { dsh: '0.2.1-rc.5', voice: '0.2.1-rc.5', protocol: 3 },
  );

  const withoutDsh = fullCompatibility('1.2.3');
  delete withoutDsh.recommended.dsh;
  assert.deepEqual(
    buildLatestManifest(input({ compatibility: withoutDsh })).required,
    { gateway: '0.12.0-rdv.3', voice: '0.2.1-rc.5', protocol: 3 },
  );

  const withoutVoice = fullCompatibility('1.2.3');
  delete withoutVoice.recommended.voice;
  assert.deepEqual(
    buildLatestManifest(input({ compatibility: withoutVoice })).required,
    { gateway: '0.12.0-rdv.3', dsh: '0.2.1-rc.5', protocol: 3 },
  );

  const withoutProtocol = fullCompatibility('1.2.3');
  delete withoutProtocol.protocol;
  assert.deepEqual(
    buildLatestManifest(input({ compatibility: withoutProtocol })).required,
    { gateway: '0.12.0-rdv.3', dsh: '0.2.1-rc.5', voice: '0.2.1-rc.5' },
  );

  // protocol is independent of recommended, so it survives on its own.
  const protocolOnly = fullCompatibility('1.2.3');
  delete protocolOnly.recommended;
  assert.deepEqual(
    buildLatestManifest(input({ compatibility: protocolOnly })).required,
    { protocol: 3 },
  );
});

test('omits the whole required field when no source value exists', () => {
  const empty = fullCompatibility('1.2.3');
  delete empty.protocol;
  delete empty.recommended;

  const manifest = buildLatestManifest(input({ compatibility: empty }));
  assert.equal('required' in manifest, false);
});

test('rejects invalid release tags and manifest mismatches', () => {
  for (const tag of ['1.2.3', 'v1.2', 'v1.2.3-dev.1']) {
    assert.throws(
      () => buildLatestManifest(input({ tag })),
      /invalid release tag/,
      tag,
    );
  }

  assert.throws(
    () => buildLatestManifest(input({ version: '1.2.4' })),
    /package\.json version/,
  );
});

test('rejects malformed required versions', () => {
  for (const value of ['1.2', 'v1.2.3', '1.2.3 beta', '1.2.3\n', 1.2]) {
    const compatibility = fullCompatibility('1.2.3');
    compatibility.recommended.gateway.version = value;
    assert.throws(
      () => buildLatestManifest(input({ compatibility })),
      /recommended\.gateway\.version/,
      String(value),
    );
  }
});

test('rejects a non-positive-integer protocol version', () => {
  for (const protocol of ['3', null, 3.5, NaN, 0, -1]) {
    const compatibility = fullCompatibility('1.2.3');
    compatibility.protocol.version = protocol;
    assert.throws(
      () => buildLatestManifest(input({ compatibility })),
      /protocol\.version/,
      String(protocol),
    );
  }
});

test('does not mutate its input objects', () => {
  const args = input({ releaseNotes: 'notes' });
  const snapshot = structuredClone(args);

  buildLatestManifest(args);

  assert.deepEqual(args, snapshot);
});

test('CLI prints the manifest for the real repository files', () => {
  // cwd is a temp directory, proving the root comes from the script location.
  const output = execFileSync(
    process.execPath,
    [SCRIPT, 'v0.1.0-alpha.5'],
    { cwd: os.tmpdir(), encoding: 'utf8' },
  );
  const manifest = JSON.parse(output);

  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.versionCode, 5);
  assert.equal(manifest.tag, 'v0.1.0-alpha.5');
  assert.equal(
    manifest.apkUrl,
    `${DOWNLOAD_BASE}/v0.1.0-alpha.5/dsh-mobile-v0.1.0-alpha.5.apk`,
  );
  assert.equal(
    manifest.sha256Url,
    `${DOWNLOAD_BASE}/v0.1.0-alpha.5/SHA256SUMS`,
  );
  assert.deepEqual(manifest.required, {
    gateway: '0.12.0-rdv.3',
    dsh: '0.2.1-rc.5',
    voice: '0.2.1-rc.5',
    protocol: 3,
  });
  assert.equal('releaseNotes' in manifest, false);
});

test('CLI reads NOTES_FILE and rejects a wrong argument count', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latest-json-'));
  try {
    const notesFile = path.join(dir, 'notes.md');
    fs.writeFileSync(notesFile, 'Release notes\n');

    const output = execFileSync(
      process.execPath,
      [SCRIPT, 'v0.1.0-alpha.5', notesFile],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.deepEqual(JSON.parse(output).releaseNotes, {
      'zh-CN': 'Release notes\n',
      en: 'Release notes\n',
    });

    assert.throws(
      () => execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' }),
      (error) => error.status === 1 && /usage:/.test(error.stderr),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
