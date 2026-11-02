import { backoffDelay, classifyClose } from '../connection-policy';

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
