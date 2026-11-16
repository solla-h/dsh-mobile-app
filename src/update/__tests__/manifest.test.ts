import {
 compareVersionCode,
 compareVersions,
 evaluateUpdate,
 isAllowedUpdateUrl,
 parseLatestManifest,
} from '../manifest';
import type { InstalledInfo, LatestManifest, UpdateEvaluation } from '../manifest';

const FULL_MANIFEST: LatestManifest = {
 version: '0.12.0-rdv.3',
 versionCode: 1203,
 tag: 'v0.12.0-rdv.3',
 apkUrl: 'https://github.com/example/app/releases/download/v0.12.0-rdv.3/app-release.apk',
 sha256Url:
  'https://github.com/example/app/releases/download/v0.12.0-rdv.3/app-release.apk.sha256',
 releaseNotes: { 'zh-CN': '修复若干问题', en: 'Bug fixes' },
 required: {
  gateway: '0.12.0-rdv.3',
  dsh: '0.2.1-rc.5',
  voice: '0.2.1-rc.5',
  protocol: 3,
 },
};

const MINIMAL_MANIFEST: LatestManifest = {
 version: '1.0.0',
 versionCode: 1,
 tag: 'v1.0.0',
 apkUrl: 'https://github.com/example/app/releases/download/v1.0.0/app-release.apk',
 sha256Url:
  'https://github.com/example/app/releases/download/v1.0.0/app-release.apk.sha256',
};

const INSTALLED_BASE: InstalledInfo = {
 versionCode: 100,
 protocol: 3,
 gateway: '0.12.0-rdv.3',
 dsh: '0.2.1-rc.5',
 voice: '0.2.1-rc.5',
};

function createManifest(overrides: Partial<LatestManifest> = {}): LatestManifest {
 return { ...MINIMAL_MANIFEST, versionCode: 200, ...overrides };
}

type UpdateAvailableResult = Extract<UpdateEvaluation, { kind: 'update-available' }>;

function evaluateAvailable(
 installed: InstalledInfo,
 latest: LatestManifest,
): UpdateAvailableResult {
 const evaluation = evaluateUpdate(installed, latest);
 if (evaluation.kind !== 'update-available') {
  throw new Error(`expected update-available but got ${evaluation.kind}`);
 }
 return evaluation;
}

describe('parseLatestManifest', () => {
 test('accepts a full valid manifest', () => {
  expect(parseLatestManifest(FULL_MANIFEST)).toEqual(FULL_MANIFEST);
 });

 test('accepts a minimal manifest', () => {
  expect(parseLatestManifest(MINIMAL_MANIFEST)).toEqual(MINIMAL_MANIFEST);
 });

 test('accepts the maximum versionCode', () => {
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, versionCode: 2100000000 })).toEqual({
   ...MINIMAL_MANIFEST,
   versionCode: 2100000000,
  });
 });

 test('ignores unknown extra fields', () => {
  const parsed = parseLatestManifest({ ...MINIMAL_MANIFEST, extra: 'ignored' });
  expect(parsed).toEqual(MINIMAL_MANIFEST);
  expect(parsed !== null && 'extra' in parsed).toBe(false);
 });

 test('does not mutate the input object', () => {
  const raw = {
   ...FULL_MANIFEST,
   releaseNotes: { en: 'Bug fixes' },
   required: { protocol: 4 },
  };
  const snapshot = JSON.stringify(raw);

  const parsed = parseLatestManifest(raw);

  expect(parsed).not.toBeNull();
  expect(JSON.stringify(raw)).toEqual(snapshot);
 });

 test('rejects non-object input', () => {
  expect(parseLatestManifest(null)).toBeNull();
  expect(parseLatestManifest(undefined)).toBeNull();
  expect(parseLatestManifest('manifest')).toBeNull();
  expect(parseLatestManifest(42)).toBeNull();
  expect(parseLatestManifest([])).toBeNull();
 });

 test('rejects bad version strings', () => {
  const badVersions = ['1.0', 'v1.0.0', '1.0.0.0', '1.0.0-', '1.0.0 rc.1', '', 3];
  for (const version of badVersions) {
   expect(parseLatestManifest({ ...MINIMAL_MANIFEST, version })).toBeNull();
  }
 });

 test('rejects bad versionCode', () => {
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, versionCode: 0 })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, versionCode: 1.5 })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, versionCode: 2100000001 })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, versionCode: -1 })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, versionCode: Number.NaN })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, versionCode: '1' })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, versionCode: undefined })).toBeNull();
 });

 test('rejects empty or whitespace tag', () => {
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, tag: '' })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, tag: 'not a tag' })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, tag: 12 })).toBeNull();
 });

 test('rejects http apkUrl', () => {
  expect(
   parseLatestManifest({
    ...MINIMAL_MANIFEST,
    apkUrl: 'http://github.com/example/app/releases/download/v1.0.0/app.apk',
   }),
  ).toBeNull();
 });

 test('rejects non-official host for apkUrl and sha256Url', () => {
  expect(
   parseLatestManifest({ ...MINIMAL_MANIFEST, apkUrl: 'https://evil.example.com/app.apk' }),
  ).toBeNull();
  expect(
   parseLatestManifest({ ...MINIMAL_MANIFEST, sha256Url: 'https://evil.example.com/app.apk.sha256' }),
  ).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, sha256Url: 'not a url' })).toBeNull();
 });

 test('rejects invalid releaseNotes', () => {
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, releaseNotes: 'notes' })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, releaseNotes: null })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, releaseNotes: { en: 5 } })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, releaseNotes: [] })).toBeNull();
 });

 test('rejects invalid required', () => {
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, required: null })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, required: 'gateway' })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, required: { gateway: '1.0' } })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, required: { dsh: 5 } })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, required: { voice: '' } })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, required: { protocol: 0 } })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, required: { protocol: 1.5 } })).toBeNull();
  expect(parseLatestManifest({ ...MINIMAL_MANIFEST, required: { protocol: '3' } })).toBeNull();
 });

 test('accepts a valid required without protocol', () => {
  const raw = { ...MINIMAL_MANIFEST, required: { gateway: '0.12.0-rdv.3' } };
  expect(parseLatestManifest(raw)).toEqual(raw);
 });
});

describe('compareVersionCode', () => {
 test('returns 0 for equal values', () => {
  expect(compareVersionCode(5, 5)).toBe(0);
 });

 test('returns a negative value when behind', () => {
  expect(compareVersionCode(4, 5)).toBeLessThan(0);
 });

 test('returns a positive value when ahead', () => {
  expect(compareVersionCode(6, 5)).toBeGreaterThan(0);
 });
});

describe('compareVersions', () => {
 test('compares prerelease numeric identifiers numerically', () => {
  expect(compareVersions('0.12.0-rdv.3', '0.12.0-rdv.1')).toBeGreaterThan(0);
  expect(compareVersions('0.2.1-rc.5', '0.2.1-rc.2')).toBeGreaterThan(0);
  expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.1')).toBeGreaterThan(0);
 });

 test('treats a release as greater than its prerelease', () => {
  expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0);
  expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
 });

 test('returns 0 for identical versions', () => {
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  expect(compareVersions('0.12.0-rdv.3', '0.12.0-rdv.3')).toBe(0);
 });

 test('compares core numbers numerically, not lexically', () => {
  expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
  expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
 });

 test('treats a shorter prerelease prefix as smaller', () => {
  expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0);
 });

 test('treats numeric identifiers as smaller than alphanumeric ones', () => {
  expect(compareVersions('1.0.0-2', '1.0.0-alpha')).toBeLessThan(0);
 });

 test('returns null for invalid version strings', () => {
  expect(compareVersions('1.0', '1.0.0')).toBeNull();
  expect(compareVersions('1.0.0', 'garbage')).toBeNull();
  expect(compareVersions('', '1.0.0')).toBeNull();
 });
});

describe('isAllowedUpdateUrl', () => {
 test('accepts github.com release URLs', () => {
  expect(
   isAllowedUpdateUrl('https://github.com/example/app/releases/download/v1.0.0/app.apk'),
  ).toBe(true);
 });

 test('accepts raw.githubusercontent.com URLs', () => {
  expect(
   isAllowedUpdateUrl('https://raw.githubusercontent.com/example/app/main/latest.json'),
  ).toBe(true);
 });

 test('accepts objects.githubusercontent.com URLs', () => {
  expect(
   isAllowedUpdateUrl(
    'https://objects.githubusercontent.com/github-production-release-asset/1/2?X-Amz-Signature=abc',
   ),
  ).toBe(true);
 });

 test('rejects http URLs', () => {
  expect(
   isAllowedUpdateUrl('http://github.com/example/app/releases/download/v1.0.0/app.apk'),
  ).toBe(false);
 });

 test('rejects other hosts', () => {
  expect(isAllowedUpdateUrl('https://evil.example.com/app.apk')).toBe(false);
  expect(isAllowedUpdateUrl('https://github.com.evil.example.com/app.apk')).toBe(false);
  expect(isAllowedUpdateUrl('https://notgithub.com/app.apk')).toBe(false);
 });

 test('rejects URLs with credentials', () => {
  expect(isAllowedUpdateUrl('https://user:pass@github.com/app.apk')).toBe(false);
  expect(isAllowedUpdateUrl('https://user@github.com/app.apk')).toBe(false);
 });

 test('rejects whitespace and garbage', () => {
  expect(isAllowedUpdateUrl('https://github.com/app apk')).toBe(false);
  expect(isAllowedUpdateUrl(' https://github.com/app.apk')).toBe(false);
  expect(isAllowedUpdateUrl('not a url')).toBe(false);
  expect(isAllowedUpdateUrl('')).toBe(false);
 });
});

describe('evaluateUpdate', () => {
 test('returns up-to-date when versionCode is equal', () => {
  expect(evaluateUpdate({ versionCode: 200 }, createManifest({ versionCode: 200 }))).toEqual({
   kind: 'up-to-date',
  });
 });

 test('returns up-to-date when latest versionCode is lower', () => {
  expect(evaluateUpdate({ versionCode: 200 }, createManifest({ versionCode: 150 }))).toEqual({
   kind: 'up-to-date',
  });
 });

 test('returns update-available without warnings when required is absent', () => {
  const latest = createManifest();
  expect(evaluateUpdate({ versionCode: 100 }, latest)).toEqual({
   kind: 'update-available',
   manifest: latest,
   hostBlocked: false,
   blockedReasons: [],
   weakWarnings: [],
  });
 });

 test('blocks when required protocol is newer than installed protocol', () => {
  const latest = createManifest({ required: { protocol: 4 } });
  expect(evaluateUpdate(INSTALLED_BASE, latest)).toEqual({
   kind: 'update-available',
   manifest: latest,
   hostBlocked: true,
   blockedReasons: ['protocol'],
   weakWarnings: [],
  });
 });

 test('does not block but warns when installed protocol is unknown', () => {
  const latest = createManifest({ required: { protocol: 4 } });
  expect(evaluateUpdate({ versionCode: 100 }, latest)).toEqual({
   kind: 'update-available',
   manifest: latest,
   hostBlocked: false,
   blockedReasons: [],
   weakWarnings: ['protocol-unknown'],
  });
 });

 test('does not warn about protocol when protocol matches', () => {
  const latest = createManifest({ required: { protocol: 3 } });
  expect(evaluateAvailable(INSTALLED_BASE, latest).weakWarnings).toEqual([]);
 });

 test('warns gateway-outdated when installed gateway is older than required', () => {
  const latest = createManifest({ required: { gateway: '0.12.0-rdv.3' } });
  const installed: InstalledInfo = { versionCode: 100, gateway: '0.12.0-rdv.1' };
  expect(evaluateUpdate(installed, latest)).toEqual({
   kind: 'update-available',
   manifest: latest,
   hostBlocked: false,
   blockedReasons: [],
   weakWarnings: ['gateway-outdated'],
  });
 });

 test('warns gateway-unknown when required gateway is set but installed is missing', () => {
  const latest = createManifest({ required: { gateway: '0.12.0-rdv.3' } });
  const installed: InstalledInfo = { versionCode: 100 };
  expect(evaluateUpdate(installed, latest)).toEqual({
   kind: 'update-available',
   manifest: latest,
   hostBlocked: false,
   blockedReasons: [],
   weakWarnings: ['gateway-unknown'],
  });
 });

 test('warns gateway-unknown when installed gateway is unparseable', () => {
  const latest = createManifest({ required: { gateway: '0.12.0-rdv.3' } });
  const installed: InstalledInfo = { versionCode: 100, gateway: '0.12.x' };
  expect(evaluateAvailable(installed, latest).weakWarnings).toEqual(['gateway-unknown']);
 });

 test('collects component warnings in gateway/dsh/voice order', () => {
  const latest = createManifest({
   required: { gateway: '0.12.0-rdv.3', dsh: '0.2.1-rc.5', voice: '0.2.1-rc.5' },
  });
  const installed: InstalledInfo = {
   versionCode: 100,
   gateway: '0.12.0-rdv.1',
   voice: '0.2.1-rc.2',
  };
  expect(evaluateAvailable(installed, latest).weakWarnings).toEqual([
   'gateway-outdated',
   'dsh-unknown',
   'voice-outdated',
  ]);
 });

 test('returns invalid when latest manifest is null', () => {
  expect(evaluateUpdate(INSTALLED_BASE, null)).toEqual({
   kind: 'invalid',
   reason: 'invalid-manifest',
  });
 });
});
