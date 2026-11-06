# Android APK releases

Official APKs are built on GitHub Actions with Expo prebuild and Gradle. They do not use EAS cloud
builds, EAS monthly quotas, or an `EXPO_TOKEN`. Existing EAS profiles remain optional preview paths.

## Runner and cost

[Standard GitHub-hosted runners are free for public repositories](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
and do not consume the included private-repository compute allowance. This workflow uses standard
`ubuntu-24.04` x64 runners, not paid larger runners. Build artifacts expire after 7 days; published
Release attachments are the user download location.

A Linux ARM64 self-hosted runner is not the supported build host here. The official Android NDK
[Linux host tag is `linux-x86_64`](https://developer.android.com/ndk/guides/other_build_systems).
Building on ARM64 requires extra emulation or an alternative toolchain. If self-hosting becomes necessary,
use an isolated x64 build machine; do not run untrusted public PRs on a host with production services or
release credentials. No host addresses or SSH configuration belong in this repository.

## Pipeline

`.github/workflows/android-release.yml` runs on `v*` tag pushes, or manual dispatch from `master`
with an existing tag. The tag must resolve to a commit already merged into `master`.

1. Resolve the exact commit, validate tag/manifest versions and increasing Android versionCode, and
   reject an already published release or a draft containing assets.
2. Call the reusable `ci.yml` on that commit: clean install, Jest, Node tests, typecheck, lint, Expo Doctor.
3. Build on Ubuntu x64 with Node 24 and JDK 17. Expo generates `android/`; Gradle builds the release APK.
4. Inject signing secrets only into the signing step. Align and sign the APK, verify its certificate,
   package ID, version name/code, non-debuggable manifest, and bundled JavaScript.
5. Install that signed APK in an Android emulator and run the local-fixture Maestro journey:
   pairing → list → session → send/receive → return → relaunch with pairing retained. Verify fixture
   protocol traffic and keep synthetic screenshots and failure diagnostics.
6. Transfer only the APK, `SHA256SUMS` and `build-info.json` to the publish job. Recheck hashes and tag SHA,
   upload to a draft Release, download the uploaded APK and verify it again, then publish.

Relevant pull requests run `android-check.yml` first, building a temporary development-signed APK
without release credentials and invoking the same journey. See [DEVELOPMENT.md](DEVELOPMENT.md).

Only the publish job has `contents: write`. Pull-request CI has no release secrets or environment access.
Published assets are never overwritten. Pre-release tags produce GitHub prereleases; the workflow does
not automatically mark releases as Latest.

## Signing setup

The `android-release` environment allows branch `master` (manual dispatch) and tags `v*`. Configure:

| Name | Kind | Value |
| --- | --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Secret | Base64 of the existing release keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Secret | Keystore password |
| `ANDROID_KEY_ALIAS` | Secret | Signing key alias |
| `ANDROID_KEY_PASSWORD` | Secret | Signing key password |
| `ANDROID_CERT_SHA256` | Variable | Expected certificate SHA-256 (64 hex characters; colons accepted) |

The certificate fingerprint is public identity information, not the APK hash. The private key and
passwords stay in GitHub's encrypted environment secrets. Keep an offline backup; losing this key prevents
normal upgrades. Never commit `credentials.json`, keystores or passwords.

Use Settings → Environments to create the environment and its branch/tag restrictions. From an authenticated
maintainer terminal, set secrets via stdin or the CLI's hidden prompt, without printing values:

```bash
# Linux
base64 -w0 keys/release.jks | gh secret set ANDROID_KEYSTORE_BASE64 --env android-release
# macOS: base64 -i keys/release.jks | tr -d '\n' | gh secret set ANDROID_KEYSTORE_BASE64 --env android-release

gh secret set ANDROID_KEYSTORE_PASSWORD --env android-release
gh secret set ANDROID_KEY_ALIAS --env android-release
gh secret set ANDROID_KEY_PASSWORD --env android-release

# Public certificate fingerprint; supply the keystore password interactively.
keytool -list -v -keystore keys/release.jks
gh variable set ANDROID_CERT_SHA256 --env android-release
```

PowerShell can encode the keystore without displaying it:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('keys\release.jks')) |
  gh secret set ANDROID_KEYSTORE_BASE64 --env android-release
```

**Signing continuity:** the existing release keystore was compared with the earlier EAS preview APK and
has the same certificate. Official builds retain package ID `app.dshmobile.client`. EAS versus Gradle is
not what determines upgrade compatibility: the package ID and certificate must match, and versionCode
must increase. Do not ask existing testers to uninstall merely because the build system changed.

Forks must use their own keystore, environment and repository guard. Prefer a separate application ID so
the fork can coexist with the official app; also update the ID checks in `release-metadata.mjs` and
`sign-android-release.sh`. A differently signed APK cannot update an existing official installation.

## Version and tag contract

Tags use `vMAJOR.MINOR.PATCH`, optionally followed by `-alpha.N`, `-beta.N` or `-rc.N`.
Numbers cannot have leading zeros. For example:

| Field | Published APK example |
| --- | --- |
| Tag / filename | `v0.1.0-alpha.4` / `dsh-mobile-v0.1.0-alpha.4.apk` |
| `package.json` version | `0.1.0` |
| `app.json` expo.version | `0.1.0` |
| `compatibility.json` app.version | `0.1.0` |
| `app.json` expo.android.versionCode | `4` |

Android versionName uses the version core; the tag and filename preserve the prerelease suffix.
VersionCode must be a positive integer ≤ 2,100,000,000 and greater than every other `v*` tag's value.
Older tags without an explicit versionCode count as 1. The workflow never bumps versions automatically.

1. Update the version fields, increase versionCode, and update CHANGELOG. Merge to `master` after CI passes.
2. Validate metadata, then tag the merged commit (use a new tag for each release):

   ```bash
   node scripts/release-metadata.mjs v0.1.0-alpha.5
   git tag -a v0.1.0-alpha.5 -m "DSH Mobile v0.1.0-alpha.5"
   git push origin v0.1.0-alpha.5
   ```

3. Watch **Actions → Android release**. If the trigger was missed, dispatch from master:

   ```bash
   gh workflow run android-release.yml --ref master -f tag=v0.1.0-alpha.5
   ```

Never move a published tag or replace its APK. If code needs changing, create a new version/tag.

## Download, install and verify

Open [Releases](https://github.com/solla-h/dsh-mobile-app/releases) and choose a release with an APK
(alpha.1 is source-only; alpha.2 failed publication and has no released APK). Download the APK,
`SHA256SUMS` and `build-info.json` together.

On Linux, in the download directory:

```bash
sha256sum --check SHA256SUMS
```

On Windows PowerShell, compare the displayed hashes with the corresponding SHA256SUMS entries:

```powershell
Get-Content .\SHA256SUMS
Get-FileHash .\dsh-mobile-v0.1.0-alpha.4.apk -Algorithm SHA256
Get-FileHash .\build-info.json -Algorithm SHA256
```

Open the APK on Android, allow installation for the browser/file manager when prompted, and install.
For an update, install over the existing official app; do not uninstall first. Open DSH Mobile, confirm
saved pairing and sessions, enter a conversation, send a message, try voice if enabled, then return home
and reopen the app. A fresh install begins at pairing. No Expo login or Metro server is required.

The hash checks download integrity. To check signer identity with Android build-tools, run
`apksigner verify --print-certs <apk>` and compare the certificate SHA-256 with `build-info.json`.

## Evidence and failure handling

**Build verified** means CI compiled and signed the exact tag and checked the artifact and uploaded bytes.
**Emulator journey passed** means the compiled APK completed the scripted local-fixture path; it does not
cover production connectivity, camera, microphone or physical gestures. **Real-device tested** requires
installation and the full journey above, including failure/cancel/reconnect paths when those features change.

Keep `compatibility.json`'s `verified[]` and `app.build` as records of actual device testing. The first CI APK
inherits the earlier version combination but still needs its own device test. `build-info.json` records the
new APK's source commit, certificate, versionCode and workflow URL without rewriting that prior evidence.

| Failure | Recovery |
| --- | --- |
| Invalid tag/manifest/versionCode or unmerged commit | Fix the release input; never relabel an already published version |
| Test/build/signature check fails | No Release is published; inspect the failed job |
| Upload/download verification fails | Only an unpublished draft remains; inspect its assets before retrying |
| Draft already has assets | Inspect and remove only that failed unpublished draft/its assets before retrying; never delete published assets |
| Release already published | No rebuild or overwrite; cut a new release for changes |
| Tag moved during build | Publication stops; investigate rather than accepting an APK from another commit |

To reproduce the build locally, use Node 24, JDK 17 and the Android SDK/NDK required by SDK 58:

```bash
npm ci
npx expo prebuild --platform android --no-install
(cd android && ./gradlew app:assembleRelease --no-daemon --max-workers=2 \
  -Dorg.gradle.jvmargs="-Xmx6g -XX:MaxMetaspaceSize=1g")
```

This Gradle output is an intermediate APK. Apply the alignment/signing/verification sequence in
`scripts/sign-android-release.sh` before distributing it. Do not commit or hand-edit generated `android/`;
persistent native configuration belongs in app.json or Expo config plugins.
