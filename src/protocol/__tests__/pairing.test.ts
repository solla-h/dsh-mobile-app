import { isPairingUrlAllowed, parsePairingPayload } from '../pairing';

/** 测试里只有 ASCII 载荷；手写 base64url 编码，避免引入 Node 类型。 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function encode(payload: unknown): string {
  const text = JSON.stringify(payload);
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i += 1) {
    buffer = (buffer << 8) | text.charCodeAt(i);
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET[(buffer >> bits) & 0x3f];
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (6 - bits)) & 0x3f];
  return out;
}

function payloadOf(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    publicUrl: 'wss://gw.example.com/ws/mobile',
    pairingCode: 'code-1',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe('isPairingUrlAllowed', () => {
  it('wss 一律放行（加密不分内网外网）', () => {
    expect(isPairingUrlAllowed('wss://gw.example.com/ws/mobile')).toBe(true);
    expect(isPairingUrlAllowed('wss://192.168.1.10:3081/ws/mobile')).toBe(true);
  });

  it('ws 只放行本机/私网/链路本地/`.local`（与网关同口径）', () => {
    expect(isPairingUrlAllowed('ws://127.0.0.1:3080/ws/mobile')).toBe(true);
    expect(isPairingUrlAllowed('ws://localhost:3080/ws/mobile')).toBe(true);
    expect(isPairingUrlAllowed('ws://192.168.1.10:3081/ws/mobile')).toBe(true);
    expect(isPairingUrlAllowed('ws://10.0.0.5:3081/ws/mobile')).toBe(true);
    expect(isPairingUrlAllowed('ws://172.16.3.4/ws/mobile')).toBe(true);
    expect(isPairingUrlAllowed('ws://172.31.0.1/ws/mobile')).toBe(true);
    expect(isPairingUrlAllowed('ws://169.254.10.1/ws/mobile')).toBe(true);
    // Tailscale 100.64.0.0/10
    expect(isPairingUrlAllowed('ws://100.64.1.2/ws/mobile')).toBe(true);
    expect(isPairingUrlAllowed('ws://100.127.255.254/ws/mobile')).toBe(true);
    expect(isPairingUrlAllowed('ws://gateway.local:3081/ws/mobile')).toBe(true);
    expect(isPairingUrlAllowed('ws://[::1]:3080/ws/mobile')).toBe(true);
    expect(isPairingUrlAllowed('ws://[fe80::1]/ws/mobile')).toBe(true);
    expect(isPairingUrlAllowed('ws://[fd00::2]/ws/mobile')).toBe(true);
  });

  it('ws 拒绝公网与越界地址', () => {
    expect(isPairingUrlAllowed('ws://8.8.8.8/ws/mobile')).toBe(false);
    expect(isPairingUrlAllowed('ws://gw.example.com/ws/mobile')).toBe(false);
    expect(isPairingUrlAllowed('ws://172.32.0.1/ws/mobile')).toBe(false);
    expect(isPairingUrlAllowed('ws://172.15.0.1/ws/mobile')).toBe(false);
    expect(isPairingUrlAllowed('ws://192.169.1.1/ws/mobile')).toBe(false);
    // 100/8 里 Tailscale 段之外仍属公网
    expect(isPairingUrlAllowed('ws://100.63.1.1/ws/mobile')).toBe(false);
    expect(isPairingUrlAllowed('ws://100.128.0.1/ws/mobile')).toBe(false);
  });

  it('非 ws/wss 或非字符串一律拒绝', () => {
    expect(isPairingUrlAllowed('http://192.168.1.1/ws/mobile')).toBe(false);
    expect(isPairingUrlAllowed('not a url')).toBe(false);
    expect(isPairingUrlAllowed('ws://')).toBe(false);
    expect(isPairingUrlAllowed(42)).toBe(false);
    expect(isPairingUrlAllowed(undefined)).toBe(false);
  });
});

describe('parsePairingPayload 端点净化（SEC-1）', () => {
  it('合法的 wss 载荷原样通过', () => {
    const text = encode(payloadOf());
    const payload = parsePairingPayload(text);
    expect(payload.publicUrl).toBe('wss://gw.example.com/ws/mobile');
    expect(payload.endpoints).toEqual([]);
  });

  it('只有公网明文 ws 时整单拒绝', () => {
    const text = encode(payloadOf({ publicUrl: 'ws://8.8.8.8/ws/mobile' }));
    expect(() => parsePairingPayload(text)).toThrow(/安全的连接地址/);
  });

  it('公网 ws 被丢弃、安全的 wss 端点被选中', () => {
    const text = encode(
      payloadOf({
        publicUrl: 'ws://8.8.8.8/ws/mobile',
        endpoints: ['wss://public.example.com/ws/mobile', 'ws://192.168.1.10:3081/ws/mobile'],
      }),
    );
    const payload = parsePairingPayload(text);
    expect(payload.publicUrl).toBe('wss://public.example.com/ws/mobile');
    expect(payload.endpoints).toEqual(['ws://192.168.1.10:3081/ws/mobile']);
  });

  it('endpoints 里的垃圾条目被过滤且不崩', () => {
    const text = encode(
      payloadOf({
        publicUrl: 'ws://192.168.1.10:3081/ws/mobile',
        endpoints: [42, 'http://x/y', null, 'ws://127.0.0.1:3080/ws/mobile'],
      }),
    );
    const payload = parsePairingPayload(text);
    expect(payload.publicUrl).toBe('ws://192.168.1.10:3081/ws/mobile');
    expect(payload.endpoints).toEqual(['ws://127.0.0.1:3080/ws/mobile']);
  });

  it('endpoints 不是数组时不炸，只按 publicUrl 判定', () => {
    const text = encode(payloadOf({ endpoints: 'oops' }));
    const payload = parsePairingPayload(text);
    expect(payload.publicUrl).toBe('wss://gw.example.com/ws/mobile');
    expect(payload.endpoints).toEqual([]);
  });

  it('过期与版本校验保持原样', () => {
    expect(() => parsePairingPayload(encode(payloadOf({ expiresAt: Date.now() - 1 })))).toThrow(/过期/);
    expect(() => parsePairingPayload(encode(payloadOf({ version: 1 })))).toThrow(/版本/);
  });
});
