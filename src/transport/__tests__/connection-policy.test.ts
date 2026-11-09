import { backoffDelay, classifyClose, classifyPairingFailure } from '../connection-policy';

describe('backoffDelay', () => {
  it('follows the 1s..30s ladder and clamps', () => {
    expect([0, 1, 2, 3, 4, 5, 99].map(backoffDelay)).toEqual([
      1000, 2000, 5000, 10000, 30000, 30000, 30000,
    ]);
  });
});

describe('classifyClose', () => {
  it('stops on 4003 but distinguishes revoked from auth enabled', () => {
    const revoked = classifyClose(4003, 'device revoked');
    expect(revoked.stop).toBe(true);
    expect(revoked.reconnect).toBe(false);
    expect(revoked.message).toContain('撤销');

    const enabled = classifyClose(4003, 'authentication enabled');
    expect(enabled.stop).toBe(true);
    expect(enabled.message).toContain('鉴权');
  });

  it('stops on 4004 and reconnects on transport closes', () => {
    expect(classifyClose(4004).stop).toBe(true);
    expect(classifyClose(1006).reconnect).toBe(true);
    expect(classifyClose(1001).reconnect).toBe(true);
    expect(classifyClose(1011, 'session follower failed').message).toBe(
      'session follower failed',
    );
  });

  it('falls back to a readable message for unknown closes', () => {
    expect(classifyClose(undefined).message).toBe('连接关闭（未知）');
  });
});

describe('classifyPairingFailure', () => {
  const base = { opened: false, timedOut: false, preflight: 'unknown' as const };

  it('blames the phone network/proxy when the preflight cannot reach the host', () => {
    const decision = classifyPairingFailure({ ...base, preflight: 'failed' });
    expect(decision.message).toContain('网络或代理');
    expect(decision.message).not.toContain('已被使用');
    expect(decision.retryable).toBe(true);
    expect(decision.regenerate).toBe(false);
  });

  it('treats a preflight or handshake timeout as retryable', () => {
    expect(classifyPairingFailure({ ...base, preflight: 'timeout' }).retryable).toBe(true);
    expect(classifyPairingFailure({ ...base, timedOut: true }).retryable).toBe(true);
  });

  it('only blames the pairing code after the socket actually opened', () => {
    const decision = classifyPairingFailure({ ...base, opened: true });
    expect(decision.message).toContain('配对码');
    expect(decision.retryable).toBe(false);
    expect(decision.regenerate).toBe(true);
  });

  it('mentions both proxy and code when the host was reachable but the upgrade never opened', () => {
    const decision = classifyPairingFailure({ ...base, preflight: 'ok' });
    expect(decision.message).toContain('代理');
    expect(decision.message).toContain('重新生成配对码');
    expect(decision.retryable).toBe(true);
  });

  it('stops on gateway-disabled and auth-required closes', () => {
    expect(classifyPairingFailure({ ...base, closeCode: 4004 }).retryable).toBe(false);
    const auth = classifyPairingFailure({ ...base, closeCode: 4003 });
    expect(auth.retryable).toBe(false);
    expect(auth.regenerate).toBe(true);
  });
});
