import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { HostInfoSheet } from '../HostInfoSheet';
import { checkForUpdate } from '../../../update/checker';
import { loadUpdateState } from '../../../storage/update-state';
import type { GatewayClient } from '../../../transport/gateway-client';
import type { LatestManifest } from '../../../update/manifest';

/**
 * 「检查更新」这一行只做三件事：回显当前版本/最近检查时间、触发手动检查、
 * 把结果分派出去（有更新交给 App、其余就地轻提示）。
 * 传输层与 checker 都是注入的假实现，不发网络请求。
 */

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '0.1.0',
  nativeBuildVersion: '5',
}));

jest.mock('../../../update/checker', () => ({
  ...jest.requireActual('../../../update/checker'),
  checkForUpdate: jest.fn(),
}));

jest.mock('../../../storage/update-state', () => ({
  loadUpdateState: jest.fn(async () => ({ lastCheckAt: null, cachedManifest: null })),
}));

jest.mock('../../haptics', () => ({ tapFeedback: jest.fn(), tickFeedback: jest.fn() }));

const checkMock = checkForUpdate as jest.Mock;
const loadStateMock = loadUpdateState as jest.Mock;

const MANIFEST: LatestManifest = {
  version: '0.2.0',
  versionCode: 6,
  tag: 'v0.2.0',
  apkUrl: 'https://github.com/solla-h/dsh-mobile-app/releases/download/v0.2.0/app.apk',
  sha256Url: 'https://github.com/solla-h/dsh-mobile-app/releases/download/v0.2.0/app.apk.sha256',
};

const UPDATED = {
  kind: 'checked' as const,
  manifest: MANIFEST,
  checkedAt: 1_700_000_000_000,
  evaluation: {
    kind: 'update-available' as const,
    manifest: MANIFEST,
    hostBlocked: false,
    blockedReasons: [] as string[],
    weakWarnings: [] as string[],
  },
};

/** HostInfoSheet 只用到 send/onFrame；完整客户端在这里没有意义。 */
const CONTROL = {
  send: jest.fn(),
  onFrame: jest.fn(() => () => undefined),
} as unknown as GatewayClient;

async function renderSheet(overrides: { onUpdateAvailable?: jest.Mock } = {}) {
  const onUpdateAvailable = overrides.onUpdateAvailable ?? jest.fn();
  const onClose = jest.fn();
  await render(
    <HostInfoSheet
      control={CONTROL}
      protocol={3}
      onUpdateAvailable={onUpdateAvailable}
      onClose={onClose}
    />,
  );
  return { onUpdateAvailable, onClose };
}

beforeEach(() => {
  jest.clearAllMocks();
  loadStateMock.mockResolvedValue({ lastCheckAt: null, cachedManifest: null });
});

describe('HostInfoSheet 检查更新行', () => {
  it('回显当前版本与「从未检查」，点按走手动检查并转交新版本', async () => {
    checkMock.mockResolvedValue(UPDATED);
    const { onUpdateAvailable } = await await renderSheet();

    expect(await screen.findByText('当前版本 0.1.0 · 5')).toBeTruthy();
    expect(screen.getByText('从未检查')).toBeTruthy();

    await fireEvent.press(screen.getByText('检查'));

    await waitFor(() => expect(onUpdateAvailable).toHaveBeenCalledTimes(1));
    expect(checkMock).toHaveBeenCalledWith(
      { versionCode: 5, protocol: 3 },
      { manual: true },
    );
    expect(onUpdateAvailable.mock.calls[0][0]).toMatchObject({
      manifest: MANIFEST,
      checkedAt: UPDATED.checkedAt,
    });
  });

  it('有缓存且远端更新时显示「有新版本」角标', async () => {
    loadStateMock.mockResolvedValue({ lastCheckAt: Date.now() - 60_000, cachedManifest: MANIFEST });
    await renderSheet();

    expect(await screen.findByText('有新版本')).toBeTruthy();
    expect(screen.getByText(/最近检查：/)).toBeTruthy();
  });

  it('已是最新时就地提示，不打开弹窗', async () => {
    checkMock.mockResolvedValue({
      kind: 'checked',
      manifest: MANIFEST,
      checkedAt: 1_700_000_000_000,
      evaluation: { kind: 'up-to-date' },
    });
    const { onUpdateAvailable } = await await renderSheet();

    await fireEvent.press(await screen.findByText('检查'));

    expect(await screen.findByText('已是最新版本')).toBeTruthy();
    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });

  it('没有全局弹窗可挂时（非 Android）就地说明发现新版本', async () => {
    checkMock.mockResolvedValue(UPDATED);
    const onClose = jest.fn();
    await render(<HostInfoSheet control={CONTROL} protocol={3} onClose={onClose} />);

    await fireEvent.press(await screen.findByText('检查'));

    expect(await screen.findByText('发现新版本 v0.2.0')).toBeTruthy();
  });

  it('手动检查失败时就地提示原因', async () => {
    checkMock.mockResolvedValue({ kind: 'failed', error: 'timeout', cached: null });
    const { onUpdateAvailable } = await await renderSheet();

    await fireEvent.press(await screen.findByText('检查'));

    expect(await screen.findByText('检查更新超时，请稍后再试')).toBeTruthy();
    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });

  it('检查抛错时就地提示失败，抽屉不崩且可再次检查', async () => {
    checkMock.mockRejectedValue(new Error('boom'));
    const { onUpdateAvailable } = await renderSheet();

    await fireEvent.press(await screen.findByText('检查'));

    expect(await screen.findByText('检查更新失败')).toBeTruthy();
    expect(onUpdateAvailable).not.toHaveBeenCalled();
    // 失败后不卡在「检查中…」，同一行还能再点。
    expect(screen.getByText('检查')).toBeTruthy();

    checkMock.mockResolvedValue({ kind: 'failed', error: 'network', cached: null });
    await fireEvent.press(screen.getByText('检查'));

    expect(await screen.findByText('检查更新失败：网络不可用')).toBeTruthy();
  });
});
