import test from 'node:test';
import assert from 'node:assert/strict';
import { installGatewayRelease, requirePnpm } from '../setup-gateway.mjs';

const SOURCE = 'github:solla-h/dsh-plugin-mobile-gateway#v0.12.0-rdv.3';

test('missing package manager fails the preflight without stopping Web', () => {
  assert.throws(() => requirePnpm(() => ({ status: 1 })), /DSH Web has not been stopped/);
  assert.throws(() => requirePnpm(() => ({ error: new Error('ENOENT'), status: null })), /pnpm is unavailable/);
  assert.doesNotThrow(() => requirePnpm(() => ({ status: 0 })));
});

test('an install failure restores a stopped Web process and still fails', async (t) => {
  t.mock.method(console, 'error', () => {});
  const events = [];
  await assert.rejects(installGatewayRelease(SOURCE, {
    install: () => { events.push('install'); return 1; },
    check: () => { throw new Error('must not check a failed install'); },
    restart: async () => { events.push('restart'); },
  }), /plugin add failed/);
  assert.deepEqual(events, ['install', 'restart']);
});

test('a post-install mismatch restores Web and retains the compatibility failure', async (t) => {
  t.mock.method(console, 'error', () => {});
  const events = [];
  await assert.rejects(installGatewayRelease(SOURCE, {
    install: () => 0,
    check: () => ({ code: 1, parsed: { errors: ['wrong installed source'] } }),
    restart: async () => { events.push('restart'); },
  }), /compatibility check failed/);
  assert.deepEqual(events, ['restart']);
});

test('failed restoration preserves the original install error and gives manual recovery', async (t) => {
  const messages = [];
  t.mock.method(console, 'error', (text) => messages.push(text));
  await assert.rejects(installGatewayRelease(SOURCE, {
    install: () => 1,
    restart: async () => { throw new Error('start failed'); },
  }), /plugin add failed/);
  assert.ok(messages.some(text => text.includes('start failed')));
  assert.ok(messages.some(text => text.includes('normal DSH Web command')));
});

test('successful installation leaves the normal restart path in charge', async () => {
  await installGatewayRelease(SOURCE, {
    install: () => 0,
    check: () => ({ code: 0 }),
    restart: async () => { throw new Error('must not restart before normal completion'); },
  });
});
