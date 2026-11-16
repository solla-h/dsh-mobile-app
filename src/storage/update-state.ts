import type { LatestManifest } from '../update/manifest';
import { parseLatestManifest } from '../update/manifest';
import { readJson, removeJson, writeJson } from './persisted-state';

/**
 * 更新检查的持久状态。
 *
 * 只放两件事：上次自动检查的时间（节流用）与上次成功拿到的清单（离线回显用）。
 * 落盘走 dsh-state 的 JSON 文件，与 app-settings 同一个后端；写操作必须读-合并-写，
 * 不能整对象覆盖——两个字段是分开写的（手动检查只写 cachedManifest）。
 */
export interface UpdateState {
  /** 上次自动检查成功的时间戳（毫秒）；从未检查为 null。 */
  lastCheckAt: number | null;
  /** 上次成功解析的远端清单；从未检查或文件损坏为 null。 */
  cachedManifest: LatestManifest | null;
}

const UPDATE_STATE_KEY = 'update-state';

const EMPTY_STATE: UpdateState = { lastCheckAt: null, cachedManifest: null };

/** 逐字段校验落盘内容：坏字段单独退回默认值，不影响另一个字段。 */
function normalize(raw: unknown): UpdateState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATE };
  const record = raw as Record<string, unknown>;

  const lastCheckAt =
    typeof record.lastCheckAt === 'number' &&
    Number.isFinite(record.lastCheckAt) &&
    record.lastCheckAt > 0
      ? record.lastCheckAt
      : null;

  // 缓存清单重新过一遍解析：文件被改写/旧版本残留时宁可当作没有缓存。
  const cachedManifest = parseLatestManifest(record.cachedManifest);

  return { lastCheckAt, cachedManifest };
}

/** 读取更新状态；文件缺失或读取失败时返回全空状态，不抛异常。 */
export async function loadUpdateState(): Promise<UpdateState> {
  try {
    return normalize(await readJson<unknown>(UPDATE_STATE_KEY));
  } catch {
    return { ...EMPTY_STATE };
  }
}

/** 只合并传入的字段；落盘失败由 writeJson 吞掉。 */
export async function saveUpdateState(patch: Partial<UpdateState>): Promise<void> {
  try {
    const saved = normalize(await readJson<unknown>(UPDATE_STATE_KEY));
    await writeJson(UPDATE_STATE_KEY, { ...saved, ...patch });
  } catch {
    // 更新检查是后台行为，落盘失败不值得打断用户；下次检查会重试。
  }
}

/** 清空缓存（测试与将来的「清除更新缓存」入口共用）。 */
export async function clearUpdateState(): Promise<void> {
  try {
    await removeJson(UPDATE_STATE_KEY);
  } catch {
    // 同上
  }
}
