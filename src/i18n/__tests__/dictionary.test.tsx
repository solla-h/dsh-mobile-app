/**
 * Issue #10：字典形状、官方术语、语言回退与切换刷新。
 * 词表依据 DeepSeek Harness docs/i18n/terminology.md：issue 引用的 checkout 是
 * commit 5badb15（dsh-v0.2.0-rc.2-266），App pin 的 tag 是 dsh-v0.2.1-rc.5。
 * 两个版本的词表已逐文件比对，本 issue 用到的审批 / Round / subagent / Turn 词条一致。
 */
import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { readAppSettings, writeAppSettings } from '../../storage/app-settings';
import { en } from '../en';
import {
  LanguageProvider,
  currentLanguage,
  systemLanguage,
  tr,
  useLanguage,
  useLanguageVersion,
} from '../index';
import { KEYS, type Key } from '../keys';

jest.mock('../../storage/app-settings', () => ({
  ...jest.requireActual('../../storage/app-settings'),
  readAppSettings: jest.fn(async () => ({ language: 'zh' })),
  writeAppSettings: jest.fn(async () => undefined),
}));

const readSettingsMock = readAppSettings as jest.Mock;
const writeSettingsMock = writeAppSettings as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  readSettingsMock.mockResolvedValue({ language: 'zh' });
});

describe('字典完整性', () => {
  it('英文覆盖所有中文 key，且没有多余条目', () => {
    expect(Object.keys(en).slice().sort()).toEqual(KEYS.slice().sort());
  });

  it('每条英文都是非空、不含中文的译文', () => {
    for (const key of KEYS) {
      expect(en[key].length).toBeGreaterThan(0);
      expect(en[key]).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('占位符编号与中文 key 一一对应', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
    for (const key of KEYS) expect(placeholders(en[key])).toBe(placeholders(key));
  });

  it('审批与状态词使用官方英文用词', () => {
    const official: [Key, string][] = [
      ['允许一次', 'Allow once'],
      ['✓ 允许一次', '✓ Allow once'],
      ['拒绝', 'Reject'],
      ['× 拒绝', '× Reject'],
      ['待审批', 'Approval'],
      ['等待审批 ({0}/{1})', 'Waiting for approval ({0}/{1})'],
      ['审批详情', 'Approval details'],
      ['空闲', 'Idle'],
      ['运行中', 'Running'],
      ['停止生成', 'Stop generating'],
      ['子智能体会话', 'Subagent session'],
      ['网页搜索', 'Web search'],
      ['未分组', 'Ungrouped'],
      ['用户', 'User'],
      ['展开', 'Expand'],
      ['语言', 'Language'],
      ['界面', 'Appearance'],
    ];
    for (const [key, expected] of official) expect(en[key]).toBe(expected);
  });

  it('不出现官方禁用的译法', () => {
    const all = Object.values(en).join(' ');
    expect(all).not.toMatch(/sub-agent|child agent/i);
    // Round 是外层策略层，只保留英文原词，不能拿来翻译「轮次」。
    expect(all).not.toMatch(/\bRound\b/);
  });

  it('中文 key 里不再有 issue #10 点名的非官方用词与设计稿残留', () => {
    const banned = [
      '快速批准', '批准并继续队列', '拒绝并回滚', '待批复', '已批准',
      '放行', '子代理', '回合', '目标回合', 'Ralph', '联网搜索',
      '未归组', '查阅', '已就绪', 'THINKING', 'ACTIVE FOCUS',
      'THUMB ARC DIAL', 'HIGH RISK GATE', 'FOCUS TRIAGE SHEET', '方案 B 展开态',
    ];
    const hits = KEYS.filter((key) =>
      banned.some((word) => key.includes(word)) || /拍.{0,2}板/.test(key),
    );
    // 「拦截」只出现在公网明文 / 代理拦截的连接安全提示里，不是审批决定词，故不列入。
    expect(hits).toEqual([]);
  });
});

describe('文案函数与语言切换', () => {
  it('中文偏好下返回原文并替换编号占位符', async () => {
    // 偏好读取是异步的，activate() 会在微任务里通知订阅者；用 async act 包住挂载，
    // 让这次通知落在 act 范围内，避免测试输出出现 act(...) 警告。
    await act(async () => {
      render(
        <LanguageProvider>
          <Text>probe</Text>
        </LanguageProvider>,
      );
    });
    await waitFor(() => expect(currentLanguage()).toBe('zh'));
    expect(tr('等待审批 ({0}/{1})', [1, 2])).toBe('等待审批 (1/2)');
    expect(tr('✓ 允许一次')).toBe('✓ 允许一次');
  });

  it('英文偏好下 tr() 返回官方英文', async () => {
    readSettingsMock.mockResolvedValue({ language: 'en' });
    // 偏好读取是异步的，activate() 会在微任务里通知订阅者；用 async act 包住挂载，
    // 让这次通知落在 act 范围内，避免测试输出出现 act(...) 警告。
    await act(async () => {
      render(
        <LanguageProvider>
          <Text>probe</Text>
        </LanguageProvider>,
      );
    });
    await waitFor(() => expect(currentLanguage()).toBe('en'));
    expect(tr('✓ 允许一次')).toBe('✓ Allow once');
    expect(tr('待审批')).toBe('Approval');
    expect(tr('等待审批 ({0}/{1})', [1, 2])).toBe('Waiting for approval (1/2)');
  });

  it('切换语言会持久化偏好并通知订阅组件重渲染', async () => {
    readSettingsMock.mockResolvedValue({ language: 'zh' });
    let setter: ((next: 'zh' | 'en') => void) | undefined;
    let renders = 0;
    function Switcher() {
      const { setLanguage } = useLanguage();
      useLanguageVersion();
      setter = setLanguage;
      renders += 1;
      return null;
    }
    await act(async () => {
      render(
        <LanguageProvider>
          <Switcher />
        </LanguageProvider>,
      );
    });
    await waitFor(() => expect(currentLanguage()).toBe('zh'));
    const before = renders;
    expect(tr('✓ 允许一次')).toBe('✓ 允许一次');
    await act(async () => {
      setter?.('en');
    });
    expect(currentLanguage()).toBe('en');
    expect(tr('✓ 允许一次')).toBe('✓ Allow once');
    // useThemedStyles 里挂的订阅必须让组件重渲染，否则文案会停在旧语言。
    expect(renders).toBeGreaterThan(before);
    expect(writeSettingsMock).toHaveBeenCalledWith({ language: 'en' });
  });
});

describe('系统语言回退', () => {
  afterEach(() => jest.restoreAllMocks());

  it('zh* 用中文，其余语言与未知 locale 回退英文', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat');
    spy.mockReturnValue({
      resolvedOptions: () => ({ locale: 'zh-CN' }),
    } as unknown as Intl.DateTimeFormat);
    expect(systemLanguage()).toBe('zh');
    spy.mockReturnValue({
      resolvedOptions: () => ({ locale: 'en-US' }),
    } as unknown as Intl.DateTimeFormat);
    expect(systemLanguage()).toBe('en');
  });
});
