/**
 * 更新检查的两个字段共用同一个落盘对象（update-state.json）。
 * 成功检查写入 lastCheckAt + cachedManifest，写操作必须读-合并-写，
 * 整对象覆盖会让另一侧的状态悄悄消失。
 */
import { clearUpdateState, loadUpdateState, saveUpdateState } from '../update-state';
import { readJson, removeJson, writeJson } from '../persisted-state';
import type { LatestManifest } from '../../update/manifest';

jest.mock('../persisted-state', () => ({
  readJson: jest.fn(),
  writeJson: jest.fn(async () => undefined),
  removeJson: jest.fn(async () => undefined),
}));

const readMock = readJson as jest.Mock;
const writeMock = writeJson as jest.Mock;
const removeMock = removeJson as jest.Mock;

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

beforeEach(() => {
  jest.clearAllMocks();
  readMock.mockResolvedValue(null);
});

describe('saveUpdateState 读-合并-写', () => {
  it('写 lastCheckAt 时保留已有 cachedManifest', async () => {
    readMock.mockResolvedValue({ lastCheckAt: NOW - 1000, cachedManifest: MANIFEST });

    await saveUpdateState({ lastCheckAt: NOW });

    expect(writeMock).toHaveBeenCalledWith('update-state', {
      lastCheckAt: NOW,
      cachedManifest: MANIFEST,
    });
  });

  it('写 cachedManifest 时保留已有 lastCheckAt', async () => {
    readMock.mockResolvedValue({ lastCheckAt: NOW, cachedManifest: null });

    await saveUpdateState({ cachedManifest: MANIFEST });

    expect(writeMock).toHaveBeenCalledWith('update-state', {
      lastCheckAt: NOW,
      cachedManifest: MANIFEST,
    });
  });

  it('没有旧状态时补齐默认字段，不写 undefined', async () => {
    readMock.mockResolvedValue(null);

    await saveUpdateState({ lastCheckAt: NOW });

    expect(writeMock).toHaveBeenCalledWith('update-state', {
      lastCheckAt: NOW,
      cachedManifest: null,
    });
  });

  it('旧文件损坏时也不丢新写入的字段', async () => {
    readMock.mockResolvedValue(undefined);

    await saveUpdateState({ cachedManifest: MANIFEST });

    expect(writeMock).toHaveBeenCalledWith('update-state', {
      lastCheckAt: null,
      cachedManifest: MANIFEST,
    });
  });
});

describe('loadUpdateState', () => {
  it('cachedManifest 存取往返一致', async () => {
    await saveUpdateState({ lastCheckAt: NOW, cachedManifest: MANIFEST });
    const [, written] = writeMock.mock.calls[0] as [string, unknown];

    // 用落盘内容回灌读接口，验证解析后仍是同一份清单。
    readMock.mockResolvedValue(written);
    const loaded = await loadUpdateState();

    expect(loaded.lastCheckAt).toBe(NOW);
    expect(loaded.cachedManifest).toEqual(MANIFEST);
  });

  it('文件缺失或读取失败时返回全空状态，不抛异常', async () => {
    readMock.mockResolvedValueOnce(null);
    await expect(loadUpdateState()).resolves.toEqual({
      lastCheckAt: null,
      cachedManifest: null,
    });

    readMock.mockRejectedValueOnce(new Error('disk gone'));
    await expect(loadUpdateState()).resolves.toEqual({
      lastCheckAt: null,
      cachedManifest: null,
    });
  });

  it('字段各自校验：坏时间戳退回 null，坏清单当作没有缓存', async () => {
    readMock.mockResolvedValue({
      lastCheckAt: 'yesterday',
      cachedManifest: { version: '0.2.0' },
    });

    const loaded = await loadUpdateState();

    expect(loaded.lastCheckAt).toBeNull();
    expect(loaded.cachedManifest).toBeNull();
  });

  it('坏字段不影响另一个字段', async () => {
    readMock.mockResolvedValue({ lastCheckAt: 0, cachedManifest: MANIFEST });

    const loaded = await loadUpdateState();

    expect(loaded.lastCheckAt).toBeNull();
    expect(loaded.cachedManifest).toEqual(MANIFEST);
  });
});

describe('clearUpdateState', () => {
  it('删除落盘文件，不写空对象', async () => {
    await clearUpdateState();

    expect(removeMock).toHaveBeenCalledWith('update-state');
    expect(writeMock).not.toHaveBeenCalled();
  });
});

describe('落盘失败', () => {
  it('写失败不抛到调用方（下次检查重试）', async () => {
    writeMock.mockRejectedValueOnce(new Error('read-only volume'));

    await expect(saveUpdateState({ lastCheckAt: NOW })).resolves.toBeUndefined();
  });

  it('删除失败同样静默', async () => {
    removeMock.mockRejectedValueOnce(new Error('busy'));

    await expect(clearUpdateState()).resolves.toBeUndefined();
  });
});
