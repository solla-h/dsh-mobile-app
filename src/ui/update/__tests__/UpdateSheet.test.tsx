import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { UpdateSheet } from '../UpdateSheet';
import { tr } from '../../../i18n';
import { downloadAndVerify, installApk } from '../../../update/installer';
import type { LatestManifest, UpdateEvaluation } from '../../../update/manifest';

jest.mock('../../../update/installer', () => ({
  downloadAndVerify: jest.fn(),
  installApk: jest.fn(),
}));

const downloadMock = downloadAndVerify as jest.Mock;
const installMock = installApk as jest.Mock;

/**
 * 更新弹窗：检查结果 + Android 下载/安装状态机。
 * 安装器、下载器整体替换成脚本化 mock；真实下载校验由 installer 的单测覆盖。
 */

const MANIFEST: LatestManifest = {
  version: '0.2.0',
  versionCode: 6,
  tag: 'v0.2.0',
  apkUrl: 'https://github.com/solla-h/dsh-mobile-app/releases/download/v0.2.0/app.apk',
  sha256Url: 'https://github.com/solla-h/dsh-mobile-app/releases/download/v0.2.0/app.apk.sha256',
  releaseNotes: { 'zh-CN': '修复若干问题', en: 'Bug fixes' },
};

const FILE = { uri: 'file:///cache/dsh-updates/app.apk' } as unknown as File;

function available(overrides: Partial<Extract<UpdateEvaluation, { kind: 'update-available' }>>) {
  return {
    kind: 'update-available' as const,
    manifest: MANIFEST,
    hostBlocked: false,
    blockedReasons: [] as string[],
    weakWarnings: [] as string[],
    ...overrides,
  };
}

const NOOP = () => undefined;

/** jest-expo 默认按 iOS 跑；这里显式切平台，安装入口只在 Android 出现。 */
function forcePlatform(os: 'android' | 'ios'): void {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

beforeEach(() => {
  forcePlatform('android');
  downloadMock.mockReset();
  installMock.mockReset();
  installMock.mockResolvedValue('launched');
});

afterAll(() => {
  forcePlatform('ios');
});

describe('UpdateSheet 检查结果', () => {
  it('展示远端版本、tag 与发布说明；Android 上有「下载并安装」和两个出口', async () => {
    const onClose = jest.fn();
    const onManualDownload = jest.fn();
    await render(
      <UpdateSheet
        visible
        manifest={MANIFEST}
        evaluation={available({})}
        checkedAt={Date.now()}
        onClose={onClose}
        onManualDownload={onManualDownload}
      />,
    );

    expect(screen.getByText('0.2.0')).toBeTruthy();
    expect(screen.getByText('v0.2.0')).toBeTruthy();
    expect(screen.getByText('修复若干问题')).toBeTruthy();
    // 检查时间与相对时间同一行渲染（「最近检查：刚刚」）。
    expect(screen.getByText(/最近检查：/)).toBeTruthy();
    expect(screen.getByTestId('update-install')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('update-later'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onManualDownload).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('update-manual-download'));
    expect(onManualDownload).toHaveBeenCalledTimes(1);
  });

  it('hostBlocked 时给出强阻断提示，不显示下载并安装', async () => {
    const onClose = jest.fn();
    await render(
      <UpdateSheet
        visible
        manifest={MANIFEST}
        evaluation={available({ hostBlocked: true, blockedReasons: ['protocol'] })}
        onClose={onClose}
        onManualDownload={NOOP}
      />,
    );

    expect(screen.getByText(tr("请先更新宿主网关再升级 App"))).toBeTruthy();
    expect(screen.queryByTestId('update-install')).toBeNull();
    await fireEvent.press(screen.getByTestId('update-later'));
    expect(onClose).toHaveBeenCalled();
  });

  it('非 Android 不显示下载并安装，只保留手动下载', async () => {
    forcePlatform('ios');
    await render(
      <UpdateSheet
        visible
        manifest={MANIFEST}
        evaluation={available({})}
        onClose={NOOP}
        onManualDownload={NOOP}
      />,
    );

    expect(screen.queryByTestId('update-install')).toBeNull();
    expect(screen.getByTestId('update-manual-download')).toBeTruthy();
    expect(screen.getByTestId('update-later')).toBeTruthy();
  });

  it('弱提示每个码一行，未知码不渲染', async () => {
    await render(
      <UpdateSheet
        visible
        manifest={MANIFEST}
        evaluation={available({
          weakWarnings: ['gateway-outdated', 'protocol-unknown', 'mystery-code'],
        })}
        onClose={NOOP}
        onManualDownload={NOOP}
      />,
    );

    expect(screen.getByText(tr("本机网关版本低于新版要求"))).toBeTruthy();
    expect(screen.getByText(tr("无法确认本机协议版本，请先更新宿主网关"))).toBeTruthy();
    expect(screen.queryByText(/mystery-code/)).toBeNull();
    // 弱提示不阻断关闭。
    expect(screen.getByTestId('update-later')).toBeTruthy();
  });

  it('没有发布说明时不渲染该区', async () => {
    const bare: LatestManifest = { ...MANIFEST };
    delete bare.releaseNotes;
    await render(
      <UpdateSheet
        visible
        manifest={bare}
        evaluation={available({ manifest: bare })}
        onClose={NOOP}
        onManualDownload={NOOP}
      />,
    );

    expect(screen.queryByText(tr("发布说明"))).toBeNull();
    expect(screen.getByText('0.2.0')).toBeTruthy();
  });

  it('没有检查时间时不显示「最近检查」', async () => {
    await render(
      <UpdateSheet
        visible
        manifest={MANIFEST}
        evaluation={available({})}
        onClose={NOOP}
        onManualDownload={NOOP}
      />,
    );

    expect(screen.queryByText(/最近检查：/)).toBeNull();
  });
});

describe('UpdateSheet 下载与安装', () => {
  it('下载时展示进度条与百分比，取消后回到 idle 并中止信号', async () => {
    let seenSignal: AbortSignal | undefined;
    downloadMock.mockImplementation(
      (_manifest: unknown, onProgress: (progress: number) => void, signal?: AbortSignal) => {
        seenSignal = signal;
        onProgress(0.42);
        return new Promise(() => undefined);
      },
    );

    await render(
      <UpdateSheet
        visible
        manifest={MANIFEST}
        evaluation={available({})}
        onClose={NOOP}
        onManualDownload={NOOP}
      />,
    );

    await fireEvent.press(screen.getByTestId('update-install'));

    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText(tr("正在下载更新包…"))).toBeTruthy();
    expect(screen.getByTestId('update-progress-fill')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('update-cancel'));

    expect(seenSignal?.aborted).toBe(true);
    expect(screen.queryByText('42%')).toBeNull();
    expect(screen.getByTestId('update-install')).toBeTruthy();
    expect(screen.getByTestId('update-later')).toBeTruthy();
  });

  it('下载完成后显示正在校验', async () => {
    downloadMock.mockImplementation((_manifest: unknown, onProgress: (progress: number) => void) => {
      onProgress(1);
      return new Promise(() => undefined);
    });

    await render(
      <UpdateSheet
        visible
        manifest={MANIFEST}
        evaluation={available({})}
        onClose={NOOP}
        onManualDownload={NOOP}
      />,
    );

    await fireEvent.press(screen.getByTestId('update-install'));

    expect(screen.getByText(tr("正在校验…"))).toBeTruthy();
    expect(screen.queryByTestId('update-cancel')).toBeNull();
  });

  it('校验失败显示原因、重试与手动下载，且不进入安装', async () => {
    downloadMock.mockResolvedValue({ error: 'checksum' });

    await render(
      <UpdateSheet
        visible
        manifest={MANIFEST}
        evaluation={available({})}
        onClose={NOOP}
        onManualDownload={NOOP}
      />,
    );

    await fireEvent.press(screen.getByTestId('update-install'));

    expect(
      await screen.findByText(tr("文件校验未通过，已删除下载内容。请重试或改用手动下载")),
    ).toBeTruthy();
    expect(screen.getByText(tr("更新失败"))).toBeTruthy();
    expect(screen.getByTestId('update-retry')).toBeTruthy();
    expect(screen.getByTestId('update-manual-download')).toBeTruthy();
    expect(screen.queryByText('checksum')).toBeNull();
    expect(installMock).not.toHaveBeenCalled();
  });

  it('重试会重新下载并安装', async () => {
    downloadMock
      .mockResolvedValueOnce({ error: 'checksum' })
      .mockResolvedValueOnce({ file: FILE });

    await render(
      <UpdateSheet
        visible
        manifest={MANIFEST}
        evaluation={available({})}
        onClose={NOOP}
        onManualDownload={NOOP}
      />,
    );

    await fireEvent.press(screen.getByTestId('update-install'));
    await screen.findByTestId('update-retry');

    await fireEvent.press(screen.getByTestId('update-retry'));

    await waitFor(() => expect(installMock).toHaveBeenCalledWith(FILE));
    expect(downloadMock).toHaveBeenCalledTimes(2);
  });

  it('安装器拉起成功后关闭弹窗', async () => {
    const onClose = jest.fn();
    downloadMock.mockResolvedValue({ file: FILE });

    await render(
      <UpdateSheet
        visible
        manifest={MANIFEST}
        evaluation={available({})}
        onClose={onClose}
        onManualDownload={NOOP}
      />,
    );

    await fireEvent.press(screen.getByTestId('update-install'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(installMock).toHaveBeenCalledWith(FILE);
  });

  it('缺少未知来源授权时给出设置提示，重试复用已校验文件', async () => {
    const onClose = jest.fn();
    downloadMock.mockResolvedValue({ file: FILE });
    installMock.mockResolvedValue('needs-unknown-sources');

    await render(
      <UpdateSheet
        visible
        manifest={MANIFEST}
        evaluation={available({})}
        onClose={onClose}
        onManualDownload={NOOP}
      />,
    );

    await fireEvent.press(screen.getByTestId('update-install'));

    expect(
      await screen.findByText(tr("请允许本应用「安装未知应用」，授权后返回这里重试")),
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('update-retry')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('update-retry'));

    await waitFor(() => expect(installMock).toHaveBeenCalledTimes(2));
    expect(installMock).toHaveBeenLastCalledWith(FILE);
    expect(downloadMock).toHaveBeenCalledTimes(1);
  });

  it('安装器打不开时回到失败态并允许重试', async () => {
    downloadMock.mockResolvedValue({ file: FILE });
    installMock.mockResolvedValue('failed');

    await render(
      <UpdateSheet
        visible
        manifest={MANIFEST}
        evaluation={available({})}
        onClose={NOOP}
        onManualDownload={NOOP}
      />,
    );

    await fireEvent.press(screen.getByTestId('update-install'));

    expect(
      await screen.findByText(tr("无法打开系统安装器，请重试或改用手动下载")),
    ).toBeTruthy();
    expect(screen.getByTestId('update-retry')).toBeTruthy();
  });

  it.each([
    ['url', "下载地址未通过校验，已取消下载。请改用手动下载"],
    ['download', "下载失败，请检查网络后重试"],
  ] as const)('%s 失败映射为一句人话', async (error, message) => {
    downloadMock.mockResolvedValue({ error });

    await render(
      <UpdateSheet
        visible
        manifest={MANIFEST}
        evaluation={available({})}
        onClose={NOOP}
        onManualDownload={NOOP}
      />,
    );

    await fireEvent.press(screen.getByTestId('update-install'));

    expect(await screen.findByText(tr(message))).toBeTruthy();
    expect(screen.queryByText(error)).toBeNull();
  });
});
