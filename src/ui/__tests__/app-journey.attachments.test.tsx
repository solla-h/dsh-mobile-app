/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories use the shared native adapters */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { File, type PickSingleFileResult } from 'expo-file-system';
import { Alert } from 'react-native';

import App from '../../../App';
import { upsertGateway } from '../../storage/gateway-store';
import {
  conversationClient,
  helloFrame,
  resetHarness,
  scriptGateway,
  setAppLanguage,
  sessionFixture,
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

// Select the current single-file overload; Jest otherwise infers the deprecated overload.
const picker: { pickFileAsync: () => Promise<PickSingleFileResult> } = File;

const file = {
  name: 'journey.txt', size: 3,
  digest: jest.fn(async () => 'a'.repeat(64)),
  base64: jest.fn(async () => 'YWJj'),
} as unknown as File;

let rejectUpload: boolean;
let uploadCount: number;

beforeEach(async () => {
  resetHarness();
  await setAppLanguage('zh');
  rejectUpload = false;
  uploadCount = 0;
  await upsertGateway({
    id: TEST_GATEWAY_ID, url: 'ws://127.0.0.1:3080/ws/mobile',
    token: 'test-token', gatewayId: 'test-gateway', label: '测试网关',
  });
  const base = scriptGateway({ sessions: [sessionFixture()], reply: '附件已收到' });
  setTransportScript({
    ...base,
    onSend(client, frame) {
      base.onSend?.(client, frame);
      queueMicrotask(() => {
        if (frame.type === 'file-upload-open') {
          uploadCount += 1;
          client.emit(rejectUpload
            ? { kind: 'error', requestType: frame.type, requestId: frame.requestId, code: 'file-upload-checksum' }
            : { kind: 'file-upload-opened', requestId: frame.requestId, uploadId: `upload-${uploadCount}`, chunkBytes: 6 });
        } else if (frame.type === 'file-upload-chunk') {
          client.emit({ kind: 'file-upload-chunk-accepted', requestId: frame.requestId, nextOffset: 3 });
        } else if (frame.type === 'file-upload-finish') {
          client.emit({ kind: 'file-upload-completed', requestId: frame.requestId, receiptId: `receipt-${uploadCount}` });
        }
      });
    },
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

async function openSession(beforeEnter?: () => void) {
  await render(<App />);
  await fireEvent.press(await screen.findByText('全部会话'));
  if (beforeEnter) await act(async () => { beforeEnter(); });
  await fireEvent.press(await screen.findByTestId(`session-row-${TEST_SESSION_ID}`));
  await fireEvent.changeText(await screen.findByTestId('session-composer-input'), '请阅读附件');
}

async function chooseFile() {
  await fireEvent.press(screen.getByLabelText('添加附件'));
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  await act(async () => { buttons?.find((button) => button.text === '文件')?.onPress?.(); });
}

async function sendAndReturn(receiptId: string) {
  await waitFor(() => expect(screen.getByTestId('session-send')).toBeEnabled());
  await fireEvent.press(screen.getByTestId('session-send'));
  expect(conversationClient().sent.find((frame) => frame.type === 'message')).toMatchObject({
    text: '请阅读附件', files: [{ receiptId }],
  });
  expect(await screen.findByText('附件已收到')).toBeTruthy();
  expect(screen.queryByText('journey.txt')).toBeNull();
  await fireEvent.press(screen.getByTestId('session-back'));
  expect(await screen.findByTestId(`session-row-${TEST_SESSION_ID}`)).toBeTruthy();
}

it('保留失败附件和草稿，重试成功后才发送并返回列表', async () => {
  rejectUpload = true;
  jest.spyOn(picker, 'pickFileAsync').mockResolvedValue({ canceled: false, result: file });
  await openSession();
  await chooseFile();
  expect(await screen.findByText('SHA-256 校验失败')).toBeTruthy();
  expect(screen.getByTestId('session-send')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('session-send'));
  expect(screen.getByDisplayValue('请阅读附件')).toBeTruthy();
  expect(screen.getByText('journey.txt')).toBeTruthy();
  expect(conversationClient().sent.some((frame) => frame.type === 'message')).toBe(false);
  rejectUpload = false;
  await fireEvent.press(screen.getByLabelText('重试上传 journey.txt'));
  await sendAndReturn('receipt-2');
}, 15000);

it('选择器打开期间断线，返回后等待重连；再次断线也不能使用旧收据', async () => {
  let finishPicking!: (result: { canceled: false; result: File }) => void;
  jest.spyOn(picker, 'pickFileAsync').mockImplementation(() => new Promise((resolve) => { finishPicking = resolve; }));
  await openSession();
  await chooseFile();
  await act(async () => {
    conversationClient().disconnect();
    finishPicking({ canceled: false, result: file });
  });
  expect(await screen.findByText('等待连接后上传')).toBeTruthy();
  expect(screen.getByDisplayValue('请阅读附件')).toBeTruthy();
  expect(screen.getByTestId('session-send')).toBeDisabled();
  expect(uploadCount).toBe(0);
  await act(async () => { conversationClient().emit(helloFrame()); });
  await waitFor(() => expect(screen.getByTestId('session-send')).toBeEnabled());
  expect(uploadCount).toBe(1);
  await act(async () => { conversationClient().disconnect(); });
  expect(screen.getByTestId('session-send')).toBeDisabled();
  expect(screen.getByText('等待连接后上传')).toBeTruthy();
  await act(async () => { conversationClient().emit(helloFrame()); });
  await waitFor(() => expect(uploadCount).toBe(2));
  await sendAndReturn('receipt-2');
}, 15000);

it('离线等待时可移除附件和退出，不在重连后继续上传', async () => {
  jest.spyOn(picker, 'pickFileAsync').mockResolvedValue({ canceled: false, result: file });
  await openSession();
  await act(async () => { conversationClient().disconnect(); });
  await chooseFile();
  expect(await screen.findByText('等待连接后上传')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('移除附件 journey.txt'));
  expect(screen.queryByText('journey.txt')).toBeNull();
  expect(screen.getByDisplayValue('请阅读附件')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('session-back'));
  await act(async () => { conversationClient().emit(helloFrame()); });
  expect(uploadCount).toBe(0);
  expect(await screen.findByTestId(`session-row-${TEST_SESSION_ID}`)).toBeTruthy();
}, 15000);

it('进入会话前已发生暂时错误，但连接可写时仍能上传', async () => {
  jest.spyOn(picker, 'pickFileAsync').mockResolvedValue({ canceled: false, result: file });
  await openSession(() => conversationClient().emitState('error', '连接出错'));
  await chooseFile();
  await sendAndReturn('receipt-1');
}, 15000);

it('同一连接的暂时错误与探活恢复不作废附件收据', async () => {
  jest.spyOn(picker, 'pickFileAsync').mockResolvedValue({ canceled: false, result: file });
  await openSession();
  await chooseFile();
  await waitFor(() => expect(screen.getByTestId('session-send')).toBeEnabled());
  expect(uploadCount).toBe(1);
  await act(async () => { conversationClient().emitState('error', '连接出错'); });
  expect(screen.getByTestId('session-send')).toBeEnabled();
  await act(async () => { conversationClient().emitState('ready'); });
  expect(uploadCount).toBe(1);
  await sendAndReturn('receipt-1');
}, 15000);
