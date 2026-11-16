import {
  checkForUpdate,
  LATEST_JSON_URL,
  parseBuildVersion,
  UPDATE_CHECK_THROTTLE_MS,
} from '../checker';
import type { LatestManifest } from '../manifest';
import { loadUpdateState, saveUpdateState } from '../../storage/update-state';
import type { UpdateState } from '../../storage/update-state';

jest.mock('../../storage/update-state', () => ({
  loadUpdateState: jest.fn(),
  saveUpdateState: jest.fn(async () => undefined),
  clearUpdateState: jest.fn(async () => undefined),
}));

const loadMock = loadUpdateState as jest.Mock<Promise<UpdateState>, []>;
const saveMock = saveUpdateState as jest.Mock<Promise<void>, [Partial<UpdateState>]>;

const NOW = 1_700_000_000_000;

const MANIFEST: LatestManifest = {
  version: '0.2.0',
  versionCode: 6,
  tag: 'v0.2.0',
  apkUrl: 'https://github.com/solla-h/dsh-mobile-app/releases/download/v0.2.0/app.apk',
  sha256Url: 'https://github.com/solla-h/dsh-mobile-app/releases/download/v0.2.0/app.apk.sha256',
  releaseNotes: { 'zh-CN': '修复若干问题', en: 'Bug fixes' },
  required: { protocol: 3 },
};

const EMPTY: UpdateState = { lastCheckAt: null, cachedManifest: null };

/** 只实现 checker 用到的 ok/status/text；Response 的其余成员与本模块无关。 */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

const INSTALLED = { versionCode: 5, protocol: 3 };

beforeEach(() => {
  jest.clearAllMocks();
  loadMock.mockResolvedValue(EMPTY);
});

describe('URL 门禁与节流', () => {
  it('常量使用 release-latest 上的 latest.json', () => {
    expect(LATEST_JSON_URL).toBe(
      'https://raw.githubusercontent.com/solla-h/dsh-mobile-app/release-latest/latest.json',
    );
    expect(UPDATE_CHECK_THROTTLE_MS).toBe(86_400_000);
  });

  it('节流内直接回缓存，不发网络请求', async () => {
    loadMock.mockResolvedValue({
      lastCheckAt: NOW - 60_000,
      cachedManifest: MANIFEST,
    });
    const fetchImpl = jest.fn();

    const result = await checkForUpdate(INSTALLED, { fetchImpl, now: NOW });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.kind).toBe('cached');
    if (result.kind !== 'cached') throw new Error('expected cached');
    expect(result.checkedAt).toBe(NOW - 60_000);
    expect(result.evaluation.kind).toBe('update-available');
  });

  it('手动检查绕过节流并实际发起请求', async () => {
    loadMock.mockResolvedValue({ lastCheckAt: NOW - 60_000, cachedManifest: MANIFEST });
    const fetchImpl = jest.fn(async () => jsonResponse(MANIFEST));

    const result = await checkForUpdate(INSTALLED, { fetchImpl, now: NOW, manual: true });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('checked');
  });

  it('节流窗口已过就重新请求', async () => {
    loadMock.mockResolvedValue({ lastCheckAt: NOW - UPDATE_CHECK_THROTTLE_MS - 1, cachedManifest: MANIFEST });
    const fetchImpl = jest.fn(async () => jsonResponse(MANIFEST));

    const result = await checkForUpdate(INSTALLED, { fetchImpl, now: NOW });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('checked');
  });

  it('只有清单没有时间戳时不当作缓存，直接请求', async () => {
    loadMock.mockResolvedValue({ lastCheckAt: null, cachedManifest: MANIFEST });
    const fetchImpl = jest.fn(async () => jsonResponse(MANIFEST));

    const result = await checkForUpdate(INSTALLED, { fetchImpl, now: NOW });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('checked');
  });
});

describe('网络与内容失败', () => {
  it('超时返回 failed/timeout，不抛异常', async () => {
    // 永不返回的请求，只在 abort 时 reject —— 模拟卡住的网络。
    const fetchImpl = jest.fn((_url: string, init?: RequestInit) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
      return promise;
    }) as unknown as typeof fetch;

    const result = await checkForUpdate(INSTALLED, { fetchImpl, now: NOW, timeoutMs: 10 });

    expect(result).toMatchObject({ kind: 'failed', error: 'timeout', cached: null });
  });

  it('网络错误返回 failed/network', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });

    const result = await checkForUpdate(INSTALLED, { fetchImpl, now: NOW });

    expect(result).toMatchObject({ kind: 'failed', error: 'network', cached: null });
  });

  it('非 200 返回 failed/http-<status>，并带回旧缓存', async () => {
    loadMock.mockResolvedValue({ lastCheckAt: NOW - 2 * UPDATE_CHECK_THROTTLE_MS, cachedManifest: MANIFEST });
    const fetchImpl = jest.fn(async () => jsonResponse('not found', 404));

    const result = await checkForUpdate(INSTALLED, { fetchImpl, now: NOW });

    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') throw new Error('expected failed');
    expect(result.error).toBe('http-404');
    expect(result.cached?.checkedAt).toBe(NOW - 2 * UPDATE_CHECK_THROTTLE_MS);
    expect(result.cached?.evaluation.kind).toBe('update-available');
  });

  it('非法 JSON 返回 failed/invalid-manifest', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse('{not json'));

    const result = await checkForUpdate(INSTALLED, { fetchImpl, now: NOW });

    expect(result).toMatchObject({ kind: 'failed', error: 'invalid-manifest' });
  });

  it('结构不合法（parseLatestManifest 返回 null）时为 invalid', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ version: '0.2.0' }));

    const result = await checkForUpdate(INSTALLED, { fetchImpl, now: NOW });

    expect(result).toEqual({ kind: 'invalid', reason: 'invalid-manifest' });
    expect(saveMock).not.toHaveBeenCalled();
  });
});

describe('判定透传', () => {
  it('up-to-date：远端 versionCode 不大于本机', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ ...MANIFEST, versionCode: 5 }));

    const result = await checkForUpdate({ versionCode: 5 }, { fetchImpl, now: NOW });

    expect(result.kind).toBe('checked');
    if (result.kind !== 'checked') throw new Error('expected checked');
    expect(result.evaluation).toEqual({ kind: 'up-to-date' });
    expect(result.checkedAt).toBe(NOW);
  });

  it('update-available：带弱警告与清单本体', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(MANIFEST));

    const result = await checkForUpdate(INSTALLED, { fetchImpl, now: NOW });

    expect(result.kind).toBe('checked');
    if (result.kind !== 'checked') throw new Error('expected checked');
    expect(result.manifest).toEqual(MANIFEST);
    expect(result.evaluation).toMatchObject({
      kind: 'update-available',
      hostBlocked: false,
    });
  });

  it('hostBlocked：required.protocol 高于 hello.protocol', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ ...MANIFEST, required: { protocol: 4 } }));

    const result = await checkForUpdate({ versionCode: 5, protocol: 3 }, { fetchImpl, now: NOW });

    expect(result.kind).toBe('checked');
    if (result.kind !== 'checked' || result.evaluation.kind !== 'update-available') {
      throw new Error('expected update-available');
    }
    expect(result.evaluation.hostBlocked).toBe(true);
    expect(result.evaluation.blockedReasons).toContain('protocol');
  });
});

describe('缓存写入节奏', () => {
  it('自动检查成功才更新 lastCheckAt 与 cachedManifest', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(MANIFEST));

    await checkForUpdate(INSTALLED, { fetchImpl, now: NOW });

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith({ lastCheckAt: NOW, cachedManifest: MANIFEST });
  });

  it('手动检查成功只写 cachedManifest，不推进自动检查节奏', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(MANIFEST));

    await checkForUpdate(INSTALLED, { fetchImpl, now: NOW, manual: true });

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith({ cachedManifest: MANIFEST });
  });

  it('自动检查失败不写缓存', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse('oops', 500));

    await checkForUpdate(INSTALLED, { fetchImpl, now: NOW });

    expect(saveMock).not.toHaveBeenCalled();
  });

  it('请求只带 URL 与 accept 头，不带任何凭据', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(MANIFEST));

    await checkForUpdate(INSTALLED, { fetchImpl, now: NOW });

    expect(fetchImpl).toHaveBeenCalledWith(
      LATEST_JSON_URL,
      expect.objectContaining({ method: 'GET', headers: { accept: 'application/json' } }),
    );
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(JSON.stringify(init.headers)).not.toMatch(/token|authorization|pairing/i);
  });
});

describe('parseBuildVersion', () => {
  it('读取 nativeBuildVersion，非数字或缺席时为 null', () => {
    expect(parseBuildVersion('5')).toBe(5);
    expect(parseBuildVersion('')).toBeNull();
    expect(parseBuildVersion(null)).toBeNull();
    expect(parseBuildVersion(undefined)).toBeNull();
    expect(parseBuildVersion('0.1.0')).toBeNull();
    expect(parseBuildVersion('0')).toBeNull();
  });
});
