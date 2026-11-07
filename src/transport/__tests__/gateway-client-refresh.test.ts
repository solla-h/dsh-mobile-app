import { GatewayClient } from '../gateway-client';

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

/** 只实现 GatewayClient 用到的那部分 WebSocket 接口。 */
class FakeSocket {
  static instances: FakeSocket[] = [];

  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data?: unknown }) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }
}

const originalWebSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;
const options = (refreshUrl?: () => Promise<string | undefined>) => ({
  url: 'wss://old.example.com/ws/mobile',
  token: 'token',
  deviceId: 'device',
  deviceName: 'test',
  refreshUrl,
});

/** 触发一次「连接失败」的关闭。 */
async function fail(socket: FakeSocket, code = 1006) {
  socket.readyState = 3;
  socket.onclose?.({ code, reason: '' });
  await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  FakeSocket.instances = [];
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  jest.useRealTimers();
  globalThis.WebSocket = originalWebSocket;
});

it('可写连接的临时 error 与真正断线可区分', async () => {
  const client = new GatewayClient();
  try {
    client.connect(options());
    const socket = FakeSocket.instances[0];
    socket.readyState = 1;
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ kind: 'hello', authenticated: true }) });
    socket.onerror?.();
    expect(client.state).toBe('error');
    expect(client.canSend).toBe(true);
    expect(client.send({ type: 'ping' })).toBe(true);
    await fail(socket);
    expect(client.state).toBe('error');
    expect(client.canSend).toBe(false);
    expect(client.send({ type: 'ping' })).toBe(false);
  } finally { client.disconnect(); }
});

describe('GatewayClient 地址簿刷新', () => {
  it('第 2 次连续失败才触发；拿到新 URL 立刻重连并清零退避', async () => {
    const refreshUrl = jest.fn().mockResolvedValue('wss://new.example.com/ws/mobile');
    const client = new GatewayClient();
    client.connect(options(refreshUrl));
    expect(FakeSocket.instances).toHaveLength(1);

    await fail(FakeSocket.instances[0]);
    expect(refreshUrl).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances).toHaveLength(2);

    await fail(FakeSocket.instances[1]);
    await jest.advanceTimersByTimeAsync(0);
    expect(refreshUrl).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances).toHaveLength(3);
    expect(FakeSocket.instances[2].url).toBe('wss://new.example.com/ws/mobile');
    client.disconnect();
  });

  it('冷却期内不重复刷新', async () => {
    const refreshUrl = jest.fn().mockResolvedValue('wss://new.example.com/ws/mobile');
    const client = new GatewayClient();
    client.connect(options(refreshUrl));
    await fail(FakeSocket.instances[0]);
    await jest.advanceTimersByTimeAsync(1_000);
    await fail(FakeSocket.instances[1]);
    await jest.advanceTimersByTimeAsync(0);
    expect(refreshUrl).toHaveBeenCalledTimes(1);

    // 新连接上的两次失败，距上次刷新还没到 60s。
    await fail(FakeSocket.instances[2]);
    await jest.advanceTimersByTimeAsync(1_000);
    await fail(FakeSocket.instances.at(-1) as FakeSocket);
    await jest.advanceTimersByTimeAsync(0);
    expect(refreshUrl).toHaveBeenCalledTimes(1);
    client.disconnect();
  });

  it('4003 停止重连，且不触发刷新', async () => {
    const refreshUrl = jest.fn().mockResolvedValue('wss://new.example.com/ws/mobile');
    const client = new GatewayClient();
    client.connect(options(refreshUrl));
    await fail(FakeSocket.instances[0]);
    await jest.advanceTimersByTimeAsync(1_000);
    await fail(FakeSocket.instances[1], 4003);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(refreshUrl).not.toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('期间 connect() 换了 options -> 迟到的刷新结果被丢弃', async () => {
    let release: (url: string | undefined) => void = () => undefined;
    const refreshUrl = jest.fn(
      () => new Promise<string | undefined>((resolve) => (release = resolve)),
    );
    const client = new GatewayClient();
    client.connect(options(refreshUrl));
    await fail(FakeSocket.instances[0]);
    await jest.advanceTimersByTimeAsync(1_000);
    await fail(FakeSocket.instances[1]);
    expect(refreshUrl).toHaveBeenCalledTimes(1);

    client.connect(options());
    const fresh = FakeSocket.instances.at(-1);
    expect(fresh?.url).toBe('wss://old.example.com/ws/mobile');

    release('wss://stale.example.com/ws/mobile');
    await jest.advanceTimersByTimeAsync(0);
    expect(FakeSocket.instances.at(-1)).toBe(fresh);
    expect(FakeSocket.instances.at(-1)?.url).toBe('wss://old.example.com/ws/mobile');
    client.disconnect();
  });

  it('返回相同 URL / undefined -> 不额外重连', async () => {
    const refreshUrl = jest.fn().mockResolvedValue('wss://old.example.com/ws/mobile');
    const client = new GatewayClient();
    client.connect(options(refreshUrl));
    await fail(FakeSocket.instances[0]);
    await jest.advanceTimersByTimeAsync(1_000);
    await fail(FakeSocket.instances[1]);
    await jest.advanceTimersByTimeAsync(0);
    // 还是刚才那两个 socket：没有用相同地址多开一条连接。
    expect(FakeSocket.instances).toHaveLength(2);
    client.disconnect();
  });
});

describe('GatewayClient 配对失败分类', () => {
  beforeEach(() => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('preflight 失败时用同一个配对码重试一次，再报网络/代理', async () => {
    const client = new GatewayClient();
    const details: string[] = [];
    client.onState((state, detail) => {
      if (state === 'error' && detail) details.push(detail);
    });

    client.connect({ ...options(), pairingCode: 'code-1' });
    await jest.advanceTimersByTimeAsync(0);
    expect(FakeSocket.instances).toHaveLength(1);

    await fail(FakeSocket.instances[0]);
    expect(details.some((detail) => detail.includes('正在重试一次'))).toBe(true);

    await jest.advanceTimersByTimeAsync(1_500);
    expect(FakeSocket.instances).toHaveLength(2);

    await fail(FakeSocket.instances[1]);
    expect(details.at(-1)).toContain('网络或代理');
    expect(FakeSocket.instances).toHaveLength(2);
    client.disconnect();
  });
});
