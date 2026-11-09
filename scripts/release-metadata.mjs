#!/usr/bin/env node
/**
 * Validate an Android release tag against the checked-out manifests and
 * produce the metadata used by the GitHub release job.
 *
 * Usage:
 *   node scripts/release-metadata.mjs v0.1.0-alpha.1
 *
 * Success prints {"tag","version","versionCode","apkName"} as JSON.
 * Validation errors exit 1 and print only the offending field/value; the
 * environment and file contents are never dumped.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_ANDROID_PACKAGE = 'app.dshmobile.client';
const MAX_VERSION_CODE = 2_100_000_000;
// Strict: vMAJOR.MINOR.PATCH with optional -(alpha|beta|rc).N. Numbers are
// canonical (no leading zeros), so whitespace, path separators and shell
// metacharacters can never reach the APK file name.
const TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/;

function fail(message) {
  throw new Error(message);
}

export function validateReleaseMetadata(
  { tag, packageJson, appJson, compatibility } = {},
) {
  if (typeof tag !== 'string' || tag.length === 0) {
    fail('tag is required');
  }
  // `$` also matches before a trailing newline, so compare the full match.
  const match = TAG_PATTERN.exec(tag);
  if (!match || match[0] !== tag) {
    fail(
      `invalid release tag ${JSON.stringify(tag)}; expected ` +
        'vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-(alpha|beta|rc).N with canonical numbers',
    );
  }

  const coreVersion = `${match[1]}.${match[2]}.${match[3]}`;
  const versions = [
    ['package.json version', packageJson?.version],
    ['app.json expo.version', appJson?.expo?.version],
    ['compatibility.json app.version', compatibility?.app?.version],
  ];
  for (const [label, actual] of versions) {
    if (actual !== coreVersion) {
      fail(`${label} ${JSON.stringify(actual)} != tag core version ${coreVersion}`);
    }
  }

  const android = appJson?.expo?.android;
  if (android?.package !== EXPECTED_ANDROID_PACKAGE) {
    fail(
      `app.json expo.android.package ${JSON.stringify(android?.package)} != ` +
        EXPECTED_ANDROID_PACKAGE,
    );
  }

  const versionCode = android?.versionCode;
  if (
    !Number.isSafeInteger(versionCode) ||
    versionCode < 1 ||
    versionCode > MAX_VERSION_CODE
  ) {
    fail(
      `app.json expo.android.versionCode ${JSON.stringify(versionCode)} must be ` +
        `an integer between 1 and ${MAX_VERSION_CODE}`,
    );
  }

  return {
    tag,
    version: coreVersion,
    versionCode,
    apkName: `dsh-mobile-${tag}.apk`,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main(argv) {
  if (argv.length !== 1) {
    console.error('usage: node scripts/release-metadata.mjs TAG');
    return 1;
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const metadata = validateReleaseMetadata({
      tag: argv[0],
      packageJson: readJson(path.join(root, 'package.json')),
      appJson: readJson(path.join(root, 'app.json')),
      compatibility: readJson(path.join(root, 'compatibility.json')),
    });
    console.log(JSON.stringify(metadata));
    return 0;
  } catch (error) {
    console.error(
      `release-metadata: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  process.exitCode = main(process.argv.slice(2));
}
