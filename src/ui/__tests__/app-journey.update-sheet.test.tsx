/**
 * issue #12（chunk 3）接线旅程（本机 UI 集成，不是真机 E2E）：
 * 冷启动自动检查 → Android 上全局挂载 UpdateSheet → 「手动下载」打开 Releases tag 页；
 * 回前台再检查一次；iOS 不挂载结果弹窗。
 *
 * 只替换传输层与更新检查器：App / HostInfoSheet / UpdateSheet 跑真实现。
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂受 hoist 限制，只能 require 共享底座 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Linking, Platform } from 'react-native';

import App from '../../../App';
import type { LatestManifest } from '../../update/manifest';
import { resetHarness, setAppLanguage, setTransportScript } from './test-harness';

jest.mock('expo-secure-store', () => require('./test-harness').secureStoreMock());
jest.mock('expo-crypto', () => require('./test-harness').cryptoMock());
jest.mock('expo-audio', () => require('./test-harness').audioMock());
jest.mock('../../transport/gateway-client', () => ({
  GatewayClient: require('./test-harness').FakeGatewayClient,
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-application', () => ({
  nativeApplicationVersion: '0.1.0',
  nativeBuildVersion: '5',
}));
jest.mock('../../update/checker', () => ({
  ...jest.requireActual('../../update/checker'),
  checkForUpdate: jest.fn(),
}));

const { checkForUpdate } = require('../../update/checker') as {
  checkForUpdate: jest.Mock;
};

const MANIFEST: LatestManifest = {
  version: '0.2.0',
  versionCode: 6,
  tag: 'v0.2.0',
  apkUrl: 'https://github.com/solla-h/dsh-mobile-app/releases/download/v0.2.0/app.apk',
  sha256Url: 'https://github.com/solla-h/dsh-mobile-app/releases/download/v0.2.0/app.apk.sha256',
  releaseNotes: { 'zh-CN': '修复若干问题', en: 'Bug fixes' },
};

function updateAvailable(checkedAt: number) {
  return {
    kind: 'checked' as const,
    manifest: MANIFEST,
    checkedAt,
    evaluation: {
      kind: 'update-available' as const,
      manifest: MANIFEST,
      hostBlocked: false,
      blockedReasons: [] as string[],
      weakWarnings: [] as string[],
    },
  };
}

/** jest-expo 默认按 iOS 跑；这里显式切到 Android（自更新只在这一侧）。 */
function forcePlatform(os: 'android' | 'ios'): void {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

beforeEach(async () => {
  resetHarness();
  await setAppLanguage('zh');
  setTransportScript(null);
  forcePlatform('android');
  // AppState 在 RN 的 jest mock 里本来就是 jest.fn；直接重置它的调用记录和实现，
  // 不要用 jest.spyOn + mockRestore（restore 会把实现清成 undefined）。
  const appStateMock = AppState.addEventListener as jest.Mock;
  appStateMock.mockReset();
  appStateMock.mockImplementation(() => ({ remove: jest.fn() }));
  // 只重置 checker 这个模块 mock；jest.clearAllMocks() 会把 AppState 的 spy 实现一起清掉，
  // 让后续测试里 AppState.addEventListener 返回 undefined。
  checkForUpdate.mockReset();
});

afterAll(() => {
  forcePlatform('ios');
});

describe('更新检查接线', () => {
  it('冷启动自动检查有更新时挂载 UpdateSheet，手动下载打开 tag 页', async () => {
    checkForUpdate.mockResolvedValue(updateAvailable(1_700_000_000_000));
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

    await render(<App />);

    expect(await screen.findByText('发现新版本')).toBeTruthy();
    expect(checkForUpdate).toHaveBeenCalledWith({ versionCode: 5, protocol: undefined });

    await fireEvent.press(screen.getByTestId('update-manual-download'));
    expect(openURL).toHaveBeenCalledWith(
      'https://github.com/solla-h/dsh-mobile-app/releases/tag/v0.2.0',
    );

    // 稍后关闭后弹窗消失，用户仍在主界面。
    await fireEvent.press(screen.getByTestId('update-later'));
    await waitFor(() => expect(screen.queryByText('发现新版本')).toBeNull());
    openURL.mockRestore();
  });

  it('回到前台会再检查一次；同一 versionCode 不重复弹窗', async () => {
    checkForUpdate.mockResolvedValue(updateAvailable(1_700_000_000_000));
    await render(<App />);
    expect(await screen.findByText('发现新版本')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('update-later'));
    await waitFor(() => expect(screen.queryByText('发现新版本')).toBeNull());

    // App 的回前台监听器由 AppState.addEventListener 注册，直接取出调用。
    const listeners = (AppState.addEventListener as jest.Mock).mock.calls
      .filter(([event]) => event === 'change')
      .map(([, listener]) => listener);
    expect(listeners.length).toBeGreaterThan(0);

    const before = checkForUpdate.mock.calls.length;
    await act(async () => {
      for (const listener of listeners) listener('active');
    });

    // 回前台确实又查了一次，但同一版本不再打扰用户。
    expect(checkForUpdate.mock.calls.length).toBeGreaterThan(before);
    expect(screen.queryByText('发现新版本')).toBeNull();
  });

  it('自动检查失败保持静默', async () => {
    checkForUpdate.mockResolvedValue({ kind: 'failed', error: 'timeout', cached: null });

    await render(<App />);

    await waitFor(() => expect(checkForUpdate).toHaveBeenCalled());
    expect(screen.queryByText('发现新版本')).toBeNull();
  });

  it('非 Android 不挂载结果弹窗（本块无安装入口）', async () => {
    forcePlatform('ios');
    checkForUpdate.mockResolvedValue(updateAvailable(1_700_000_000_000));

    await render(<App />);

    await waitFor(() => expect(checkForUpdate).toHaveBeenCalled());
    expect(screen.queryByText('发现新版本')).toBeNull();
  });
});
