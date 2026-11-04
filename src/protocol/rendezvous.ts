/**
 * 地址簿（Rendezvous）的纯函数层：密钥派生、blob 解密与校验、配置决策。
 * 不 import react-native，可在 Node/jest 下直接测。
 *
 * 与网关 `lib/rendezvous.mjs` 必须逐字节一致；测试向量见
 * `docs/rendezvous-design.md` §4.2。
 */
import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  decodeBase64Url,
  decodeUtf8,
  isPairingUrlAllowed,
} from './pairing';

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export const RENDEZVOUS_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const RENDEZVOUS_BODY_MAX_CHARS = 8192;
const ENVELOPE_HEADER_BYTES = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MIN_PLAINTEXT_BYTES = 2;
const MAX_REV_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;

const PATH_INFO = 'dsh-rendezvous-path-v1';
const AES_INFO = 'dsh-rendezvous-blob-v1';

export interface RendezvousConfig {
  /** Worker origin，已规范化，无末尾斜杠 */
  url: string;
  /** 43 字符 base64url */
  key: string;
  /** blob 归属校验 */
  gatewayId: string;
  /** 已接纳的最大 rev */
  seenRev?: number;
}

export interface AddressBook {
  rev: number;
  endpoints: string[];
}

export type AdoptionDecision = 'adopt' | 'rotate-key' | 'same' | 'conflict';

/** ASCII/UTF-8 编码；输入只会有协议里定义的 ASCII 字符串。 */
function utf8Bytes(input: string): Uint8Array {
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code > 0x7f) throw new Error('unexpected non-ascii input');
    out[i] = code;
  }
  return out;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    buffer = (buffer << 8) | bytes[i];
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += BASE64URL_ALPHABET[(buffer >> bits) & 0x3f];
    }
  }
  if (bits > 0) out += BASE64URL_ALPHABET[(buffer << (6 - bits)) & 0x3f];
  return out;
}

export function isRendezvousKey(value: unknown): value is string {
  return typeof value === 'string' && RENDEZVOUS_KEY_PATTERN.test(value);
}

/** pathKey/aesKey 的派生；顺带返回规范编码的 path（43 字符）。 */
export function deriveLocator(key: string): { path: string; aesKey: Uint8Array } {
  if (!isRendezvousKey(key)) throw new Error('invalid rendezvous key');
  const keyBytes = decodeBase64Url(key);
  if (keyBytes.length !== 32) throw new Error('invalid rendezvous key length');
  const pathKey = hkdf(sha256, keyBytes, new Uint8Array(0), utf8Bytes(PATH_INFO), 32);
  const aesKey = hkdf(sha256, keyBytes, new Uint8Array(0), utf8Bytes(AES_INFO), 32);
  return { path: encodeBase64Url(pathKey), aesKey };
}

export function normalizeWorkerUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
  const host = parsed.hostname;
  // 必须是有域名的公网 HTTPS；localhost/IP 字面量都不接受。
  if (!host.includes('.') || host.startsWith('[')) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  return parsed.origin;
}

/** 只接受新协议里的配置响应；任何字段不合格都返回 null。 */
export function parseRendezvousConfigFrame(frame: unknown): RendezvousConfig | null {
  if (!frame || typeof frame !== 'object') return null;
  const record = frame as Record<string, unknown>;
  if (record.kind !== 'rendezvous-config') return null;
  const url = normalizeWorkerUrl(record.url);
  const key = record.key;
  const gatewayId = record.gatewayId;
  if (!url || !isRendezvousKey(key)) return null;
  if (typeof gatewayId !== 'string' || gatewayId.length === 0) return null;
  return { url, key, gatewayId };
}

export function pickGatewayUrl(endpoints: string[]): string | undefined {
  return endpoints.find((url) => url.startsWith('wss://')) ?? endpoints[0];
}

/**
 * 是否采纳网关下发的配置：
 * - 本地已有地址簿时，url 变化一律 conflict（可能是被冒充的网关在塞伪造入口）；
 * - url 相同、key 不同 = 网关侧 key 轮换/记录丢失，安全（Worker 仍是原来那台）；
 * - gatewayId 与本地记录不一致视为另一个网关，整帧丢弃。
 */
export function decideAdoption(
  local: RendezvousConfig | undefined,
  incoming: RendezvousConfig,
  recordGatewayId?: string,
): AdoptionDecision {
  if (recordGatewayId && incoming.gatewayId !== recordGatewayId) return 'conflict';
  if (!local) return 'adopt';
  if (local.gatewayId !== incoming.gatewayId) return 'conflict';
  if (local.url !== incoming.url) return 'conflict';
  if (local.key !== incoming.key) return 'rotate-key';
  return 'same';
}

/**
 * 按设计文档 §4.4 的 6 步校验并解密：
 * 任何一步失败返回 null，调用方静默回退到现状。
 */
export function decodeAddressBook(input: {
  body: string;
  config: RendezvousConfig;
  now?: number;
}): AddressBook | null {
  const { body, config } = input;
  const now = input.now ?? Date.now();
  if (typeof body !== 'string' || body.length < 24 || body.length > RENDEZVOUS_BODY_MAX_CHARS) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;

  let envelope: Uint8Array;
  let path: string;
  let aesKey: Uint8Array;
  try {
    // 规范性：解码后再编码必须与原文完全一致。
    envelope = decodeBase64Url(body);
    if (encodeBase64Url(envelope) !== body) return null;
    const locator = deriveLocator(config.key);
    path = locator.path;
    aesKey = locator.aesKey;
  } catch {
    return null;
  }

  const minEnvelope = ENVELOPE_HEADER_BYTES + NONCE_BYTES + TAG_BYTES + MIN_PLAINTEXT_BYTES;
  if (envelope.length < minEnvelope || envelope[0] !== 0x01) return null;

  const nonce = envelope.subarray(1, 1 + NONCE_BYTES);
  const ciphertext = envelope.subarray(1 + NONCE_BYTES);

  let plaintext: Uint8Array;
  try {
    plaintext = gcm(aesKey, nonce, utf8Bytes(path)).decrypt(ciphertext);
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8(plaintext));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;

  if (record.v !== 1) return null;
  const rev = record.rev;
  if (typeof rev !== 'number' || !Number.isSafeInteger(rev) || rev <= 0) return null;
  // 防御网关时钟被拨到未来后永久卡死：允许最多领先本机 7 天。
  if (rev > now + MAX_REV_AHEAD_MS) return null;
  if (typeof record.gatewayId !== 'string' || record.gatewayId !== config.gatewayId) return null;

  const rawEndpoints = record.endpoints;
  if (!Array.isArray(rawEndpoints) || rawEndpoints.length < 1 || rawEndpoints.length > 16) {
    return null;
  }
  const endpoints: string[] = [];
  for (const endpoint of rawEndpoints) {
    if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) return null;
    if (!isPairingUrlAllowed(endpoint)) continue;
    if (!endpoints.includes(endpoint)) endpoints.push(endpoint);
  }
  if (endpoints.length === 0) return null;

  const seenRev = typeof config.seenRev === 'number' && Number.isSafeInteger(config.seenRev)
    ? config.seenRev
    : 0;
  if (rev <= seenRev) return null;

  return { rev, endpoints };
}
