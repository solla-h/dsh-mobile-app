import {
  clearGateway,
  loadActiveGateway,
  loadGateways,
  patchGatewayIfExists,
  removeGateway,
  upsertGateway,
  type SavedGateway,
} from '../../storage/gateway-store';
import { createUrlRefresher, fetchAddressBook } from '../rendezvous';

jest.mock('expo-secure-store', () => {
  const memory = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => memory.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      memory.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      memory.delete(key);
    }),
  };
});

jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

/** §4.2 向量：rev=7，第一个 endpoint 是 wss。 */
const VECTOR_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const VECTOR_BODY =
  'AQABAgMEBQYHCAkKC2o9ixs6CrlWNdCqYJujnipSZYB1j0sz5t82XX8Su-FrC8YpOXSsYbkM3N3BIpt2ZwvLEVXkIpzzvJ24ZQ5T2JZG2t4cRP9us4GHPDYsBOOtYbTmzqr7IXRB2LlrK06nw9AhZRfAxXldWIyzgLXGPvFW9siaH6kXprVGGwInS0hXLir8cFeF3KwcisSqb5u6eWz2OgMcOfJoK-g6vMXekd1Hc5vSloBXbyj9acQOIKZBlupfizVrvsTsYhTZAoWmrTk48NoKZ2eUN6W7sDmyFZaCeRCE';

const saved = (overrides: Partial<SavedGateway> = {}): SavedGateway => ({
  id: 'gw:g1',
  url: 'wss://old.example.com/ws/mobile',
  token: 'token',
  gatewayId: 'g1',
  rendezvous: {
    url: 'https://dsh-rendezvous.example.workers.dev',
    key: VECTOR_KEY,
    gatewayId: '3f1b9c2e-7d4a-4b8f-9c1d-2e5a6b7c8d9f',
  },
  ...overrides,
});

beforeEach(async () => {
  await clearGateway();
});

describe('patchGatewayIfExists', () => {
  it('不新建记录、不抢 ACTIVE_KEY', async () => {
    const a = await upsertGateway({ id: 'gw:a', url: 'wss://a.example.com/ws/mobile' });
    await upsertGateway({ id: 'gw:b', url: 'wss://b.example.com/ws/mobile' });
    expect((await loadActiveGateway())?.id).toBe('gw:b');

    expect(await patchGatewayIfExists('gw:missing', { label: 'ghost' })).toBeNull();
    expect(await loadGateways()).toHaveLength(2);

    const patched = await patchGatewayIfExists(a.id, { gatewayName: 'A' });
    expect(patched?.gatewayName).toBe('A');
    expect((await loadActiveGateway())?.id).toBe('gw:b');
  });

  it('并发 patch 不丢字段（锁内重新读取）', async () => {
    await upsertGateway({ id: 'gw:a', url: 'wss://a.example.com/ws/mobile' });
    await Promise.all([
      patchGatewayIfExists('gw:a', { gatewayName: 'host-a' }),
      patchGatewayIfExists('gw:a', (current) => ({ label: current.id })),
    ]);
    const [entry] = await loadGateways();
    expect(entry.gatewayName).toBe('host-a');
    expect(entry.label).toBe('gw:a');
  });

  it('已删除的记录不会被迟到的 patch 复活', async () => {
    await upsertGateway({ id: 'gw:a', url: 'wss://a.example.com/ws/mobile' });
    await removeGateway('gw:a');
    expect(await patchGatewayIfExists('gw:a', { gatewayName: 'late' })).toBeNull();
    expect(await loadGateways()).toHaveLength(0);
  });

  it('rendezvous 配置与 seenRev 落盘后读回仍在（冷启动 J10）', async () => {
    const entry = await upsertGateway({
      id: 'gw:a',
      url: 'wss://a.example.com/ws/mobile',
      rendezvous: {
        url: 'https://book.example.workers.dev',
        key: VECTOR_KEY,
        gatewayId: 'g1',
      },
    });
    await patchGatewayIfExists(entry.id, {
      rendezvous: { ...entry.rendezvous!, seenRev: 7 },
    });
    const [loaded] = await loadGateways();
    expect(loaded.rendezvous).toEqual({
      url: 'https://book.example.workers.dev',
      key: VECTOR_KEY,
      gatewayId: 'g1',
      seenRev: 7,
    });
  });

  it('非法 rendezvous 配置在归一化时被丢弃', async () => {
    const entry = await upsertGateway({
      id: 'gw:a',
      url: 'wss://a.example.com/ws/mobile',
      rendezvous: { url: 'http://not-https.example.com', key: VECTOR_KEY, gatewayId: 'g1' },
    });
    expect(entry.rendezvous).toBeUndefined();
  });
});

describe('createUrlRefresher', () => {
  it('同一网关单飞：并发调用只发一次请求', async () => {
    const current = saved();
    let release: (body: string | null) => void = () => undefined;
    const fetchBook = jest.fn(
      () => new Promise<string | null>((resolve) => (release = resolve)),
    );
    const patch = jest.fn(async (id: string, delta: unknown) => {
      const next = typeof delta === 'function' ? delta(current) : delta;
      return next ? ({ ...current, ...next } as SavedGateway) : null;
    });
    const refresher = createUrlRefresher({
      getSaved: () => current,
      patch,
      fetchBook,
      now: () => 1_762_000_100_000,
    });

    const first = refresher('gw:g1');
    const second = refresher('gw:g1');
    expect(second).toBe(first);
    expect(fetchBook).toHaveBeenCalledTimes(1);

    release(VECTOR_BODY);
    await expect(first).resolves.toBe('wss://abc.trycloudflare.com/ws/mobile');
    expect(patch).toHaveBeenCalledTimes(1);
    const deltaFn = patch.mock.calls[0][1] as unknown as (entry: SavedGateway) => {
      rendezvous: { seenRev?: number };
      endpoints?: string[];
    };
    const delta = deltaFn(current);
    expect(delta.rendezvous.seenRev).toBe(7);
    expect(delta.endpoints).toEqual([
      'wss://abc.trycloudflare.com/ws/mobile',
      'ws://192.168.1.10:3081/ws/mobile',
    ]);
  });

  it('await 期间切到别的网关 / key 变了 -> 丢弃结果且不写存储', async () => {
    let current = saved();
    let release: (body: string | null) => void = () => undefined;
    const fetchBook = jest.fn(
      () => new Promise<string | null>((resolve) => (release = resolve)),
    );
    const patch = jest.fn();
    const refresher = createUrlRefresher({ getSaved: () => current, patch, fetchBook });

    const pending = refresher('gw:g1');
    current = saved({ id: 'gw:g2' });
    release(VECTOR_BODY);
    await expect(pending).resolves.toBeUndefined();
    expect(patch).not.toHaveBeenCalled();

    current = saved();
    const again = refresher('gw:g1');
    current = saved({ rendezvous: { ...saved().rendezvous!, key: 'B'.repeat(43) } });
    release(VECTOR_BODY);
    await expect(again).resolves.toBeUndefined();
    expect(patch).not.toHaveBeenCalled();
  });

  it('rev 未推进 -> 返回当前保存的 URL（另一条连接可能已刷新）', async () => {
    const current = saved({
      url: 'wss://refreshed.example.com/ws/mobile',
      rendezvous: { ...saved().rendezvous!, seenRev: 7 },
    });
    const patch = jest.fn();
    const refresher = createUrlRefresher({
      getSaved: () => current,
      patch,
      fetchBook: async () => VECTOR_BODY,
      now: () => 1_762_000_100_000,
    });
    await expect(refresher('gw:g1')).resolves.toBe('wss://refreshed.example.com/ws/mobile');
    expect(patch).not.toHaveBeenCalled();
  });

  it('Worker 不可达 -> 交回保存的 URL，不写存储', async () => {
    const current = saved();
    const patch = jest.fn();
    const refresher = createUrlRefresher({
      getSaved: () => current,
      patch,
      fetchBook: async () => null,
    });
    await expect(refresher('gw:g1')).resolves.toBe(current.url);
    expect(patch).not.toHaveBeenCalled();
  });

  it('写存储失败不推进 seenRev，也不把 URL 交给调用方', async () => {
    const current = saved();
    const patch = jest.fn().mockRejectedValue(new Error('secure-store failed'));
    const refresher = createUrlRefresher({
      getSaved: () => current,
      patch,
      fetchBook: async () => VECTOR_BODY,
      now: () => 1_762_000_100_000,
    });
    await expect(refresher('gw:g1')).resolves.toBeUndefined();
    // patch 抛错 = 什么都没写：seenRev 自然没推进。
    expect(current.rendezvous?.seenRev).toBeUndefined();
  });

  it('没有地址簿配置 -> 不请求网络', async () => {
    const fetchBook = jest.fn();
    const refresher = createUrlRefresher({
      getSaved: () => saved({ rendezvous: undefined }),
      patch: jest.fn(),
      fetchBook,
    });
    await expect(refresher('gw:g1')).resolves.toBeUndefined();
    expect(fetchBook).not.toHaveBeenCalled();
  });
});

describe('fetchAddressBook', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('GET {url}/r/{path}，credentials omit，非 200 返回 null', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 404, text: async () => 'nope' });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      fetchAddressBook(saved().rendezvous!),
    ).resolves.toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://dsh-rendezvous.example.workers.dev/r/EhVmqRM6hY4xZwkqg2KgsMtamzQX33K2rJdB8RgfnY8',
    );
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('omit');
  });

  it('读完超过 8192 字符就丢弃（读后检查，不是接收上限）', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: async () => 'A'.repeat(8193),
    }) as unknown as typeof fetch;
    await expect(fetchAddressBook(saved().rendezvous!)).resolves.toBeNull();
  });
});
