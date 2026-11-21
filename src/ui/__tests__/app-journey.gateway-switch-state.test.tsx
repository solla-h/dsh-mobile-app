/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories use shared native adapters */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import App from '../../../App';
import { upsertGateway } from '../../storage/gateway-store';
import {
  resetHarness,
  scriptGateway,
  setAppLanguage,
  setTransportScript,
  TEST_GATEWAY_ID,
  conversationClient,
} from './test-harness';

jest.mock('expo-secure-store', () => require('./test-harness').secureStoreMock());
jest.mock('expo-crypto', () => require('./test-harness').cryptoMock());
jest.mock('expo-audio', () => require('./test-harness').audioMock());
jest.mock('../../transport/gateway-client', () => ({
  GatewayClient: require('./test-harness').FakeGatewayClient,
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const gatewayA = {
  id: TEST_GATEWAY_ID,
  url: 'ws://127.0.0.1:3080/ws/mobile',
  token: 'token-a',
  gatewayId: 'gateway-a',
  label: '网关 A',
};
const gatewayB = {
  id: 'gw:gateway-b',
  url: 'ws://127.0.0.1:3081/ws/mobile',
  token: 'token-b',
  gatewayId: 'gateway-b',
  label: '网关 B',
};

beforeEach(async () => {
  resetHarness();
  await setAppLanguage('zh');
  await upsertGateway(gatewayB);
  await upsertGateway(gatewayA);
  const base = scriptGateway({ sessions: [] });
  setTransportScript({
    ...base,
    onSend(client, frame) {
      base.onSend?.(client, frame);
      if (frame.type === 'schedule-catalog' && client.options?.url === gatewayA.url) {
        queueMicrotask(() => client.emit({
          kind: 'schedule-catalog',
          items: [{ id: 'schedule-a', name: '仅网关 A 的任务', schedule: 'daily' }],
        }));
      }
    },
  });
});

test('removing the current gateway clears its schedule before activating the next one', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await render(<App />);
  await fireEvent.press(await screen.findByText('定时任务'));
  expect(await screen.findByText('仅网关 A 的任务')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText(/网关：/));
  await fireEvent.press(await screen.findByText('移除当前网关'));
  const actions = jest.mocked(Alert.alert).mock.calls[0]?.[2];
  await act(async () => {
    await actions?.find(({ text }) => text === '移除')?.onPress?.();
  });
  await waitFor(() => expect(screen.queryByText('仅网关 A 的任务')).toBeNull());
  await waitFor(() => expect(conversationClient().options?.url).toBe(gatewayB.url));
  jest.restoreAllMocks();
});

test('切换网关时旧定时任务在新目录到达前已清空', async () => {
  await render(<App />);
  await fireEvent.press(await screen.findByText('定时任务'));
  expect(await screen.findByText('仅网关 A 的任务')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText(/网关：/));
  await fireEvent.press(await screen.findByText('网关 B'));

  expect(screen.queryByText('仅网关 A 的任务')).toBeNull();
});
