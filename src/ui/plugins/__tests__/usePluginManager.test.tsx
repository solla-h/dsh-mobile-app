import { act, renderHook } from '@testing-library/react-native';

import type { GatewayClient } from '../../../transport/gateway-client';
import { usePluginManager } from '../usePluginManager';

let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `plugin-request-${++mockUuid}` }));

type FrameListener = (frame: unknown) => void;

type ClientStub = {
  send: jest.Mock;
  onFrame: jest.Mock;
  onState: jest.Mock;
  listener?: FrameListener;
  emit: (frame: unknown) => void;
};
function makeClient(): ClientStub {
  const client: ClientStub = {
    send: jest.fn(() => true),
    onFrame: jest.fn((listener: FrameListener) => {
      client.listener = listener;
      return jest.fn();
    }),
    onState: jest.fn(() => jest.fn()),
    emit: (frame) => client.listener?.(frame),
  };
  return client;
}

async function renderManager(client: ClientStub) {
  const hook = await renderHook(() => usePluginManager(client as unknown as GatewayClient, true));
  jest.clearAllTimers();
  return hook;
}

describe('usePluginManager', () => {
  beforeEach(() => {
    mockUuid = 0;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('correlates overlapping requests by requestId, regardless of response order', async () => {
    const client = makeClient();
    const { result } = await renderManager(client);
    let first!: Promise<Record<string, unknown>>;
    let second!: Promise<Record<string, unknown>>;

    await act(() => {
      first = result.current.request('plugin-inspect', { spec: 'first' });
      second = result.current.request('plugin-inspect', { spec: 'second' });
    });
    const sent = client.send.mock.calls.map(([frame]) => frame as { requestId: string; spec: string });
    expect(sent).toEqual([
      { type: 'plugin-inspect', requestId: 'plugin-request-1', spec: 'first' },
      { type: 'plugin-inspect', requestId: 'plugin-request-2', spec: 'second' },
    ]);

    await act(async () => {
      client.emit({ kind: 'plugin-result', requestId: sent[1].requestId, result: { spec: 'second' } });
      client.emit({ kind: 'plugin-result', requestId: 'unrelated-request', result: { spec: 'wrong' } });
      client.emit({ kind: 'plugin-result', requestId: sent[0].requestId, result: { spec: 'first' } });
    });

    await expect(second).resolves.toMatchObject({ result: { spec: 'second' } });
    await expect(first).resolves.toMatchObject({ result: { spec: 'first' } });
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it('associates install logs with their request and caps history at 200 entries', async () => {
    const client = makeClient();
    const { result } = await renderManager(client);
    let installation!: Promise<unknown>;
    await act(() => { installation = result.current.install('example/plugin'); });
    const installFrame = client.send.mock.calls[0][0] as { requestId: string };

    await act(() => client.emit({ kind: 'plugin-install-state', requestId: installFrame.requestId, phase: 'installing', attempt: { registry: 'main', index: 1, total: 2 } }));
    await act(() => {
      client.emit({ kind: 'plugin-install-log', requestId: 'another-install', text: 'unrelated' });
      for (let index = 0; index < 205; index += 1) {
        client.emit({ kind: 'plugin-install-log', requestId: installFrame.requestId, stream: 'stdout', text: `line-${index}` });
      }
    });
    expect(result.current.installProgress).toMatchObject({
      requestId: installFrame.requestId,
      phase: 'installing',
      attempt: { registry: 'main', index: 1, total: 2 },
    });
    expect(result.current.installProgress?.logs).toHaveLength(200);
    expect(result.current.installProgress?.logs[0]).toMatchObject({ text: 'line-5', requestId: installFrame.requestId });
    expect(result.current.installProgress?.logs.at(-1)).toMatchObject({ text: 'line-204', requestId: installFrame.requestId });
    expect(result.current.installProgress?.logs.some((log) => log.text === 'unrelated')).toBe(false);
    await act(() => client.emit({ kind: 'plugin-result', requestId: installFrame.requestId, result: { ok: true } }));
    await expect(installation).resolves.toMatchObject({ changed: false });
  });
});
