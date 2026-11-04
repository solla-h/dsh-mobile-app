import type { PairingPayload } from './types';

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * 严格 Base64URL 解码：只接受 A-Z a-z 0-9 - _。
 * 协议明确禁止 padding、普通 Base64 和原始 JSON。
 */
export function decodeBase64Url(input: string): Uint8Array {
  const text = input.trim();
  if (text.length === 0) throw new Error('配对内容为空');
  if (!/^[A-Za-z0-9_-]+$/.test(text)) {
    throw new Error('配对内容不是合法 Base64URL（不能包含 = 或空格）');
  }
  const bytes = new Uint8Array(Math.floor((text.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (let i = 0; i < text.length; i += 1) {
    const value = BASE64URL_ALPHABET.indexOf(text[i]);
    if (value < 0) throw new Error('配对内容包含非法字符');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index] = (buffer >> bits) & 0xff;
      index += 1;
    }
  }
  return bytes.subarray(0, index);
}

/** 手写 UTF-8 解码，避免依赖 Hermes 上不一定存在的 TextDecoder。 */
export function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    i += 1;
    let codePoint: number;
    if (b0 < 0x80) {
      codePoint = b0;
    } else if ((b0 & 0xe0) === 0xc0) {
      codePoint = ((b0 & 0x1f) << 6) | (bytes[i] & 0x3f);
      i += 1;
    } else if ((b0 & 0xf0) === 0xe0) {
      codePoint = ((b0 & 0x0f) << 12) | ((bytes[i] & 0x3f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else {
      codePoint =
        ((b0 & 0x07) << 18) |
        ((bytes[i] & 0x3f) << 12) |
        ((bytes[i + 1] & 0x3f) << 6) |
        (bytes[i + 2] & 0x3f);
      i += 3;
    }
    out += String.fromCodePoint(codePoint);
  }
  return out;
}

/**
 * 配对的 URL 安全门（SEC-1）：明文 ws:// 只允许本机/局域网范围，
 * 公网地址必须走 wss://。
 * 口径与网关 `lib/index.mjs` 的 `isPrivateNetworkHostname` 完全对齐——
 * 服务端配置 publicUrl 时执行同一规则，客户端原样镜像：不额外加严
 * （不误伤合法配对），也不放松（服务端不产出的地址这里也拒绝）。
 */
export function isPairingUrlAllowed(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'wss:') return true;
  if (parsed.protocol !== 'ws:') return false;
  return isPrivateNetworkHostname(parsed.hostname);
}

/** 与网关 `lib/index.mjs:isPrivateNetworkHostname` 同口径（含 ::ffff: 映射与 %zone 剥离）。 */
function isPrivateNetworkHostname(hostname: string): boolean {
  let normalized = hostname.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (normalized.startsWith('::ffff:')) normalized = normalized.slice('::ffff:'.length);
  if (
    normalized === 'localhost' ||
    normalized === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  ) {
    return true;
  }
  if (normalized.endsWith('.local')) return true;
  const octets = normalized.split('.').map((part) => Number(part));
  if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return (
      octets[0] === 10 ||
      // Tailscale CGNAT 段；网关 isPrivateNetworkHostname 已放行，客户端必须同口径。
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254)
    );
  }
  // IPv6：ULA f[cd]xx: 与链路本地 fe[89ab]x:
  return /^(?:f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/.test(normalized);
}

/**
 * 解析二维码/粘贴的配对载荷，并校验版本与有效期。
 * 候选地址（publicUrl + endpoints）全量过 `isPairingUrlAllowed`：
 * 不合格的整条丢弃，全丢光就拒绝配对；返回值里的 publicUrl/endpoints 已净化。
 */
export function parsePairingPayload(text: string, now = Date.now()): PairingPayload {
  const json = decodeUtf8(decodeBase64Url(text));
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error('配对内容解码后不是 JSON');
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('配对内容格式不正确');
  }
  const candidate = payload as Partial<PairingPayload>;
  if (candidate.version !== 2) {
    throw new Error(`不支持的配对版本：${String(candidate.version)}`);
  }
  if (typeof candidate.publicUrl !== 'string' || !/^wss?:\/\//.test(candidate.publicUrl)) {
    throw new Error('配对内容缺少有效的 WebSocket 地址');
  }
  if (typeof candidate.pairingCode !== 'string' || candidate.pairingCode.length === 0) {
    throw new Error('配对内容缺少配对码');
  }
  if (typeof candidate.expiresAt !== 'number' || candidate.expiresAt <= now) {
    throw new Error('配对码已过期，请在 WebUI 重新生成');
  }
  // 不可信载荷：endpoints 可能是任意 JSON，先按数组收，再逐条过安全门。
  const rawEndpoints = Array.isArray(candidate.endpoints) ? candidate.endpoints : [];
  const allowed: string[] = [];
  for (const url of [candidate.publicUrl, ...rawEndpoints]) {
    if (isPairingUrlAllowed(url) && !allowed.includes(url)) allowed.push(url);
  }
  if (allowed.length === 0) {
    throw new Error('配对内容里没有安全的连接地址：公网明文 ws:// 已拦截，请用 wss:// 或局域网地址重新配对');
  }
  const publicUrl = allowed.find((url) => url.startsWith('wss://')) ?? allowed[0];
  return {
    ...(candidate as PairingPayload),
    publicUrl,
    endpoints: allowed.filter((url) => url !== publicUrl),
  };
}
