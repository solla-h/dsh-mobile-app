/**
 * 真 App 用户旅程（本机 UI 集成，不是真机 E2E）：
 * 未配对 → 粘贴一条坏配对串被拒 → 粘贴合法配对串 → 切「全部会话」
 * → 进真会话页 → 发一条文字 → 收到脚本化网关回复 → 返回列表。
 *
 * 只有传输层是假的（FakeGatewayClient）；App.tsx / SessionScreen / FocusHome
 * 以及全部状态机跑真实现。控件选择器用稳定 testID，内容断言用用户可见文案。
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂受 hoist 限制，只能 require 共享底座 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import App from '../../../App';
import {
  controlClient,
  conversationClient,
  historyEvents,
  pairingPayloadText,
  resetHarness,
  scriptGateway,
  setAppLanguage,
  sessionFixture,
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

describe('配对 → 全部会话 → 发送', () => {
  it('拒绝坏配对串，合法配对后进会话发消息并读到回复，再返回列表', async () => {
    const session = sessionFixture();
    setTransportScript(
      scriptGateway({
        sessions: [session],
        history: { [TEST_SESSION_ID]: historyEvents() },
        reply: '脚本回复：收到',
      }),
    );

    await render(<App />);

    // 1. 冷启动、没有任何配对记录：配对页。
    expect(await screen.findByText('扫码配对')).toBeTruthy();

    // 2. 手动粘贴一条坏配对串：原地报错，不离开配对页。
    await fireEvent.press(screen.getByTestId('pairing-manual-toggle'));
    const input = await screen.findByTestId('pairing-payload');
    await fireEvent.changeText(input, 'not-base64!');
    await fireEvent.press(screen.getByTestId('pairing-connect'));
    expect(await screen.findByText(/不是合法 Base64URL/)).toBeTruthy();
    expect(screen.getByText('扫码配对')).toBeTruthy();

    // 3. 换成合法配对串：握手成功，列表页替换掉配对页。
    await fireEvent.changeText(screen.getByTestId('pairing-payload'), pairingPayloadText());
    await fireEvent.press(screen.getByTestId('pairing-connect'));
    expect(await screen.findByText('已连接')).toBeTruthy();
    expect(screen.queryByText('扫码配对')).toBeNull();

    // 配对成功后 App 的 control 连接也要能握手并干活（定时任务目录仅走这条）。
    await waitFor(() => expect(controlClient().state).toBe('ready'));
    expect(controlClient().sent.some((frame) => frame.type === 'schedule-catalog')).toBe(true);

    // 4. 会话没有待办/不在跑，聚焦页不显示 → 切「全部会话」。
    await fireEvent.press(screen.getByText('全部会话'));
    expect(await screen.findByTestId(`session-row-${TEST_SESSION_ID}`)).toBeTruthy();
    expect(screen.getByText('测试会话')).toBeTruthy();

    // 5. 进真会话页：首屏历史能读到。
    await fireEvent.press(screen.getByTestId(`session-row-${TEST_SESSION_ID}`));
    expect(await screen.findByTestId('session-composer-input')).toBeTruthy();
    expect(await screen.findByText('上一条问的')).toBeTruthy();
    expect(await screen.findByText('上一条答的')).toBeTruthy();

    // 6. 发文字：帧真的写进「socket」，脚本回执 + 回复渲染出来。
    await fireEvent.changeText(screen.getByTestId('session-composer-input'), '你好网关');
    await fireEvent.press(screen.getByTestId('session-send'));
    expect(await screen.findByText('脚本回复：收到')).toBeTruthy();

    const message = conversationClient().sent.find((frame) => frame.type === 'message');
    expect(message).toMatchObject({ sessionId: TEST_SESSION_ID, text: '你好网关' });

    // 7. 返回列表：会话页卸载，列表和 Tab 还在。
    await fireEvent.press(screen.getByTestId('session-back'));
    expect(await screen.findByText('全部会话')).toBeTruthy();
    expect(screen.queryByTestId('session-composer-input')).toBeNull();
    expect(screen.getByTestId(`session-row-${TEST_SESSION_ID}`)).toBeTruthy();

    // 让草稿落盘/收拢淡入这类短定时器跑完，别把它们留给 worker 收尾。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
  }, 15000);
});
