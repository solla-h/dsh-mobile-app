/**
 * 用户旅程（本机 UI 集成，不是真机 E2E）：运行时切换语言。
 *
 * 冷启动走英文的那条旅程（app-journey.english.test.tsx）只覆盖「一开始就是英文」，
 * 覆盖不到真正的失败路径：先按中文渲染，再在宿主信息里切成英文。所有把 tr()
 * 结果存进 useMemo 的地方，都会在这条路上停在旧语言——组件重渲染了，缓存没失效。
 *
 * 动线：配对 → 「全部会话」→ 宿主信息 → 语言 → English → 关面板
 *      → 新建会话面板 → 网关菜单 → 分组标题，逐处确认没有中文残留。
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂受 hoist 限制，只能 require 共享底座 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import App from '../../../App';
import {
  controlClient,
  pairingPayloadText,
  resetHarness,
  scriptGateway,
  sessionFixture,
  setAppLanguage,
  setTransportScript,
  TEST_SESSION_ID,
} from './test-harness';

jest.mock('expo-secure-store', () => require('./test-harness').secureStoreMock());
jest.mock('expo-crypto', () => require('./test-harness').cryptoMock());
jest.mock('expo-audio', () => require('./test-harness').audioMock());
jest.mock('../../transport/gateway-client', () => ({
  GatewayClient: require('./test-harness').FakeGatewayClient,
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

beforeEach(async () => {
  resetHarness();
  await setAppLanguage('zh');
});

describe('运行时切换语言', () => {
  it('中文启动 → 切成英文后，已打开过的面板与分组标题都跟着换', async () => {
    // cwd 留空 → 会话落在 loose 组，组标题由 tr("未分组") 现场求值。
    const session = sessionFixture({ cwd: undefined });
    setTransportScript(scriptGateway({ sessions: [session] }));

    await render(<App />);

    // 1. 中文冷启动并配对。
    expect(await screen.findByText('扫码配对')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('pairing-manual-toggle'));
    await fireEvent.changeText(await screen.findByTestId('pairing-payload'), pairingPayloadText());
    await fireEvent.press(screen.getByTestId('pairing-connect'));
    expect(await screen.findByText('已连接')).toBeTruthy();
    await waitFor(() => expect(controlClient().state).toBe('ready'));

    // 2. 「全部会话」：中文分组标题先出现（这是切语言前的基线）。
    await fireEvent.press(screen.getByText('全部会话'));
    expect(await screen.findByTestId(`session-row-${TEST_SESSION_ID}`)).toBeTruthy();
    expect(screen.getAllByText('未分组').length).toBeGreaterThan(0);

    // 3. 宿主信息 → 语言 → English。这是唯一不改系统设置的入口。
    await fireEvent.press(screen.getByText('宿主 ›'));
    await fireEvent.press(await screen.findByText('修改'));
    // English 选项的 label 与 hint 都是「English」，取第一个（可点的那行）。
    await fireEvent.press((await screen.findAllByText('English'))[0]);

    // 4. 面板标题立刻变英文，且语言行本身也重绘。
    expect(await screen.findByText('Host and global defaults')).toBeTruthy();
    expect(screen.getByText('Language')).toBeTruthy();
    expect(screen.queryByText('宿主与全局默认')).toBeNull();
    await fireEvent.press(screen.getByText('×'));

    // 5. 分组标题：rows 是 useMemo 算出来的，不重算就会永远停在「未分组」。
    await waitFor(() => expect(screen.getAllByText('Ungrouped').length).toBeGreaterThan(0));
    expect(screen.queryAllByText('未分组')).toHaveLength(0);

    // 6. 新建会话面板：标题是渲染期求值的，动作项是 useMemo 里的，两边都得是英文。
    await fireEvent.press(screen.getByText('+ New'));
    // 「新建会话」同时是新按钮的 a11y 标签和面板标题，两处都该是英文。
    expect((await screen.findAllByText('New session')).length).toBeGreaterThan(0);
    expect(screen.getByText('Select directory…')).toBeTruthy();
    expect(screen.queryByText('选择目录…')).toBeNull();
    expect(screen.queryByText('用网关的默认工作目录')).toBeNull();
    await fireEvent.press(screen.getByText('Cancel'));

    // 7. 网关菜单：同一个 useMemo 病，换成英文后重开必须是英文。
    await fireEvent.press(screen.getByLabelText(/Gateway: /));
    expect(await screen.findByText('+ Add gateway')).toBeTruthy();
    expect(screen.queryByText('＋ 添加网关')).toBeNull();
    await fireEvent.press(screen.getByText('Cancel'));

    // 8. 切回中文：同一批面板要能回来（转换是双向的，不是单向覆盖）。
    await fireEvent.press(screen.getByText('Host ›'));
    await fireEvent.press(await screen.findByText('Edit'));
    // 英文界面下语言选项的中文项显示成 "Chinese"（label 经过 tr()）。
    await fireEvent.press(await screen.findByText('Chinese'));
    expect(await screen.findByText('宿主与全局默认')).toBeTruthy();
    await fireEvent.press(screen.getByText('×'));
    await waitFor(() => expect(screen.getAllByText('未分组').length).toBeGreaterThan(0));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  }, 20000);
});
