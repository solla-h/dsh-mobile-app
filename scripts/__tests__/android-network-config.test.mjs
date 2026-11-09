import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('generated release manifest permits the documented private-network WebSocket path', () => {
  const config = JSON.parse(execFileSync(process.execPath, [
    'node_modules/expo/bin/cli', 'config', '--type', 'introspect', '--json',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1' },
  }));
  const application = config._internal.modResults.android.manifest.manifest.application[0];
  assert.equal(application.$['android:usesCleartextTraffic'], 'true');
  // A separate network-security-config overrides this attribute; don't silently add one.
  assert.equal(application.$['android:networkSecurityConfig'], undefined);
});
