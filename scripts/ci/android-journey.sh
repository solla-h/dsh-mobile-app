#!/usr/bin/env bash
# Deterministic Android journey gate for the APK built by the current workflow run
# (release-signed or PR-check development-signed).
#
# Runs inside the `script` hook of reactivecircus/android-emulator-runner, i.e.
# after the emulator has booted. Everything here talks to docs/tools/fake-gateway.mjs
# over `adb reverse` (loopback); no real gateway, no signing credentials.
#
# Contract (set by .github/workflows/android-journey.yml):
#   APK_DIR          directory holding the signed APK + SHA256SUMS from the build job
#   MAESTRO_BIN      pinned Maestro CLI binary
#   ARTIFACT_DIR     diagnostics output (screenshots, logs, JUnit report)
#   JOURNEY_MESSAGE  ASCII text the Maestro flow sends (default journey-ping-1)
#   PORT             fake gateway port (default 3999)
set -euo pipefail

: "${APK_DIR:?APK_DIR is required}"
: "${MAESTRO_BIN:?MAESTRO_BIN is required}"
: "${ARTIFACT_DIR:?ARTIFACT_DIR is required}"
JOURNEY_MESSAGE="${JOURNEY_MESSAGE:-journey-ping-1}"
PORT="${PORT:-3999}"
FAKE_SESSION_ID='fake-session-1'

workspace="${GITHUB_WORKSPACE:-$(pwd)}"
cd "$workspace"
mkdir -p "$ARTIFACT_DIR"

# 1. The same-run artifact must be the exact build, not a stale APK. Release
#    artifacts carry SHA256SUMS + build-info.json (verified here); the PR check
#    artifact is a single development-signed APK produced by its build job.
apk=$(find "$APK_DIR" -maxdepth 1 -name '*.apk' -print -quit)
[[ -n "$apk" ]] || { printf 'No APK found in %s\n' "$APK_DIR" >&2; exit 1; }
if [[ -f "$APK_DIR/SHA256SUMS" ]]; then
  (cd "$APK_DIR" && sha256sum --check --strict SHA256SUMS)
fi
if [[ -f "$APK_DIR/build-info.json" ]]; then
  artifact_commit=$(jq -r '.commit // empty' "$APK_DIR/build-info.json")
  [[ "$artifact_commit" == "$(git rev-parse HEAD)" ]] \
    || { printf 'APK build-info commit does not match the checked-out source_ref\n' >&2; exit 1; }
fi

# 2. The fake gateway imports `ws`, a lockfile transitive installed by `npm ci`.
node -e "require.resolve('ws')" \
  || { printf 'ws module missing; run npm ci before this script\n' >&2; exit 1; }

# 3. Fake gateway on loopback. Only this PID is ever killed; never pkill node.
gateway_log="$ARTIFACT_DIR/fake-gateway.log"
PORT="$PORT" node docs/tools/fake-gateway.mjs >"$gateway_log" 2>&1 &
gateway_pid=$!
cleanup() {
  local status=$?
  if kill -0 "$gateway_pid" 2>/dev/null; then
    kill "$gateway_pid" 2>/dev/null || true
    wait "$gateway_pid" 2>/dev/null || true
  fi
  adb reverse --remove "tcp:$PORT" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

wait_for_gateway() {
  local deadline=$((SECONDS + 60))
  until curl -fsS --max-time 3 "http://127.0.0.1:$PORT/log" -o /dev/null; do
    (( SECONDS < deadline )) || { printf 'fake gateway did not come up\n' >&2; return 1; }
    sleep 0.5
  done
}
wait_for_gateway
curl -fsS --max-time 5 "http://127.0.0.1:$PORT/mode?value=normal" >/dev/null

# 4. Emulator plumbing: reverse the fixture port and install the artifact APK.
adb wait-for-device
booted=0
for _ in $(seq 1 60); do
  if [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == '1' ]]; then
    booted=1
    break
  fi
  sleep 2
done
(( booted == 1 )) || { printf 'emulator did not report boot_completed\n' >&2; exit 1; }
adb reverse "tcp:$PORT" "tcp:$PORT"
adb reverse --list > "$ARTIFACT_DIR/adb-reverse.txt"
grep -q "tcp:$PORT" "$ARTIFACT_DIR/adb-reverse.txt" \
  || { printf 'adb reverse tcp:%s is not active\n' "$PORT" >&2; exit 1; }
adb install -r -g "$apk" | tee "$ARTIFACT_DIR/adb-install.txt"

# Fresh pairing string right before the flow: the fixture expires in 5 minutes.
curl -fsS --max-time 5 "http://127.0.0.1:$PORT/pair.json" -o "$ARTIFACT_DIR/pairing.json"
pairing_payload=$(jq -r '.pairingString // empty' "$ARTIFACT_DIR/pairing.json")
[[ -n "$pairing_payload" ]] \
  || { printf 'pairing fixture returned no pairingString\n' >&2; exit 1; }
pairing_url=$(jq -r '.publicUrl // empty' "$ARTIFACT_DIR/pairing.json")
[[ "$pairing_url" == "ws://127.0.0.1:$PORT/ws/mobile" ]] \
  || { printf 'pairing fixture must point at loopback, got %s\n' "$pairing_url" >&2; exit 1; }

# 5. Run the flow. Maestro exits non-zero on any failed step; keep the status
#    and still collect protocol evidence/diagnostics below.
udid=$(adb devices | awk 'NR == 2 && $2 == "device" { print $1 }')
[[ -n "$udid" ]] || { printf 'no online adb device\n' >&2; exit 1; }
maestro_status=0
MAESTRO_CLI_NO_ANALYTICS=true \
MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true \
MAESTRO_DISABLE_UPDATE_CHECK=true \
MAESTRO_DRIVER_STARTUP_TIMEOUT=30000 \
timeout 900 "$MAESTRO_BIN" test \
  --device "$udid" \
  --env "PAIRING_PAYLOAD=$pairing_payload" \
  --env "JOURNEY_MESSAGE=$JOURNEY_MESSAGE" \
  --format JUNIT --output "$ARTIFACT_DIR/maestro-junit.xml" \
  --test-output-dir "$ARTIFACT_DIR/maestro" \
  .maestro/android-journey.yaml || maestro_status=$?

# 6. Protocol-level evidence, independent of what the UI claims: the gateway
#    must have seen the list, the session history and the exact message text.
protocol_status=0
if curl -fsS --max-time 5 "http://127.0.0.1:$PORT/log" -o "$ARTIFACT_DIR/fake-gateway-events.json"; then
  jq -e --arg text "$JOURNEY_MESSAGE" --arg session "$FAKE_SESSION_ID" '
    ([.events[] | select(.event == "sessions")] | length) >= 1
    and ([.events[] | select(.event == "history" and .sessionId == $session)] | length) >= 1
    and ([.events[] | select(.event == "message" and .text == $text)] | length) >= 1
  ' "$ARTIFACT_DIR/fake-gateway-events.json" >/dev/null || protocol_status=$?
else
  protocol_status=1
fi

# 7. Diagnostics for both outcomes (synthetic fake conversation only).
adb logcat -d -t 4000 > "$ARTIFACT_DIR/logcat.txt" 2>&1 || true
adb exec-out screencap -p > "$ARTIFACT_DIR/final-screen.png" 2>/dev/null || true

if (( maestro_status != 0 )); then
  printf 'Maestro journey failed with status %s\n' "$maestro_status" >&2
  exit "$maestro_status"
fi
if (( protocol_status != 0 )); then
  printf 'fake gateway did not observe the expected journey traffic\n' >&2
  exit 1
fi
printf 'Android journey passed\n'
