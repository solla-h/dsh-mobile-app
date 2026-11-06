#!/usr/bin/env bash
# Runs only in the protected release job, after dependency installation and Gradle.
set -euo pipefail
: "${ANDROID_KEYSTORE_BASE64:?Missing Android keystore secret}"
: "${ANDROID_KEYSTORE_PASSWORD:?Missing keystore password}"
: "${ANDROID_KEY_ALIAS:?Missing key alias}"
: "${ANDROID_KEY_PASSWORD:?Missing key password}"
: "${ANDROID_CERT_SHA256:?Missing expected signing certificate fingerprint}"
: "${ANDROID_HOME:?Missing Android SDK}"
: "${RUNNER_TEMP:?Missing temporary directory}"
: "${RELEASE_TAG:?Missing tag}"
: "${RELEASE_SHA:?Missing commit}"
: "${RELEASE_VERSION:?Missing version}"
: "${RELEASE_VERSION_CODE:?Missing version code}"
: "${APK_NAME:?Missing APK name}"

expected=$(printf '%s' "$ANDROID_CERT_SHA256" | tr -d ':' | tr '[:upper:]' '[:lower:]')
[[ "$expected" =~ ^[a-f0-9]{64}$ ]] || { printf 'Invalid expected certificate fingerprint\n' >&2; exit 1; }
tools="$ANDROID_HOME/build-tools/37.0.0"
analyzer="$ANDROID_HOME/cmdline-tools/latest/bin/apkanalyzer"
input=android/app/build/outputs/apk/release/app-release.apk
[[ -f "$input" ]] || { printf 'Release APK missing\n' >&2; exit 1; }

umask 077
signing_dir=$(mktemp -d "$RUNNER_TEMP/android-signing.XXXXXX")
trap 'rm -rf -- "$signing_dir"' EXIT
printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$signing_dir/release.jks"
mkdir -p dist
"$tools/zipalign" -P 16 -f 4 "$input" "$signing_dir/aligned.apk"
"$tools/apksigner" sign --ks "$signing_dir/release.jks" \
  --ks-key-alias "$ANDROID_KEY_ALIAS" \
  --ks-pass env:ANDROID_KEYSTORE_PASSWORD --key-pass env:ANDROID_KEY_PASSWORD \
  --v4-signing-enabled false --out "dist/$APK_NAME" "$signing_dir/aligned.apk"
"$tools/apksigner" verify --verbose --print-certs "dist/$APK_NAME" > "$signing_dir/verification.txt"
# Build-tools 37 uses scheme labels such as "V2 Signer:" instead of "Signer #1".
# All reported certificates must match; duplicate entries across schemes are expected.
actual=$(awk '/ certificate SHA-256 digest:/ {print tolower($NF)}' "$signing_dir/verification.txt" | sort -u)
[[ "$actual" == "$expected" ]] || { printf 'APK signed by unexpected certificate\n' >&2; exit 1; }
"$tools/zipalign" -c -P 16 4 "dist/$APK_NAME"
[[ $("$analyzer" manifest application-id "dist/$APK_NAME") == app.dshmobile.client ]]
[[ $("$analyzer" manifest version-name "dist/$APK_NAME") == "$RELEASE_VERSION" ]]
[[ $("$analyzer" manifest version-code "dist/$APK_NAME") == "$RELEASE_VERSION_CODE" ]]
[[ $("$analyzer" manifest debuggable "dist/$APK_NAME") == false ]]
# A standalone APK must contain its JavaScript bundle (no Metro connection needed).
unzip -l "dist/$APK_NAME" assets/index.android.bundle | grep -q 'assets/index.android.bundle'
jq -n --arg tag "$RELEASE_TAG" --arg commit "$RELEASE_SHA" \
  --arg version "$RELEASE_VERSION" --argjson versionCode "$RELEASE_VERSION_CODE" \
  --arg certificateSha256 "$actual" \
  --arg runUrl "https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" \
  '{tag:$tag,commit:$commit,version:$version,versionCode:$versionCode,applicationId:"app.dshmobile.client",certificateSha256:$certificateSha256,runUrl:$runUrl}' \
  > dist/build-info.json
(cd dist && sha256sum "$APK_NAME" build-info.json > SHA256SUMS)
printf 'Signed APK verified: %s (version code %s)\n' "$APK_NAME" "$RELEASE_VERSION_CODE"
