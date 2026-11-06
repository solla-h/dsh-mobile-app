import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReleaseMetadata } from '../release-metadata.mjs';

const ANDROID_PACKAGE = 'app.dshmobile.client';

function input({
  tag = 'v1.2.3',
  packageVersion = '1.2.3',
  expoVersion = '1.2.3',
  compatibilityVersion = '1.2.3',
  versionCode = 42,
  packageName = ANDROID_PACKAGE,
} = {}) {
  return {
    tag,
    packageJson: { version: packageVersion },
    appJson: {
      expo: {
        version: expoVersion,
        android: { package: packageName, versionCode },
      },
    },
    compatibility: { app: { version: compatibilityVersion } },
  };
}

test('accepts a stable tag and returns release metadata', () => {
  assert.deepEqual(validateReleaseMetadata(input()), {
    tag: 'v1.2.3',
    version: '1.2.3',
    versionCode: 42,
    apkName: 'dsh-mobile-v1.2.3.apk',
  });
});

test('accepts canonical zero segments and alpha/beta/rc prereleases', () => {
  for (const tag of ['v0.1.0', 'v1.2.3-alpha.1', 'v1.2.3-beta.2', 'v1.2.3-rc.0']) {
    const core = tag.slice(1).split('-')[0];
    const result = validateReleaseMetadata(
      input({
        tag,
        packageVersion: core,
        expoVersion: core,
        compatibilityVersion: core,
      }),
    );
    assert.equal(result.tag, tag);
    // Android versionName stays at the manifest's core version for prereleases.
    assert.equal(result.version, core);
    assert.equal(result.apkName, `dsh-mobile-${tag}.apk`);
  }
});

test('rejects malformed, non-canonical and injection-like tags', () => {
  const invalidTags = [
    '1.2.3',
    'V1.2.3',
    'v1.2',
    'v1.2.3.4',
    'v01.2.3',
    'v1.02.3',
    'v1.2.03',
    'v1.2.3-alpha',
    'v1.2.3-alpha.01',
    'v1.2.3-dev.1',
    'v1.2.3-alpha.1.2',
    'v1.2.3+build',
    'v1.2.3-rc.1+build',
    ' v1.2.3',
    'v1.2.3 ',
    'v1.2.3\n',
    'v1.2.3\r\n',
    'v1.2.3; rm -rf /',
    'v1.2.3$(touch pwned)',
    'v1.2.3`id`',
    'v1.2.3/../../etc/passwd',
    'v1.2.3\\..\\config',
    'v1.2.3|cat /etc/passwd',
    'v1.2.3&whoami',
  ];

  for (const tag of invalidTags) {
    assert.throws(
      () => validateReleaseMetadata(input({ tag })),
      /invalid release tag/,
      tag,
    );
  }

  assert.throws(() => validateReleaseMetadata(input({ tag: null })), /tag is required/);
  assert.throws(() => validateReleaseMetadata(input({ tag: 123 })), /tag is required/);
  assert.throws(() => validateReleaseMetadata(), /tag is required/);
});

test('requires the tag core version to match every manifest', () => {
  assert.throws(
    () => validateReleaseMetadata(input({ packageVersion: '1.2.4' })),
    /package\.json version/,
  );
  assert.throws(
    () => validateReleaseMetadata(input({ expoVersion: '1.2.4' })),
    /app\.json expo\.version/,
  );
  assert.throws(
    () => validateReleaseMetadata(input({ compatibilityVersion: '1.2.4' })),
    /compatibility\.json app\.version/,
  );
});

test('does not accept prerelease text in manifest versions', () => {
  assert.throws(
    () =>
      validateReleaseMetadata(
        input({ tag: 'v1.2.3-rc.1', packageVersion: '1.2.3-rc.1' }),
      ),
    /package\.json version/,
  );
});

test('rejects missing, out-of-range and non-integer Android version codes', () => {
  for (const versionCode of [
    0,
    -1,
    1.5,
    '42',
    NaN,
    Infinity,
    2_100_000_001,
    Number.MAX_SAFE_INTEGER,
  ]) {
    assert.throws(
      () => validateReleaseMetadata(input({ versionCode })),
      /versionCode/,
      String(versionCode),
    );
  }

  const missing = input();
  delete missing.appJson.expo.android.versionCode;
  assert.throws(() => validateReleaseMetadata(missing), /versionCode/);
});

test('accepts the versionCode boundaries', () => {
  assert.equal(validateReleaseMetadata(input({ versionCode: 1 })).versionCode, 1);
  assert.equal(
    validateReleaseMetadata(input({ versionCode: 2_100_000_000 })).versionCode,
    2_100_000_000,
  );
});

test('requires the expected Android application id', () => {
  assert.throws(
    () => validateReleaseMetadata(input({ packageName: 'com.example.app' })),
    /android\.package/,
  );

  const missing = input();
  delete missing.appJson.expo.android.package;
  assert.throws(() => validateReleaseMetadata(missing), /android\.package/);
});

test('fails closed when a manifest is absent', () => {
  assert.throws(
    () => validateReleaseMetadata({ ...input(), packageJson: undefined }),
    /package\.json version/,
  );
  assert.throws(
    () => validateReleaseMetadata({ ...input(), appJson: undefined }),
    /app\.json expo\.version/,
  );
  assert.throws(
    () => validateReleaseMetadata({ ...input(), compatibility: undefined }),
    /compatibility\.json app\.version/,
  );
});
