import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface SavedGateway {
  url: string;
  token?: string;
  label?: string;
  gatewayId?: string;
  /** 网关公布的全部可用入口，url 只是当前选中的那一个 */
  endpoints?: string[];
}

const GATEWAY_KEY = 'dsh.gateway.v1';
const DEVICE_ID_KEY = 'dsh.device.id';

export async function loadGateway(): Promise<SavedGateway | null> {
  const raw = await SecureStore.getItemAsync(GATEWAY_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SavedGateway;
  } catch {
    return null;
  }
}

export async function saveGateway(gateway: SavedGateway): Promise<void> {
  await SecureStore.setItemAsync(GATEWAY_KEY, JSON.stringify(gateway));
}

export async function clearGateway(): Promise<void> {
  await SecureStore.deleteItemAsync(GATEWAY_KEY);
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
