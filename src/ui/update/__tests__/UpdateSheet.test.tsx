import { fireEvent, render, screen } from '@testing-library/react-native';

import { UpdateSheet } from '../UpdateSheet';
import { tr } from '../../../i18n';
import type { LatestManifest, UpdateEvaluation } from '../../../update/manifest';

/**
 * 更新弹窗只负责「展示检查结果」。这里锁住三件事：
 * 有更新时的版本/发布说明、hostBlocked 的强阻断文案、弱提示逐行出现；
 * 以及「没有下载并安装按钮」这条块边界（chunk 4 才加）。
 */

const MANIFEST: LatestManifest = {
  version: '0.2.0',
  versionCode: 6,
  tag: 'v0.2.0',
  apkUrl: 'https://github.com/solla-h/dsh-mobile-app/releases/download/v0.2.0/app.apk',
  sha256Url: 'https://github.com/solla-h/dsh-mobile-app/releases/download/v0.2.0/app.apk.sha256',
  releaseNotes: { 'zh-CN': '修复若干问题', en: 'Bug fixes' },
};

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

describe('UpdateSheet', () => {
  it('展示远端版本、tag 与发布说明，并只给「稍后」「手动下载」两个出口', async () => {
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

    expect(screen.queryByText(/下载并安装/)).toBeNull();

    await fireEvent.press(screen.getByTestId('update-later'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onManualDownload).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('update-manual-download'));
    expect(onManualDownload).toHaveBeenCalledTimes(1);
  });

  it('hostBlocked 时给出强阻断提示，但仍可关闭', async () => {
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
    await fireEvent.press(screen.getByTestId('update-later'));
    expect(onClose).toHaveBeenCalled();
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
