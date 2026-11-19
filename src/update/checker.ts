import { loadUpdateState, saveUpdateState } from '../storage/update-state';
import {
  evaluateUpdate,
  isAllowedUpdateUrl,
  parseLatestManifest,
  type LatestManifest,
  type UpdateEvaluation,
} from './manifest';

/**
 * 更新检查器（issue #12，只做「检查」）。
 *
 * 职责边界：拉取 latest.json、节流、缓存、判定。**不做**下载、校验和、安装——
 * 那是 chunk 4；本文件不申请权限、不改 app.json、不注册 config plugin。
 *
 * 平台约束：非 Android 也可以走这里拿到判定（复用同一份清单与门禁语义），
 * 但调用方不得展示任何安装入口。本块本身没有安装入口；chunk 4 加安装按钮时
 * 必须自己判 `Platform.OS === 'android'`，不要依赖本模块替它把关。
 *
 * 隐私：请求只带 URL 本身，不带网关地址、账号、token、配对凭据或设备标识。
 */

/** 稳定入口：release-latest 分支上的 latest.json（由 chunk 2 的发布流程写入）。 */
export const LATEST_JSON_URL =
  'https://raw.githubusercontent.com/solla-h/dsh-mobile-app/release-latest/latest.json';

/** 自动检查的最小间隔：一天。手动检查不受它约束。 */
export const UPDATE_CHECK_THROTTLE_MS = 24 * 60 * 60 * 1000;

/** 单次请求的超时：慢网络下也必须在用户离开页面前给出结论。 */
const DEFAULT_TIMEOUT_MS = 15_000;

/** 调用方提供的本机信息；versionCode 来自 expo-application 的 nativeBuildVersion。 */
export interface InstalledApp {
  versionCode: number;
  /** App.tsx 的 hello.protocol；未配对时为 undefined。 */
  protocol?: number;
}

export interface CheckOptions {
  /** 注入点：单测替换网络实现。 */
  fetchImpl?: typeof fetch;
  /** 注入点：单测固定时间。 */
  now?: number;
  /** 用户主动点「检查更新」：绕过节流，且不推进自动检查的节奏。 */
  manual?: boolean;
  timeoutMs?: number;
}

/** 缓存快照：节流命中与「失败但手里还有上次结果」都用它。 */
export interface CachedCheck {
  evaluation: UpdateEvaluation;
  checkedAt: number;
}

/**
 * 检查结果。
 *
 * `failed.error` 是语言中立的机器码（`timeout` / `network` / `http-<status>` /
 * `invalid-manifest`），由 UI 侧用 tr() 翻成用户可读文案；这里不产出中文句子，
 * 免得错误路径绕开字典。
 */
export type CheckResult =
  | {
      kind: 'checked';
      evaluation: UpdateEvaluation;
      manifest: LatestManifest;
      checkedAt: number;
    }
  | { kind: 'cached'; evaluation: UpdateEvaluation; checkedAt: number }
  | { kind: 'invalid'; reason: string }
  | { kind: 'failed'; error: string; cached: CachedCheck | null };

/**
 * 读 network 错误：AbortController 触发时各引擎抛的名字略有差异，
 * 统一按超时处理，其它异常归为 `network`。
 */
function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

/**
 * 拉取并评估一次更新。
 *
 * Automatic and manual checks both record the last successful remote check;
 * manual checks still bypass the automatic throttle.
 */
export async function checkForUpdate(
  installed: InstalledApp,
  options: CheckOptions = {},
): Promise<CheckResult> {
  const now = options.now ?? Date.now();

  // 常量是写死的，这里仍然校验：日后改 URL/引入远端来源时不会静默越界。
  if (!isAllowedUpdateUrl(LATEST_JSON_URL)) {
    return { kind: 'invalid', reason: 'bad-url' };
  }

  const state = await loadUpdateState();
  const cached: CachedCheck | null =
    state.cachedManifest === null
      ? null
      : {
          evaluation: evaluateUpdate(installed, state.cachedManifest),
          checkedAt: state.lastCheckAt ?? 0,
        };

  // 节流命中：只对完整的缓存（时间 + 清单）生效；缺一半就当没缓存，直接去拉。
  if (
    !options.manual &&
    state.lastCheckAt !== null &&
    state.cachedManifest !== null &&
    now - state.lastCheckAt < UPDATE_CHECK_THROTTLE_MS &&
    cached !== null
  ) {
    return { kind: 'cached', evaluation: cached.evaluation, checkedAt: cached.checkedAt };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let text: string;
  try {
    const response = await fetchImpl(LATEST_JSON_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { kind: 'failed', error: `http-${response.status}`, cached };
    }
    text = await response.text();
  } catch (error) {
    return { kind: 'failed', error: isAbort(error) ? 'timeout' : 'network', cached };
  } finally {
    clearTimeout(timer);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // 内容损坏（代理劫持、分支被清空）：当作失败，保留旧缓存给 UI 兜底。
    return { kind: 'failed', error: 'invalid-manifest', cached };
  }

  const manifest = parseLatestManifest(raw);
  if (manifest === null) return { kind: 'invalid', reason: 'invalid-manifest' };

  const evaluation = evaluateUpdate(installed, manifest);

  await saveUpdateState({ lastCheckAt: now, cachedManifest: manifest });

  return { kind: 'checked', evaluation, manifest, checkedAt: now };
}

/**
 * 解析 expo-application 的 nativeBuildVersion（string）为 Android versionCode。
 * 空值、非数字、越界一律返回 null：调用方据此跳过检查，而不是拿 NaN 去比较。
 */
export function parseBuildVersion(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
