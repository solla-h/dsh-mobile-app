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

/** 解析二维码/粘贴的配对载荷，并校验版本与有效期。 */
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
  return candidate as PairingPayload;
}
