/**
 * Issue #10 验收旅程（本机 UI 集成，不是真机 E2E）：
 * 英文用户首次打开 → 配对页 → 会话列表 → 进会话 → 发消息 → 返回 → 退出。
 * 审查点在状态词与审批用词：同义异名会直接破坏交互连贯性。
 *
 * 只有传输层是脚本化的 FakeGatewayClient；App / SessionScreen / FocusHome
 * 与全部状态机跑真实现。会话标题与历史正文是网关数据，按设计不翻译。
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂受 hoist 限制，只能 require 共享底座 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import App from '../../../App';
import type { ServerFrame } from '../../protocol/types';
import { writeJson } from '../../storage/persisted-state';
import {
  controlClient,
  conversationClient,
  historyEvents,
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
  await setAppLanguage('en');
});

/**
 * 审批决定相关的中文界面词（也含只在旧版/注释里出现过的别名）。
 * 用正则查 queryAllByText，连「✓ 允许一次」这种把词当子串漏出去的情况也抓得住。
 */
const CHINESE_APPROVAL_CHROME = [
  '待审批',
  '允许一次',
  '拒绝',
  '审批详情',
  '快速批准',
  '批准并继续队列',
  '放行',
  '拍板',
] as const;

function expectNoChineseApprovalChrome(): void {
  for (const word of CHINESE_APPROVAL_CHROME) {
    expect(screen.queryAllByText(new RegExp(word)).length).toBe(0);
  }
}

/** 折叠态拇指坞 + 顶栏状态胶囊的官方英文标签。 */
function expectEnglishDockLabels(): void {
  expect(screen.getAllByText('✓ Allow once').length).toBeGreaterThan(0);
  expect(screen.getAllByText('× Reject').length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Approval: /).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Approval').length).toBeGreaterThan(0);
}

/** 悔棋胶囊的官方英文文案（撤回决定是唯一标识，避免和轨迹里的 Allowed 撞车）。 */
function expectEnglishGraceCapsule(): void {
  expect(screen.getAllByText(/Undo decision \(/).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Allowed').length).toBeGreaterThan(0);
}

/** 注入到会话连接（channel 未指定）的服务端审批请求；形状对齐 protocol/pending.ts 与 interactions.ts。 */
function approvalFrame(rpcId: string, approvalId: string): ServerFrame {
  return {
    kind: 'approval-requested',
    rpcId,
    sessionId: TEST_SESSION_ID,
    approvalId,
    toolName: 'edit',
    reason: 'Apply the patch to continue',
  } as ServerFrame;
}

describe('英文界面完整旅程', () => {
  it('配对 → 列表 → 会话 → 发消息 → 返回，全程不出现中文界面文案', async () => {
    const session = sessionFixture();
    setTransportScript(
      scriptGateway({
        sessions: [session],
        history: { [TEST_SESSION_ID]: historyEvents() },
        reply: 'Scripted reply',
      }),
    );

    await render(<App />);

    // 1. 冷启动：英文配对页。
    expect(await screen.findByText('Scan to pair')).toBeTruthy();
    expect(screen.queryByText('扫码配对')).toBeNull();

    // 2. 坏配对串的错误句也是英文，且不离开配对页。
    await fireEvent.press(screen.getByTestId('pairing-manual-toggle'));
    const input = await screen.findByTestId('pairing-payload');
    await fireEvent.changeText(input, 'not-base64!');
    await fireEvent.press(screen.getByTestId('pairing-connect'));
    expect(await screen.findByText(/not valid Base64URL/)).toBeTruthy();
    expect(screen.getByText('Scan to pair')).toBeTruthy();

    // 3. 合法配对：连接状态词用官方英文。
    await fireEvent.changeText(screen.getByTestId('pairing-payload'), pairingPayloadText());
    await fireEvent.press(screen.getByTestId('pairing-connect'));
    expect(await screen.findByText('Connected')).toBeTruthy();
    expect(screen.queryByText('已连接')).toBeNull();
    await waitFor(() => expect(controlClient().state).toBe('ready'));

    // 4. 会话列表。
    await fireEvent.press(screen.getByText('All sessions'));
    expect(await screen.findByTestId(`session-row-${TEST_SESSION_ID}`)).toBeTruthy();
    expect(screen.queryByText('全部会话')).toBeNull();
    // 会话标题来自网关投影，属于数据而非界面文案，保持原样。
    expect(screen.getByText('测试会话')).toBeTruthy();

    // 5. 进会话：输入框占位符与历史正文。
    await fireEvent.press(screen.getByTestId(`session-row-${TEST_SESSION_ID}`));
    const composer = await screen.findByTestId('session-composer-input');
    expect(composer.props.placeholder).toBe('Send a message…');
    expect(await screen.findByText('上一条问的')).toBeTruthy();
    expect(await screen.findByText('上一条答的')).toBeTruthy();
    expect(screen.queryByText('发消息…')).toBeNull();

    // 6. 发消息：帧真的写进 socket，英文回复渲染出来。
    await fireEvent.changeText(composer, 'hello gateway');
    await fireEvent.press(screen.getByTestId('session-send'));
    expect(await screen.findByText('Scripted reply')).toBeTruthy();
    const message = conversationClient().sent.find((frame) => frame.type === 'message');
    expect(message).toMatchObject({ sessionId: TEST_SESSION_ID, text: 'hello gateway' });

    // 7. 返回列表：会话页卸载，列表与 Tab 还在，没有死路。
    await fireEvent.press(screen.getByTestId('session-back'));
    expect(await screen.findByText('All sessions')).toBeTruthy();
    expect(screen.queryByTestId('session-composer-input')).toBeNull();
    expect(screen.getByTestId(`session-row-${TEST_SESSION_ID}`)).toBeTruthy();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
  }, 20000);

  /**
   * 4003 = 凭据不可恢复。这条路径以前靠 detail.includes('重新配对') 判断，
   * 英文界面下永远匹配不上，于是给用户一个只会再被拒一次的「重连」。
   * 现在 close 原因带结构化 kind，界面必须回到「点顶部网关名」。
   */
  it('设备授权撤销后不再提供重连，而是指向顶部的重新配对入口', async () => {
    setTransportScript(scriptGateway({ sessions: [] }));
    await render(<App />);
    expect(await screen.findByText('Scan to pair')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('pairing-manual-toggle'));
    await fireEvent.changeText(await screen.findByTestId('pairing-payload'), pairingPayloadText());
    await fireEvent.press(screen.getByTestId('pairing-connect'));
    expect(await screen.findByText('Connected')).toBeTruthy();

    // 网关推送 4003：状态必须落到 error，且带 reauth 语义。
    await act(async () => {
      conversationClient().emitState('error', 'Device authorization was revoked. Please pair again.', 'reauth');
    });

    const hint = await screen.findByText(/Device authorization was revoked/);
    expect(hint).toBeTruthy();
    // 英文界面下必须真的出现「点顶部网关名」，而不是「点这里重连」。
    expect(screen.getByText(/Tap the gateway name at the top/)).toBeTruthy();
    expect(screen.queryByText(/Tap here to reconnect/)).toBeNull();
    // 整行不再是 button：点了也没有用，别给它 button 角色。
    expect(screen.queryByRole('button', { name: /Device authorization was revoked/ })).toBeNull();
  }, 20000);

  it('没有显式偏好时按系统语言回退英文', async () => {
    await writeJson('app-settings', {});
    const spy = jest.spyOn(Intl, 'DateTimeFormat');
    spy.mockReturnValue({
      resolvedOptions: () => ({ locale: 'en-US' }),
    } as unknown as Intl.DateTimeFormat);
    try {
      setTransportScript(scriptGateway({ sessions: [] }));
      await render(<App />);
      expect(await screen.findByText('Scan to pair')).toBeTruthy();
      expect(screen.queryByText('扫码配对')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * 英文界面「审批决定」完整路径（本机 UI 集成，不是真机 E2E）：
   * 配对 → 列表 → 会话 → 注入真审批帧 → 英文标签 → 展开详情 → 允许一次 →
   * 审批帧真的送出 → 返回 → 退出。
   * 帧走 setTransportScript / FakeGatewayClient.emit 注入，产品代码与状态机全跑真实现。
   */
  it('配对 → 列表 → 会话 → 审批决定(英文) → 帧送出 → 返回退出', async () => {
    const session = sessionFixture();
    setTransportScript(
      scriptGateway({
        sessions: [session],
        history: { [TEST_SESSION_ID]: historyEvents() },
      }),
    );

    await render(<App />);

    // 1. 冷启动 + 合法配对（沿用上一个旅程的英文断言口径）。
    expect(await screen.findByText('Scan to pair')).toBeTruthy();
    expect(screen.queryByText('扫码配对')).toBeNull();
    await fireEvent.press(screen.getByTestId('pairing-manual-toggle'));
    const pairingInput = await screen.findByTestId('pairing-payload');
    await fireEvent.changeText(pairingInput, pairingPayloadText());
    await fireEvent.press(screen.getByTestId('pairing-connect'));
    expect(await screen.findByText('Connected')).toBeTruthy();
    expect(screen.queryByText('已连接')).toBeNull();
    await waitFor(() => expect(controlClient().state).toBe('ready'));

    // 2. 会话列表 → 进会话（确认会话页真挂载、onFrame 监听已就位）。
    await fireEvent.press(screen.getByText('All sessions'));
    expect(await screen.findByTestId(`session-row-${TEST_SESSION_ID}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`session-row-${TEST_SESSION_ID}`));
    const composer = await screen.findByTestId('session-composer-input');
    expect(composer.props.placeholder).toBe('Send a message…');
    expect(await screen.findByText('上一条答的')).toBeTruthy();

    // 3. 真·服务端推送：审批请求必须到达「会话连接」（SessionScreen 的决策坞订阅这条），
    //    control 连接只喂全局 pending/首页徽标，这里刻意不碰它，避免 auto-hop 干扰。
    await act(async () => {
      conversationClient().emit(approvalFrame('rpc-approval-1', 'approval-1'));
    });

    // 4. 官方英文标签到位，且 8 个中文审批界面词一个都不出现。
    await screen.findByText('✓ Allow once');
    expectEnglishDockLabels();
    expectNoChineseApprovalChrome();

    // 5. 展开审批详情：TriageSheet 的官方英文抬头；收起后决策按钮重新唯一。
    await fireEvent.press(screen.getByText('Tap to enlarge ↗'));
    expect(await screen.findByText('Approval details')).toBeTruthy();
    expectNoChineseApprovalChrome();
    await fireEvent.press(screen.getByText('Collapse back to bottom bar ⌄'));
    await screen.findByText('✓ Allow once');

    // 6. CANCEL 分支：允许一次 → 悔棋胶囊（英文）→ 撤回 → 一帧都不发。
    await fireEvent.press(screen.getByText('✓ Allow once'));
    await screen.findByText(/Undo decision \(/);
    expectEnglishGraceCapsule();
    expectNoChineseApprovalChrome();
    expect(screen.queryByText('已允许')).toBeNull();
    expect(screen.queryAllByText(/撤回决定/).length).toBe(0);
    expect(conversationClient().sent.filter((f) => f.type === 'approval-response')).toHaveLength(0);
    await fireEvent.press(screen.getByText(/Undo decision \(/));
    expect(conversationClient().sent.filter((f) => f.type === 'approval-response')).toHaveLength(0);
    expect(await screen.findByText('✓ Allow once')).toBeTruthy();
    expect(screen.getAllByText('Decision withdrawn').length).toBeGreaterThan(0);
    expectNoChineseApprovalChrome();

    // 7. SUCCESS 分支：再次允许一次 → 等 4.5s 悔棋窗自然到期 →
    //    真正的 approval-response 帧（带 approvalId）写在会话连接上。
    await fireEvent.press(screen.getByText('✓ Allow once'));
    await screen.findByText(/Undo decision \(/);
    expectEnglishGraceCapsule();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5200));
    });
    const sentAfterExpiry = conversationClient().sent.filter((f) => f.type === 'approval-response');
    expect(sentAfterExpiry).toHaveLength(1);
    expect(sentAfterExpiry[0]).toMatchObject({
      type: 'approval-response',
      rpcId: 'rpc-approval-1',
      sessionId: TEST_SESSION_ID,
      approvalId: 'approval-1',
      outcome: 'allowed-once',
    });
    // 帧走的是会话连接，不是 control 连接。
    expect(controlClient().sent.some((f) => f.type === 'approval-response')).toBe(false);
    expectNoChineseApprovalChrome();

    // 8. LEAVING MIDWAY 分支：换一条新审批（先 resolved 掉旧的，再推新请求），
    //    拍板后趁悔棋窗还没结束就返回列表；SessionScreen 卸载时 flushGrace 必须补发这一票。
    await act(async () => {
      conversationClient().emit({ kind: 'approval-resolved', rpcId: 'rpc-approval-1' } as ServerFrame);
      conversationClient().emit(approvalFrame('rpc-approval-2', 'approval-2'));
    });
    await screen.findByText('✓ Allow once');
    await fireEvent.press(screen.getByText('✓ Allow once'));
    await screen.findByText(/Undo decision \(/);
    expectNoChineseApprovalChrome();
    // 这一票此刻还压在悔棋窗里，尚未发出。
    expect(conversationClient().sent.filter((f) => f.type === 'approval-response')).toHaveLength(1);

    // 9. 返回并退出：列表回来，决定被 flush 成一帧，且没有重复发送；全程仍是英文。
    await fireEvent.press(screen.getByTestId('session-back'));
    expect(await screen.findByText('All sessions')).toBeTruthy();
    expect(screen.queryByTestId('session-composer-input')).toBeNull();
    expect(screen.getByTestId(`session-row-${TEST_SESSION_ID}`)).toBeTruthy();
    const sentAfterLeave = conversationClient().sent.filter((f) => f.type === 'approval-response');
    expect(sentAfterLeave).toHaveLength(2);
    expect(sentAfterLeave[1]).toMatchObject({
      type: 'approval-response',
      rpcId: 'rpc-approval-2',
      sessionId: TEST_SESSION_ID,
      approvalId: 'approval-2',
      outcome: 'allowed-once',
    });
    expect(controlClient().sent.some((f) => f.type === 'approval-response')).toBe(false);
    expectNoChineseApprovalChrome();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
  }, 30000);
});
