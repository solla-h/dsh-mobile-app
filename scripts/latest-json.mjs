#!/usr/bin/env node
/**
 * Build the in-app update manifest (latest.json) for a published Android
 * release from the checked-out manifests.
 *
 * Usage:
 *   node scripts/latest-json.mjs TAG [NOTES_FILE]
 *
 * TAG must be a canonical release tag such as v0.1.0-alpha.5 and must match
 * package.json, app.json and compatibility.json. The generated APK and
 * SHA256SUMS URLs point at the GitHub release for TAG. When NOTES_FILE is
 * given, its contents become the release notes in both locales.
 *
 * Success prints the manifest as pretty-printed JSON on stdout. Validation
 * errors exit 1 and print only one line; the environment and file contents
 * are never dumped.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateReleaseMetadata } from './release-metadata.mjs';

const RELEASE_DOWNLOAD_BASE =
  'https://github.com/solla-h/dsh-mobile-app/releases/download';
// Same format as src/update/manifest.ts so a generated manifest always parses.
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function fail(message) {
  throw new Error(message);
}

function isVersionString(value) {
  if (typeof value !== 'string') return false;
  const match = VERSION_PATTERN.exec(value);
  // `$` also matches before a trailing newline, so compare the full match.
  return match !== null && match[0] === value;
}

function buildRequired(compatibility) {
  const recommended = compatibility?.recommended;
  const required = {};

  for (const key of ['gateway', 'dsh', 'voice']) {
    const value = recommended?.[key]?.version;
    if (value === undefined) continue;
    if (!isVersionString(value)) {
      fail(
        `compatibility recommended.${key}.version ${JSON.stringify(value)} ` +
          'is not a valid version',
      );
    }
    required[key] = value;
  }

  const protocol = compatibility?.protocol?.version;
  if (protocol !== undefined) {
    if (
      typeof protocol !== 'number' ||
      !Number.isSafeInteger(protocol) ||
      protocol < 1
    ) {
      fail(
        `compatibility protocol.version ${JSON.stringify(protocol)} must be a ` +
          'positive integer',
      );
    }
    required.protocol = protocol;
  }

  return Object.keys(required).length > 0 ? required : undefined;
}

/**
 * Pure builder for latest.json. Inputs are parsed JSON objects; the returned
 * shape matches LatestManifest in src/update/manifest.ts. Inputs are not
 * mutated.
 */
export function buildLatestManifest({
  tag,
  packageJson,
  appJson,
  compatibility,
  releaseNotes,
} = {}) {
  const metadata = validateReleaseMetadata({
    tag,
    packageJson,
    appJson,
    compatibility,
  });

  const manifest = {
    version: metadata.version,
    versionCode: metadata.versionCode,
    tag: metadata.tag,
    apkUrl: `${RELEASE_DOWNLOAD_BASE}/${metadata.tag}/${metadata.apkName}`,
    sha256Url: `${RELEASE_DOWNLOAD_BASE}/${metadata.tag}/SHA256SUMS`,
  };

  if (typeof releaseNotes === 'string' && releaseNotes.trim() !== '') {
    // The release job only produces English notes; ship them for both locales.
    manifest.releaseNotes = { 'zh-CN': releaseNotes, en: releaseNotes };
  }

  const required = buildRequired(compatibility);
  if (required !== undefined) {
    manifest.required = required;
  }

  return manifest;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main(argv) {
  if (argv.length < 1 || argv.length > 2) {
    console.error('usage: node scripts/latest-json.mjs TAG [NOTES_FILE]');
    return 1;
  }

  const [tag, notesFile] = argv;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const manifest = buildLatestManifest({
      tag,
      packageJson: readJson(path.join(root, 'package.json')),
      appJson: readJson(path.join(root, 'app.json')),
      compatibility: readJson(path.join(root, 'compatibility.json')),
      releaseNotes:
        notesFile === undefined
          ? undefined
          : fs.readFileSync(notesFile, 'utf8'),
    });
    console.log(JSON.stringify(manifest, null, 2));
    return 0;
  } catch (error) {
    console.error(
      `latest-json: ${error instanceof Error ? error.message : String(error)}`,
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
