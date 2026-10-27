import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface SavedGateway {
  /** 本地主键，优先用网关自报的 gatewayId，保证换入口地址后还是同一条记录 */
  id: string;
  url: string;
  token?: string;
  label?: string;
  gatewayId?: string;
  /** 网关公布的全部可用入口，url 只是当前选中的那一个 */
  endpoints?: string[];
  /** hello 里报的网关名，配对那一刻还拿不到 */
  gatewayName?: string;
  pairedAt?: number;
  lastUsedAt?: number;
}

const GATEWAYS_KEY = 'dsh.gateways.v2';
const ACTIVE_KEY = 'dsh.gateways.active';
const LEGACY_KEY = 'dsh.gateway.v1';
const DEVICE_ID_KEY = 'dsh.device.id';

/** 老版本只存了一条，读到就顺手迁移成列表。 */
async function migrateLegacy(): Promise<SavedGateway[]> {
  const raw = await SecureStore.getItemAsync(LEGACY_KEY);
  if (!raw) return [];
  try {
    const legacy = JSON.parse(raw) as Omit<SavedGateway, 'id'>;
    if (!legacy?.url) return [];
    const entry = normalize(legacy);
    await writeAll([entry]);
    await SecureStore.setItemAsync(ACTIVE_KEY, entry.id);
    await SecureStore.deleteItemAsync(LEGACY_KEY);
    return [entry];
  } catch {
    return [];
  }
}

function normalize(input: Omit<SavedGateway, 'id'> & { id?: string }): SavedGateway {
  const id = input.id || (input.gatewayId ? 'gw:' + input.gatewayId : 'url:' + input.url);
  return {
    ...input,
    id,
    pairedAt: input.pairedAt ?? Date.now(),
  };
}

/** 同一个网关换了入口地址（隧道重建）时仍然算一条记录。 */
function sameGateway(a: SavedGateway, b: SavedGateway): boolean {
  if (a.gatewayId && b.gatewayId) return a.gatewayId === b.gatewayId;
  return a.url === b.url;
}

async function readAll(): Promise<SavedGateway[]> {
  const raw = await SecureStore.getItemAsync(GATEWAYS_KEY);
  if (!raw) return migrateLegacy();
  try {
    const parsed = JSON.parse(raw) as SavedGateway[];
    if (!Array.isArray(parsed)) return [];
    // 老记录可能没有 id，补上再回写，避免每次读取都要重算。
    return parsed.filter((item) => item?.url).map((item) => (item.id ? item : normalize(item)));
  } catch {
    return [];
  }
}

async function writeAll(items: SavedGateway[]): Promise<void> {
  await SecureStore.setItemAsync(GATEWAYS_KEY, JSON.stringify(items));
}

export async function loadGateways(): Promise<SavedGateway[]> {
  return readAll();
}

export async function loadActiveGateway(): Promise<SavedGateway | null> {
  const items = await readAll();
  if (!items.length) return null;
  const activeId = await SecureStore.getItemAsync(ACTIVE_KEY);
  return items.find((item) => item.id === activeId) ?? items[0];
}

/** 新增或更新一条，并把它设为当前网关。 */
export async function upsertGateway(gateway: Omit<SavedGateway, 'id'> & { id?: string }): Promise<SavedGateway> {
  const items = await readAll();
  const incoming = normalize(gateway);
  const index = items.findIndex((item) => item.id === incoming.id || sameGateway(item, incoming));
  const next = incoming;
  if (index >= 0) {
    // 保留原有的 id，否则 ACTIVE_KEY 会指向一条已经不存在的记录。
    next.id = items[index].id;
    next.pairedAt = items[index].pairedAt ?? incoming.pairedAt;
    items[index] = next;
  } else {
    items.unshift(next);
  }
  await writeAll(items);
  await SecureStore.setItemAsync(ACTIVE_KEY, next.id);
  return next;
}

export async function activateGateway(id: string): Promise<void> {
  await SecureStore.setItemAsync(ACTIVE_KEY, id);
}

export async function removeGateway(id: string): Promise<SavedGateway[]> {
  const items = (await readAll()).filter((item) => item.id !== id);
  await writeAll(items);
  const activeId = await SecureStore.getItemAsync(ACTIVE_KEY);
  if (activeId === id) {
    if (items.length) await SecureStore.setItemAsync(ACTIVE_KEY, items[0].id);
    else await SecureStore.deleteItemAsync(ACTIVE_KEY);
  }
  return items;
}

/** 忘记所有网关。 */
export async function clearGateway(): Promise<void> {
  await SecureStore.deleteItemAsync(GATEWAYS_KEY);
  await SecureStore.deleteItemAsync(ACTIVE_KEY);
  await SecureStore.deleteItemAsync(LEGACY_KEY);
}

/** 安装级稳定设备 ID，重新配对时复用同一条可信设备记录。 */
export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, created);
  return created;
}

export function getDeviceName(): string {
  return Platform.OS === 'ios' ? 'iPhone' : 'Android';
}
