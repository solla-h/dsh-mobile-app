import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('generated release manifest permits private-network WebSocket and in-app APK install', () => {
  const config = JSON.parse(execFileSync(process.execPath, [
    'node_modules/expo/bin/cli', 'config', '--type', 'introspect', '--json',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1' },
  }));
  const manifest = config._internal.modResults.android.manifest.manifest;
  const application = manifest.application[0];
  assert.equal(application.$['android:usesCleartextTraffic'], 'true');
  // A separate network-security-config overrides this attribute; don't silently add one.
  assert.equal(application.$['android:networkSecurityConfig'], undefined);

  // In-app APK updates need this declaration; the installer itself is the system package installer.
  const permissions = (manifest['uses-permission'] ?? [])
    .map((entry) => entry?.$?.['android:name']);
  assert.ok(
    permissions.includes('android.permission.REQUEST_INSTALL_PACKAGES'),
    'REQUEST_INSTALL_PACKAGES must be declared for in-app APK updates',
  );
});
