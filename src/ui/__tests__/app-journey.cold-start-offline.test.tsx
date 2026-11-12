/**
 * 真 App 用户旅程（本机 UI 集成，不是真机 E2E）：已配对用户冷启动 + 断线。
 *
 * 覆盖三条产品承诺（AGENTS.md「连接状态与离线」）：
 * - 冷启动先读缓存再连，断网时列表不空成二维码；
 * - 连接失败不会把已配对用户打回配对页；
 * - 会话页断线不卸载：草稿/会话不丢。
 *
 * 存储走真实 storage 模块（gateway-store / persisted-state / drafts）+ 内存
 * native 适配器；只有传输层是脚本化的 FakeGatewayClient。
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂受 hoist 限制，只能 require 共享底座 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import App from '../../../App';
import { upsertGateway } from '../../storage/gateway-store';
import { writeJson } from '../../storage/persisted-state';
import {
  conversationClient,
  resetHarness,
  sessionFixture,
  setAppLanguage,
  setTransportScript,
  TEST_GATEWAY_ID,
  TEST_SESSION_ID,
} from './test-harness';

jest.mock('expo-secure-store', () => require('./test-harness').secureStoreMock());
jest.mock('expo-crypto', () => require('./test-harness').cryptoMock());
jest.mock('expo-audio', () => require('./test-harness').audioMock());
jest.mock('../../transport/gateway-client', () => ({
  GatewayClient: require('./test-harness').FakeGatewayClient,
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const SAVED_GATEWAY = {
  id: TEST_GATEWAY_ID,
  url: 'ws://127.0.0.1:3080/ws/mobile',
  token: 'token-seeded',
  gatewayId: 'test-gateway',
  label: '测试网关',
};

beforeEach(async () => {
  resetHarness();
  await setAppLanguage('zh');
  // 真实 storage 逻辑：配对记录进 SecureStore、会话列表进 dsh-state 缓存文件。
  await upsertGateway(SAVED_GATEWAY);
  await writeJson(`sessions-${TEST_GATEWAY_ID}`, [sessionFixture()]);
});

describe('冷启动 + 断线', () => {
  it('摆出缓存列表、连接失败不回配对页，断线时会话与草稿都还在', async () => {
    setTransportScript({
      onConnect(client, options) {
        // control 连接静默；会话连接直接失败（连不上网关）。
        if (options.channel === 'control') return;
        client.emitState('error', '连接失败，正在重连');
      },
    });

    await render(<App />);

    // 1. 冷启动：有缓存先摆列表，连接失败也留在列表页，不回配对页。
    await fireEvent.press(await screen.findByText('全部会话'));
    expect(await screen.findByTestId(`session-row-${TEST_SESSION_ID}`)).toBeTruthy();
    expect(screen.getByText('测试会话')).toBeTruthy();
    expect(screen.getByText('连接异常')).toBeTruthy();
    expect(screen.queryByText('扫码配对')).toBeNull();
    expect(screen.queryByText('配对并连接')).toBeNull();

    // 2. 断线状态进会话：页面挂载（发不出去的请求走失败空态，不转圈等死）。
    await fireEvent.press(screen.getByTestId(`session-row-${TEST_SESSION_ID}`));
    const composer = await screen.findByTestId('session-composer-input');
    expect(await screen.findByText('连接已断开，重连后会自动加载历史')).toBeTruthy();

    // 3. 写下草稿，再发生一次连接失败：会话页不卸载，草稿还在。
    await fireEvent.changeText(composer, '离线时写下的草稿');
    expect(screen.getByDisplayValue('离线时写下的草稿')).toBeTruthy();

    await act(async () => {
      conversationClient().emitState('error', '连接已断开，正在自动重连');
    });

    expect(screen.getByDisplayValue('离线时写下的草稿')).toBeTruthy();
    expect(screen.getAllByText(/连接已断开，正在自动重连/).length).toBeGreaterThan(0);
    expect(screen.queryByText('扫码配对')).toBeNull();
    // 会话头还在（没被弹回列表/配对页）。
    expect(screen.getAllByText('测试会话').length).toBeGreaterThan(0);

    // 草稿落盘是 400ms 防抖：跑完再收尾，别留给 worker。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
  }, 15000);
});
