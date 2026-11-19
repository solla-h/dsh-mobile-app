import type { File } from 'expo-file-system';

import {
  apkFileNameFromUrl,
  downloadAndVerify,
  downloadApk,
  fetchExpectedHash,
  installApk,
  parseSha256Sums,
  verifySha256,
} from '../installer';
import type { LatestManifest } from '../manifest';

jest.mock('expo-file-system', () => {
  const createDownloadTask = jest.fn();
  const MockFile = jest.fn();
  Object.assign(MockFile, { createDownloadTask });
  return {
    Paths: { cache: 'file:///cache' },
    File: MockFile,
    Directory: jest.fn(),
  };
});

jest.mock('expo-intent-launcher', () => ({
  ActivityAction: { MANAGE_UNKNOWN_APP_SOURCES: 'android.settings.MANAGE_UNKNOWN_APP_SOURCES' },
  startActivityAsync: jest.fn(),
}));

jest.mock('expo-application', () => ({ applicationId: 'test.package' }));

interface FileSystemMock {
  Paths: { cache: string };
  Directory: jest.Mock;
  File: jest.Mock & { createDownloadTask: jest.Mock };
}

interface LauncherMock {
  ActivityAction: { MANAGE_UNKNOWN_APP_SOURCES: string };
  startActivityAsync: jest.Mock;
}

const fsMock = jest.requireMock('expo-file-system') as FileSystemMock;
const launcherMock = jest.requireMock('expo-intent-launcher') as LauncherMock;

const HASH = 'a'.repeat(64);
const UPPER_HASH = 'A'.repeat(64);
const APK_NAME = 'dsh-mobile-v0.2.0.apk';
const APK_URL = `https://github.com/solla-h/dsh-mobile-app/releases/download/v0.2.0/${APK_NAME}`;
const SHA_URL =
  'https://github.com/solla-h/dsh-mobile-app/releases/download/v0.2.0/SHA256SUMS';
const CONTENT_URI = 'content://test.package/fileprovider/app.apk';

const MANIFEST: LatestManifest = {
  version: '0.2.0',
  versionCode: 6,
  tag: 'v0.2.0',
  apkUrl: APK_URL,
  sha256Url: SHA_URL,
};

interface FakeFile {
  exists: boolean;
  contentUri: string;
  delete: jest.Mock;
  digest: jest.Mock;
}

/** 只实现编排用到的成员；真实 File 的其余属性与这些测试无关。 */
function fakeCachedFile(overrides: Partial<FakeFile> = {}): FakeFile {
  return {
    exists: false,
    contentUri: CONTENT_URI,
    delete: jest.fn(),
    digest: jest.fn(async () => HASH),
    ...overrides,
  };
}

/** 只实现 verifySha256 用到的 digest。 */
function fileWithDigest(digest: (algorithm: string) => Promise<string>): File {
  return { digest } as unknown as File;
}

interface TaskOptions {
  onProgress?: (data: { bytesWritten: number; totalBytes: number }) => void;
  signal?: AbortSignal;
}

let destination: FakeFile;
const fetchMock = jest.fn();
const originalFetch = globalThis.fetch;

/**
 * 把 File.createDownloadTask 换成给定实现；downloadAsync 调用时把创建任务时
 * 传入的 options 交给测试，用于触发 onProgress / 读取 signal。
 */
function setUpDownload(impl: (options: TaskOptions) => Promise<File>) {
  const task = {
    downloadAsync: jest.fn(async () => {
      const call = fsMock.File.createDownloadTask.mock.calls[0];
      return impl((call?.[2] ?? {}) as TaskOptions);
    }),
    release: jest.fn(),
  };
  fsMock.File.createDownloadTask.mockReturnValue(task);
  return task;
}

/** 只实现 fetch 用到的 ok/status/text；Response 的其余成员与本模块无关。 */
function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  destination = fakeCachedFile();
  fsMock.File.mockImplementation(() => destination);
  fsMock.Directory.mockImplementation(() => ({ exists: false, create: jest.fn() }));
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('parseSha256Sums', () => {
  test('文本模式：两个空格分隔', () => {
    const text = `deadbeef\n${HASH}  ${APK_NAME}\n`;
    expect(parseSha256Sums(text, APK_NAME)).toBe(HASH);
  });

  test('二进制模式：星号分隔', () => {
    const text = `${HASH} *${APK_NAME}\n`;
    expect(parseSha256Sums(text, APK_NAME)).toBe(HASH);
  });

  test('返回文件里写的原始大小写', () => {
    expect(parseSha256Sums(`${UPPER_HASH}  ${APK_NAME}\n`, APK_NAME)).toBe(UPPER_HASH);
  });

  test('兼容 CRLF 行尾', () => {
    const text = `${HASH}  other.apk\r\n${HASH}  ${APK_NAME}\r\n`;
    expect(parseSha256Sums(text, APK_NAME)).toBe(HASH);
  });

  test('文件名带空格时按整行匹配', () => {
    const text = `${HASH}  dsh mobile v1.apk\n`;
    expect(parseSha256Sums(text, 'dsh mobile v1.apk')).toBe(HASH);
  });

  test('文件名缺失时返回 null', () => {
    expect(parseSha256Sums(`${HASH}  other.apk\n`, APK_NAME)).toBeNull();
  });

  test('目标行的摘要长度不对时返回 null', () => {
    const shortHash = 'a'.repeat(63);
    expect(parseSha256Sums(`${shortHash}  ${APK_NAME}\n`, APK_NAME)).toBeNull();
    expect(parseSha256Sums(`${HASH}b  ${APK_NAME}\n`, APK_NAME)).toBeNull();
  });

  test('目标行的摘要含非十六进制字符时返回 null', () => {
    const badHash = `${'g'.repeat(63)}a`;
    expect(parseSha256Sums(`${badHash}  ${APK_NAME}\n`, APK_NAME)).toBeNull();
  });

  test('缺少分隔符或只有一个空格时返回 null', () => {
    expect(parseSha256Sums(`${HASH}${APK_NAME}\n`, APK_NAME)).toBeNull();
    expect(parseSha256Sums(`${HASH} ${APK_NAME}\n`, APK_NAME)).toBeNull();
  });

  test('跳过不相关的坏行，仍能命中有效行', () => {
    const text = `not a checksum line\n${HASH}  ${APK_NAME}\n`;
    expect(parseSha256Sums(text, APK_NAME)).toBe(HASH);
  });

  test('文件名只做整段比较，不匹配前缀相同的文件', () => {
    expect(parseSha256Sums(`${HASH}  other-${APK_NAME}\n`, APK_NAME)).toBeNull();
  });

  test('空内容或空文件名返回 null', () => {
    expect(parseSha256Sums('', APK_NAME)).toBeNull();
    expect(parseSha256Sums(`${HASH}  ${APK_NAME}\n`, '')).toBeNull();
  });
});

describe('apkFileNameFromUrl', () => {
  test('取 https URL 的最后一段路径', () => {
    expect(
      apkFileNameFromUrl(`https://github.com/owner/repo/releases/download/v0.2.0/${APK_NAME}`),
    ).toBe(APK_NAME);
  });

  test('忽略查询串与片段', () => {
    expect(apkFileNameFromUrl(`https://github.com/owner/repo/${APK_NAME}?download=1#sha`)).toBe(
      APK_NAME,
    );
  });

  test('结尾斜杠、根路径与空路径返回 null', () => {
    expect(apkFileNameFromUrl('https://github.com/owner/repo/')).toBeNull();
    expect(apkFileNameFromUrl('https://github.com')).toBeNull();
    expect(apkFileNameFromUrl('https://github.com/')).toBeNull();
  });

  test('非 https 或非法 URL 返回 null', () => {
    expect(apkFileNameFromUrl('http://github.com/owner/repo/app.apk')).toBeNull();
    expect(apkFileNameFromUrl('ftp://github.com/owner/repo/app.apk')).toBeNull();
    expect(apkFileNameFromUrl('file:///tmp/app.apk')).toBeNull();
    expect(apkFileNameFromUrl('not a url')).toBeNull();
    expect(apkFileNameFromUrl('')).toBeNull();
  });
});

describe('verifySha256', () => {
  test('摘要一致（大小写不敏感）', async () => {
    const digest = jest.fn(async () => HASH);
    await expect(verifySha256(fileWithDigest(digest), HASH)).resolves.toBe(true);
    await expect(verifySha256(fileWithDigest(digest), UPPER_HASH)).resolves.toBe(true);
    expect(digest).toHaveBeenCalledWith('SHA-256');
  });

  test('摘要不一致返回 false', async () => {
    const file = fileWithDigest(async () => 'b'.repeat(64));
    await expect(verifySha256(file, HASH)).resolves.toBe(false);
  });

  test('期望值不是 64 位十六进制时不读文件', async () => {
    const digest = jest.fn(async () => HASH);
    await expect(verifySha256(fileWithDigest(digest), 'a'.repeat(63))).resolves.toBe(false);
    await expect(verifySha256(fileWithDigest(digest), '')).resolves.toBe(false);
    expect(digest).not.toHaveBeenCalled();
  });

  test('读取摘要失败时返回 false，不抛异常', async () => {
    const file = fileWithDigest(async () => {
      throw new Error('missing file');
    });
    await expect(verifySha256(file, HASH)).resolves.toBe(false);
  });
});

describe('downloadApk', () => {
  test('非 https 或非白名单 URL 在发起下载前拒绝', async () => {
    await expect(downloadApk('http://github.com/owner/repo/app.apk', jest.fn())).rejects.toThrow(
      'invalid-apk-url',
    );
    await expect(downloadApk('https://evil.example/app.apk', jest.fn())).rejects.toThrow(
      'invalid-apk-url',
    );

    expect(fsMock.File.createDownloadTask).not.toHaveBeenCalled();
    expect(fsMock.Directory).not.toHaveBeenCalled();
  });

  test('下载到私有缓存并回调 0..1 进度', async () => {
    const progress = jest.fn();
    const task = setUpDownload(async (options) => {
      options.onProgress?.({ bytesWritten: 25, totalBytes: 100 });
      options.onProgress?.({ bytesWritten: 100, totalBytes: 100 });
      // 服务端没给 Content-Length：跳过，不能算出负进度。
      options.onProgress?.({ bytesWritten: 1, totalBytes: -1 });
      destination.exists = true;
      return destination as unknown as File;
    });

    const result = await downloadApk(APK_URL, progress);

    expect(fsMock.Directory).toHaveBeenCalledWith('file:///cache', 'dsh-updates');
    const directory = fsMock.Directory.mock.results[0]?.value as { create: jest.Mock };
    expect(directory.create).toHaveBeenCalledWith({ intermediates: true });
    expect(fsMock.File).toHaveBeenCalledWith(directory, APK_NAME);
    expect(fsMock.File.createDownloadTask).toHaveBeenCalledWith(
      APK_URL,
      destination,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(progress.mock.calls.map(([value]) => value)).toEqual([0.25, 1]);
    expect(result).toBe(destination);
    expect(destination.delete).not.toHaveBeenCalled();
    expect(task.release).toHaveBeenCalled();
  });

  test('取消会中断下载、清理半成品并释放任务', async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const task = setUpDownload(async (options) => {
      seenSignal = options.signal;
      destination.exists = true;
      controller.abort();
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });

    await expect(downloadApk(APK_URL, jest.fn(), controller.signal)).rejects.toThrow('aborted');

    expect(seenSignal).toBe(controller.signal);
    expect(controller.signal.aborted).toBe(true);
    expect(destination.delete).toHaveBeenCalledTimes(1);
    expect(task.release).toHaveBeenCalled();
  });

  test('下载失败时删除半成品', async () => {
    setUpDownload(async () => {
      destination.exists = true;
      throw new Error('network');
    });

    await expect(downloadApk(APK_URL, jest.fn())).rejects.toThrow('network');

    expect(destination.delete).toHaveBeenCalledTimes(1);
  });
});

describe('fetchExpectedHash', () => {
  test('从 SHA256SUMS 取出目标文件的摘要并传递取消信号', async () => {
    fetchMock.mockResolvedValue(textResponse(`${HASH}  ${APK_NAME}\n`));
    const controller = new AbortController();

    await expect(fetchExpectedHash(SHA_URL, APK_NAME, controller.signal)).resolves.toBe(HASH);
    expect(fetchMock).toHaveBeenCalledWith(SHA_URL, { method: 'GET', signal: expect.any(AbortSignal) });
  });

  test('SHA256SUMS 请求超时会 abort fetch 并抛出网络错误', async () => {
    jest.useFakeTimers();
    let seenSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, options: { signal: AbortSignal }) => {
      seenSignal = options.signal;
      const { promise, reject } = Promise.withResolvers<Response>();
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      return promise;
    });

    const request = fetchExpectedHash(SHA_URL, APK_NAME);
    const rejection = expect(request).rejects.toThrow('aborted');
    await jest.advanceTimersByTimeAsync(15_000);
    expect(seenSignal?.aborted).toBe(true);
    await rejection;
    jest.useRealTimers();
  });

  test('用户取消会 abort SHA256SUMS 请求', async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, options: { signal: AbortSignal }) => {
      seenSignal = options.signal;
      const { promise, reject } = Promise.withResolvers<Response>();
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      return promise;
    });

    const request = fetchExpectedHash(SHA_URL, APK_NAME, controller.signal);
    const rejection = expect(request).rejects.toThrow('aborted');
    controller.abort();
    expect(seenSignal?.aborted).toBe(true);
    await rejection;
  });

  test('非白名单 URL 不发请求', async () => {
    await expect(fetchExpectedHash('http://github.com/SHA256SUMS', APK_NAME)).resolves.toBeNull();
    await expect(fetchExpectedHash('https://evil.example/SHA256SUMS', APK_NAME)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('网络失败或非 2xx 抛出，只有摘要缺失返回 null', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchExpectedHash(SHA_URL, APK_NAME)).rejects.toThrow('offline');

    fetchMock.mockResolvedValueOnce(textResponse('unavailable', 503));
    await expect(fetchExpectedHash(SHA_URL, APK_NAME)).rejects.toThrow('hash-fetch-failed');

    fetchMock.mockResolvedValueOnce(textResponse(`${HASH}  other.apk\n`));
    await expect(fetchExpectedHash(SHA_URL, APK_NAME)).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(textResponse('garbage'));
    await expect(fetchExpectedHash(SHA_URL, APK_NAME)).resolves.toBeNull();
  });
});

describe('downloadAndVerify', () => {
  test('APK 或校验和 URL 不在白名单时返回 url，且不下载、不请求', async () => {
    await expect(
      downloadAndVerify({ ...MANIFEST, apkUrl: 'http://github.com/owner/app.apk' }, jest.fn()),
    ).resolves.toEqual({ error: 'url' });
    await expect(
      downloadAndVerify({ ...MANIFEST, sha256Url: 'https://evil.example/SHA256SUMS' }, jest.fn()),
    ).resolves.toEqual({ error: 'url' });

    expect(fsMock.File.createDownloadTask).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('下载与摘要都通过时返回文件', async () => {
    setUpDownload(async () => {
      destination.exists = true;
      return destination as unknown as File;
    });
    fetchMock.mockResolvedValue(textResponse(`${HASH}  ${APK_NAME}\n`));

    await expect(downloadAndVerify(MANIFEST, jest.fn())).resolves.toEqual({ file: destination });

    expect(destination.digest).toHaveBeenCalledWith('SHA-256');
    expect(destination.delete).not.toHaveBeenCalled();
  });

  test('摘要不匹配时删除文件并返回 checksum', async () => {
    destination.digest.mockResolvedValue('b'.repeat(64));
    setUpDownload(async () => {
      destination.exists = true;
      return destination as unknown as File;
    });
    fetchMock.mockResolvedValue(textResponse(`${HASH}  ${APK_NAME}\n`));

    await expect(downloadAndVerify(MANIFEST, jest.fn())).resolves.toEqual({ error: 'checksum' });

    expect(destination.delete).toHaveBeenCalledTimes(1);
  });

  test('SHA256SUMS network failure is download while a missing digest remains checksum', async () => {
    setUpDownload(async () => {
      destination.exists = true;
      return destination as unknown as File;
    });
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await expect(downloadAndVerify(MANIFEST, jest.fn())).resolves.toEqual({ error: 'download' });
    expect(destination.delete).toHaveBeenCalledTimes(1);

    destination.delete.mockClear();
    destination.exists = false;
    fetchMock.mockResolvedValueOnce(textResponse(`${HASH}  other.apk\n`));
    await expect(downloadAndVerify(MANIFEST, jest.fn())).resolves.toEqual({ error: 'checksum' });
    expect(destination.delete).toHaveBeenCalledTimes(1);
  });

  test('aborting during hash verification deletes the downloaded APK', async () => {
    setUpDownload(async () => {
      destination.exists = true;
      return destination as unknown as File;
    });
    const controller = new AbortController();
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => {
        controller.abort();
        return `${HASH}  ${APK_NAME}\n`;
      },
    } as Response);

    await expect(downloadAndVerify(MANIFEST, jest.fn(), controller.signal)).resolves.toEqual({ error: 'download' });
    expect(destination.digest).not.toHaveBeenCalled();
    expect(destination.delete).toHaveBeenCalledTimes(1);
  });

  test('下载失败时返回 download 并清理半成品', async () => {
    setUpDownload(async () => {
      destination.exists = true;
      throw new Error('network');
    });

    await expect(downloadAndVerify(MANIFEST, jest.fn())).resolves.toEqual({ error: 'download' });

    expect(destination.delete).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('installApk', () => {
  test('ACTION_VIEW 拉起成功返回 launched', async () => {
    launcherMock.startActivityAsync.mockResolvedValue({ resultCode: -1 });

    await expect(installApk(destination as unknown as File)).resolves.toBe('launched');

    expect(launcherMock.startActivityAsync).toHaveBeenCalledWith('android.intent.action.VIEW', {
      data: CONTENT_URI,
      type: 'application/vnd.android.package-archive',
      flags: 1,
    });
  });

  test('ACTION_VIEW 失败时打开未知来源设置并返回 needs-unknown-sources', async () => {
    launcherMock.startActivityAsync
      .mockRejectedValueOnce(new Error('ActivityNotFoundException'))
      .mockResolvedValueOnce({ resultCode: -1 });

    await expect(installApk(destination as unknown as File)).resolves.toBe(
      'needs-unknown-sources',
    );

    expect(launcherMock.startActivityAsync).toHaveBeenNthCalledWith(
      2,
      'android.settings.MANAGE_UNKNOWN_APP_SOURCES',
      { data: 'package:test.package' },
    );
  });

  test('安装器与设置页都失败时返回 failed，不抛异常', async () => {
    launcherMock.startActivityAsync
      .mockRejectedValueOnce(new Error('ActivityNotFoundException'))
      .mockRejectedValueOnce(new Error('SettingsNotFoundException'));

    await expect(installApk(destination as unknown as File)).resolves.toBe('failed');
  });

  test('没有 contentUri 时直接返回 failed，不拉起任何 Activity', async () => {
    destination.contentUri = '';

    await expect(installApk(destination as unknown as File)).resolves.toBe('failed');

    expect(launcherMock.startActivityAsync).not.toHaveBeenCalled();
  });

  test('读取 contentUri 抛错时返回 failed，不抛给 UI', async () => {
    const missing = fakeCachedFile();
    Object.defineProperty(missing, 'contentUri', {
      get() {
        throw new Error('missing file');
      },
    });

    await expect(installApk(missing as unknown as File)).resolves.toBe('failed');

    expect(launcherMock.startActivityAsync).not.toHaveBeenCalled();
  });
});
