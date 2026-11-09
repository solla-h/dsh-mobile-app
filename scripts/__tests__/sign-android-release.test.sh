#!/usr/bin/env bash
# Exercise the real release script with tool doubles: only certificate parsing is under test.
set -euo pipefail
script="$(cd "$(dirname "$0")/.." && pwd)/sign-android-release.sh"
root=$(mktemp -d)
trap 'rm -rf -- "$root"' EXIT
export ANDROID_HOME="$root/sdk" RUNNER_TEMP="$root/tmp"
export PATH="$root/bin:$PATH"
export ANDROID_KEYSTORE_BASE64=Zml4dHVyZQ== ANDROID_KEYSTORE_PASSWORD=fixture
export ANDROID_KEY_ALIAS=fixture ANDROID_KEY_PASSWORD=fixture
export ANDROID_CERT_SHA256=$(printf '%064d' 1)
other=$(printf '%064d' 2)
export RELEASE_TAG=v0.1.0-alpha.3 RELEASE_SHA=fixture RELEASE_VERSION=0.1.0
export RELEASE_VERSION_CODE=3 APK_NAME=fixture.apk GITHUB_REPOSITORY=example/app GITHUB_RUN_ID=1
export SIGNER_OUTPUT="$root/signers.txt" APK_FIXTURE="$root/input.apk"
mkdir -p "$ANDROID_HOME/build-tools/37.0.0" "$ANDROID_HOME/cmdline-tools/latest/bin" \
  "$RUNNER_TEMP" "$root/bin" "$root/android/app/build/outputs/apk/release"
printf fixture > "$APK_FIXTURE"
cp "$APK_FIXTURE" "$root/android/app/build/outputs/apk/release/app-release.apk"
cat > "$ANDROID_HOME/build-tools/37.0.0/zipalign" <<'TOOL'
#!/usr/bin/env bash
[[ $1 == -c ]] && exit 0
cp "${@: -2:1}" "${@: -1}"
TOOL
cat > "$ANDROID_HOME/build-tools/37.0.0/apksigner" <<'TOOL'
#!/usr/bin/env bash
if [[ $1 == verify ]]; then cat "$SIGNER_OUTPUT"; exit; fi
while (($#)); do
  if [[ $1 == --out ]]; then cp "$APK_FIXTURE" "$2"; exit; fi
  shift
done
exit 1
TOOL
cat > "$ANDROID_HOME/cmdline-tools/latest/bin/apkanalyzer" <<'TOOL'
#!/usr/bin/env bash
case "$2" in
  application-id) printf 'app.dshmobile.client\n' ;;
  version-name) printf '%s\n' "$RELEASE_VERSION" ;;
  version-code) printf '%s\n' "$RELEASE_VERSION_CODE" ;;
  debuggable) printf 'false\n' ;;
  *) exit 1 ;;
esac
TOOL
cat > "$root/bin/unzip" <<'TOOL'
#!/usr/bin/env bash
printf 'assets/index.android.bundle\n'
TOOL
chmod +x "$ANDROID_HOME/build-tools/37.0.0/"* \
  "$ANDROID_HOME/cmdline-tools/latest/bin/apkanalyzer" "$root/bin/unzip"
cd "$root"

check() {
  local name=$1 want=$2 actual=0
  bash "$script" > "$root/result.log" 2>&1 || actual=$?
  if [[ "$actual" != "$want" ]]; then
    printf 'FAIL: %s (exit %s, expected %s)\n' "$name" "$actual" "$want"
    cat "$root/result.log"
    exit 1
  fi
  if [[ $want == 0 ]]; then
    [[ $(jq -r .certificateSha256 dist/build-info.json) == "$ANDROID_CERT_SHA256" ]]
  else
    grep -q 'APK signed by unexpected certificate' "$root/result.log"
  fi
  printf 'PASS: %s\n' "$name"
}
printf 'Signer #1 certificate SHA-256 digest: %s\n' "$ANDROID_CERT_SHA256" > "$SIGNER_OUTPUT"
check 'legacy signer output' 0
printf 'V2 Signer: certificate SHA-256 digest: %s\n' "$ANDROID_CERT_SHA256" > "$SIGNER_OUTPUT"
check 'build-tools 37 signer output' 0
printf 'V2 Signer: certificate SHA-256 digest: %s\nV3.0 Signer: certificate SHA-256 digest: %s\nV3.0 Signer: public key SHA-256 digest: %s\n' \
  "$ANDROID_CERT_SHA256" "$ANDROID_CERT_SHA256" "$other" > "$SIGNER_OUTPUT"
check 'same certificate across schemes, ignoring public-key digest' 0
printf 'V3.1 Signer: (minSdkVersion=33, maxSdkVersion=2147483647) certificate SHA-256 digest: %s\n' \
  "$ANDROID_CERT_SHA256" > "$SIGNER_OUTPUT"
check 'SDK-range signer label' 0
printf 'V2 Signer: certificate SHA-256 digest: %s\n' "$other" > "$SIGNER_OUTPUT"
check 'wrong certificate rejected' 1
printf 'V2 Signer: certificate SHA-256 digest: %s\nV3.0 Signer: certificate SHA-256 digest: %s\n' \
  "$ANDROID_CERT_SHA256" "$other" > "$SIGNER_OUTPUT"
check 'mixed certificates rejected' 1
printf 'V2 Signer: public key SHA-256 digest: %s\n' "$ANDROID_CERT_SHA256" > "$SIGNER_OUTPUT"
check 'missing certificate rejected' 1
