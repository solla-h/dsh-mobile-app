import { gcm } from '@noble/ciphers/aes.js';

import { decodeBase64Url, isPairingUrlAllowed } from '../pairing';
import {
  applyAdoption,
  decodeAddressBook,
  decideAdoption,
  deriveLocator,
  encodeBase64Url,
  isRendezvousKey,
  matchesRendezvousRequest,
  normalizeWorkerUrl,
  parseRendezvousConfigFrame,
  pickGatewayUrl,
  type RendezvousConfig,
} from '../rendezvous';

/** docs/rendezvous-design.md §4.2 的互操作向量。 */
const VECTOR_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const VECTOR_BODY =
  'AQABAgMEBQYHCAkKC2o9ixs6CrlWNdCqYJujnipSZYB1j0sz5t82XX8Su-FrC8YpOXSsYbkM3N3BIpt2ZwvLEVXkIpzzvJ24ZQ5T2JZG2t4cRP9us4GHPDYsBOOtYbTmzqr7IXRB2LlrK06nw9AhZRfAxXldWIyzgLXGPvFW9siaH6kXprVGGwInS0hXLir8cFeF3KwcisSqb5u6eWz2OgMcOfJoK-g6vMXekd1Hc5vSloBXbyj9acQOIKZfietXgjZjt9q0ZkibAIitqDB_j_pBUhbADYxPUbyWtevfZTaTPA';
const VECTOR_GATEWAY = '3f1b9c2e-7d4a-4b8f-9c1d-2e5a6b7c8d9f';

const config = (overrides: Partial<RendezvousConfig> = {}): RendezvousConfig => ({
  url: 'https://dsh-rendezvous.example.workers.dev',
  key: VECTOR_KEY,
  gatewayId: VECTOR_GATEWAY,
  ...overrides,
});

/** 和网关 lib/rendezvous.mjs 相同的构造方式，用来造负向用例。 */
function encryptBlob(
  plaintext: Record<string, unknown>,
  key: string,
  nonce = new Uint8Array(12).fill(9),
): string {
  const { path, aesKey } = deriveLocator(key);
  const bytes = Array.from(JSON.stringify(plaintext)).map((char) => char.charCodeAt(0));
  const sealed = gcm(aesKey, nonce, asciiBytes(path)).encrypt(Uint8Array.from(bytes));
  return encodeBase64Url(Uint8Array.from([0x01, ...nonce, ...sealed]));
}

function asciiBytes(input: string): Uint8Array {
  return Uint8Array.from(Array.from(input).map((char) => char.charCodeAt(0)));
}

const NOW = 1_762_000_100_000; // 向量里 rev=7 永远不过期

describe('decodeAddressBook', () => {
  it('解出 §4.2 向量，并忽略明文里的 ts/name', () => {
    const book = decodeAddressBook({ body: VECTOR_BODY, config: config(), now: NOW });
    expect(book).toEqual({
      rev: 7,
      endpoints: [
        'wss://abc.trycloudflare.com/ws/mobile',
        'ws://192.168.1.10:3081/ws/mobile',
      ],
    });
  });

  it('非规范 base64url 被拒（解码后再编码必须相等）', () => {
    // 302 % 4 = 2：末位只用 4 bit，改填充位能得到同样的字节但不是规范编码。
    const tampered = VECTOR_BODY.slice(0, -1) + 'B';
    expect(decodeAddressBook({ body: tampered, config: config(), now: NOW })).toBeNull();
  });

  it('超长 / 篡改首字节 / 截断 / 改密文 都被拒', () => {
    expect(
      decodeAddressBook({ body: VECTOR_BODY + 'A'.repeat(8192), config: config(), now: NOW }),
    ).toBeNull();

    const bytes = decodeBase64Url(VECTOR_BODY);
    bytes[0] = 0x02;
    expect(
      decodeAddressBook({ body: encodeBase64Url(bytes), config: config(), now: NOW }),
    ).toBeNull();

    expect(
      decodeAddressBook({ body: VECTOR_BODY.slice(0, 40), config: config(), now: NOW }),
    ).toBeNull();

    const middle = VECTOR_BODY.slice(0, 30) + 'A' + VECTOR_BODY.slice(31);
    expect(decodeAddressBook({ body: middle, config: config(), now: NOW })).toBeNull();
  });

  it('错 key / gatewayId 不符 / rev 未推进 都被拒', () => {
    expect(
      decodeAddressBook({
        body: VECTOR_BODY,
        config: config({ key: 'B'.repeat(43) }),
        now: NOW,
      }),
    ).toBeNull();
    expect(
      decodeAddressBook({
        body: VECTOR_BODY,
        config: config({ gatewayId: 'another-gateway' }),
        now: NOW,
      }),
    ).toBeNull();
    expect(
      decodeAddressBook({ body: VECTOR_BODY, config: config({ seenRev: 7 }), now: NOW }),
    ).toBeNull();
    expect(
      decodeAddressBook({ body: VECTOR_BODY, config: config({ seenRev: 6 }), now: NOW })?.rev,
    ).toBe(7);
  });

  it('rev 领先本机超过 7 天被拒，6 天可以', () => {
    const future = encryptBlob(
      { v: 1, rev: NOW + 8 * 86_400_000, gatewayId: VECTOR_GATEWAY, endpoints: ['wss://a.example.com/ws/mobile'] },
      VECTOR_KEY,
    );
    expect(decodeAddressBook({ body: future, config: config(), now: NOW })).toBeNull();

    const ok = encryptBlob(
      { v: 1, rev: NOW + 6 * 86_400_000, gatewayId: VECTOR_GATEWAY, endpoints: ['wss://a.example.com/ws/mobile'] },
      VECTOR_KEY,
    );
    expect(decodeAddressBook({ body: ok, config: config(), now: NOW })?.rev).toBe(
      NOW + 6 * 86_400_000,
    );
  });

  it('endpoints 全被 SEC-1 过滤掉 = 没有数据', () => {
    const body = encryptBlob(
      { v: 1, rev: 1, gatewayId: VECTOR_GATEWAY, endpoints: ['http://8.8.8.8/ws/mobile'] },
      VECTOR_KEY,
    );
    expect(decodeAddressBook({ body, config: config(), now: NOW })).toBeNull();
    expect(isPairingUrlAllowed('http://8.8.8.8/ws/mobile')).toBe(false);
  });

  it('Tailscale 私有地址可作为地址簿入口', () => {
    const body = encryptBlob(
      {
        v: 1,
        rev: 2,
        gatewayId: VECTOR_GATEWAY,
        endpoints: ['ws://100.64.1.2:3081/ws/mobile'],
      },
      VECTOR_KEY,
    );
    expect(decodeAddressBook({ body, config: config(), now: NOW })?.endpoints).toEqual([
      'ws://100.64.1.2:3081/ws/mobile',
    ]);
  });

  it('去重后保留合法项；空数组被拒', () => {
    const dup = encryptBlob(
      {
        v: 1,
        rev: 2,
        gatewayId: VECTOR_GATEWAY,
        endpoints: ['wss://a.example.com/ws/mobile', 'wss://a.example.com/ws/mobile'],
      },
      VECTOR_KEY,
    );
    expect(decodeAddressBook({ body: dup, config: config(), now: NOW })?.endpoints).toEqual([
      'wss://a.example.com/ws/mobile',
    ]);
    const empty = encryptBlob(
      { v: 1, rev: 2, gatewayId: VECTOR_GATEWAY, endpoints: [] },
      VECTOR_KEY,
    );
    expect(decodeAddressBook({ body: empty, config: config(), now: NOW })).toBeNull();
  });
});

describe('decideAdoption', () => {
  const local = config({ seenRev: 9 });
  const incoming = (overrides: Partial<RendezvousConfig> = {}) =>
    config({ ...overrides, seenRev: undefined });

  it('本地没有 -> adopt；完全相同 -> same', () => {
    expect(decideAdoption(undefined, incoming())).toBe('adopt');
    expect(decideAdoption(local, incoming())).toBe('same');
  });

  it('同 Worker 换 key -> rotate-key；同 gatewayId 换 Worker -> migrate', () => {
    expect(decideAdoption(local, incoming({ key: 'B'.repeat(43) }))).toBe('rotate-key');
    expect(decideAdoption(local, incoming({ url: 'https://other.example.workers.dev' }))).toBe(
      'migrate',
    );
    expect(
      decideAdoption(
        local,
        incoming({ url: 'https://other.example.workers.dev', key: 'B'.repeat(43) }),
      ),
    ).toBe('migrate');
  });

  it('gatewayId 与本地记录不符 -> conflict（整帧丢弃）', () => {
    expect(decideAdoption(undefined, incoming(), 'another-gateway')).toBe('conflict');
    expect(decideAdoption(local, incoming({ gatewayId: 'another-gateway' }))).toBe('conflict');
    expect(
      decideAdoption(
        local,
        incoming({ gatewayId: 'another-gateway', url: 'https://other.example.workers.dev' }),
      ),
    ).toBe('conflict');
    expect(decideAdoption(undefined, incoming(), VECTOR_GATEWAY)).toBe('adopt');
  });
});

describe('matchesRendezvousRequest', () => {
  it('无 requestId 的主动推送接受；带 requestId 的只认匹配项', () => {
    expect(matchesRendezvousRequest(undefined, 'r1')).toBe(true);
    expect(matchesRendezvousRequest(undefined, null)).toBe(true);
    expect(matchesRendezvousRequest('r1', 'r1')).toBe(true);
    expect(matchesRendezvousRequest('r2', 'r1')).toBe(false);
    expect(matchesRendezvousRequest('r1', null)).toBe(false);
    expect(matchesRendezvousRequest(42, 'r1')).toBe(false);
  });
});

describe('applyAdoption', () => {
  const local = config({ seenRev: 9 });
  const incoming = config({
    url: 'https://new-worker.example.workers.dev',
    key: 'B'.repeat(43),
    seenRev: undefined,
  });

  it('migrate 写回新 url/key 并清空 seenRev', () => {
    expect(applyAdoption({ decision: 'migrate', local, incoming })).toEqual({
      url: 'https://new-worker.example.workers.dev',
      key: 'B'.repeat(43),
      gatewayId: VECTOR_GATEWAY,
      seenRev: undefined,
    });
  });

  it('等待期间网关身份变了 -> 不写回', () => {
    expect(
      applyAdoption({ decision: 'migrate', local, incoming, gatewayId: 'another-gateway' }),
    ).toBeNull();
    expect(
      applyAdoption({
        decision: 'migrate',
        local: config({ gatewayId: 'another-gateway' }),
        incoming,
      }),
    ).toBeNull();
  });

  it('same 保留 seenRev；rotate-key 清空', () => {
    expect(
      applyAdoption({ decision: 'same', local, incoming: config({ seenRev: undefined }) })?.seenRev,
    ).toBe(9);
    expect(
      applyAdoption({
        decision: 'rotate-key',
        local,
        incoming: config({ key: 'B'.repeat(43) }),
      })?.seenRev,
    ).toBeUndefined();
  });
});

describe('normalizeWorkerUrl', () => {
  it('只接受无路径的 https origin', () => {
    expect(normalizeWorkerUrl('https://dsh-rendezvous.x.workers.dev')).toBe(
      'https://dsh-rendezvous.x.workers.dev',
    );
    expect(normalizeWorkerUrl('https://dsh-rendezvous.x.workers.dev/')).toBe(
      'https://dsh-rendezvous.x.workers.dev',
    );
  });

  it('http / 带路径 / userinfo / query / IP / localhost 都拒绝', () => {
    for (const value of [
      'http://dsh-rendezvous.x.workers.dev',
      'https://dsh-rendezvous.x.workers.dev/r/abc',
      'https://user:pass@dsh-rendezvous.x.workers.dev',
      'https://dsh-rendezvous.x.workers.dev/?a=1',
      'https://dsh-rendezvous.x.workers.dev/#x',
      'https://1.2.3.4',
      'https://localhost',
      'not a url',
      '',
    ]) {
      expect(normalizeWorkerUrl(value)).toBeNull();
    }
  });
});

describe('parseRendezvousConfigFrame', () => {
  it('接受完整配置并回显字段', () => {
    expect(
      parseRendezvousConfigFrame({
        kind: 'rendezvous-config',
        requestId: 'r1',
        url: 'https://dsh-rendezvous.x.workers.dev',
        key: VECTOR_KEY,
        gatewayId: VECTOR_GATEWAY,
      }),
    ).toEqual({
      url: 'https://dsh-rendezvous.x.workers.dev',
      key: VECTOR_KEY,
      gatewayId: VECTOR_GATEWAY,
    });
  });

  it('kind / key / url / gatewayId 任一不合格就整帧拒绝', () => {
    const base = {
      kind: 'rendezvous-config',
      requestId: 'r1',
      url: 'https://dsh-rendezvous.x.workers.dev',
      key: VECTOR_KEY,
      gatewayId: VECTOR_GATEWAY,
    };
    expect(parseRendezvousConfigFrame({ ...base, kind: 'other' })).toBeNull();
    expect(parseRendezvousConfigFrame({ ...base, key: 'short' })).toBeNull();
    expect(parseRendezvousConfigFrame({ ...base, url: 'http://x.example.com' })).toBeNull();
    expect(parseRendezvousConfigFrame({ ...base, gatewayId: '' })).toBeNull();
    expect(parseRendezvousConfigFrame(null)).toBeNull();
  });
});

describe('pickGatewayUrl / isRendezvousKey', () => {
  it('优先 wss，没有则第一项', () => {
    expect(pickGatewayUrl(['ws://192.168.1.10:3081/ws/mobile', 'wss://a.example.com/ws/mobile'])).toBe(
      'wss://a.example.com/ws/mobile',
    );
    expect(pickGatewayUrl(['ws://192.168.1.10:3081/ws/mobile'])).toBe(
      'ws://192.168.1.10:3081/ws/mobile',
    );
    expect(pickGatewayUrl([])).toBeUndefined();
  });

  it('key 必须是 43 字符 base64url', () => {
    expect(isRendezvousKey(VECTOR_KEY)).toBe(true);
    expect(isRendezvousKey('A'.repeat(42))).toBe(false);
    expect(isRendezvousKey('A'.repeat(44))).toBe(false);
    expect(isRendezvousKey('A'.repeat(42) + '+')).toBe(false);
    expect(isRendezvousKey(123)).toBe(false);
  });
});
