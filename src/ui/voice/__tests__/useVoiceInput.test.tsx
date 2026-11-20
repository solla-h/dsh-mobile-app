import { act, renderHook } from '@testing-library/react-native';

import type { SpeechCatalog } from '../../../protocol/speech';
import type { GatewayClient } from '../../../transport/gateway-client';
import { useVoiceInput } from '../useVoiceInput';
import { useVoiceCapture } from '../useVoiceCapture';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'voice-request' }));
jest.mock('../useVoiceCapture', () => ({ useVoiceCapture: jest.fn() }));

const captureMock = useVoiceCapture as jest.MockedFunction<typeof useVoiceCapture>;
const catalog: SpeechCatalog = {
  available: true,
  maxAudioBytes: 1024 * 1024,
  maxDurationSeconds: 60,
  providerId: 'speech-provider',
  language: 'en',
  providers: [{ id: 'speech-provider', name: 'Speech', languages: ['en'], phase: 'ready' }],
};

type ClientStub = {
  send: jest.Mock;
  onState: jest.Mock;
  stateListener?: (state: string) => void;
};

function makeClient(): ClientStub {
  const client: ClientStub = {
    send: jest.fn(() => true),
    onState: jest.fn((listener: (state: string) => void) => {
      client.stateListener = listener;
      return jest.fn();
    }),
  };
  return client;
}

function deferred<T>() {
  const { promise, resolve } = Promise.withResolvers<T>();
  return { promise, resolve };
}

describe('useVoiceInput', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stops a recording when released before asynchronous start completes', async () => {
    const starting = deferred<void>();
    const capture = { start: jest.fn(() => starting.promise), stop: jest.fn(async () => null), cancel: jest.fn() };
    captureMock.mockReturnValue(capture);
    const client = makeClient();
    const { result } = await renderHook(() => useVoiceInput({ client: client as unknown as GatewayClient, catalog, onNotice: jest.fn(), onTranscript: jest.fn() }));

    await act(() => { expect(result.current.begin()).toBe(true); result.current.end(); });
    await act(async () => { starting.resolve(); await starting.promise; await Promise.resolve(); });

    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(result.current.recording).toBe(false);
    expect(result.current.transcribing).toBe(false);
    expect(client.send).not.toHaveBeenCalled();
  });

  it('cancels a pending start and closes its eventual recording without sending it', async () => {
    const starting = deferred<void>();
    const capture = { start: jest.fn(() => starting.promise), stop: jest.fn(async () => null), cancel: jest.fn() };
    captureMock.mockReturnValue(capture);
    const client = makeClient();
    const { result } = await renderHook(() => useVoiceInput({ client: client as unknown as GatewayClient, catalog, onNotice: jest.fn(), onTranscript: jest.fn() }));

    await act(() => { result.current.begin(); result.current.cancel('Cancelled'); });
    await act(async () => { starting.resolve(); await starting.promise; await Promise.resolve(); });

    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(capture.cancel).not.toHaveBeenCalled();
    expect(result.current.recording).toBe(false);
    expect(client.send).not.toHaveBeenCalled();
  });

  it('resets transcription state when the connection disconnects', async () => {
    const capture = {
      start: jest.fn(async () => undefined),
      stop: jest.fn(async () => ({ base64: 'audio', sampleRate: 16000, channels: 1, duration: 1 })),
      cancel: jest.fn(),
    };
    captureMock.mockReturnValue(capture);
    const client = makeClient();
    const onNotice = jest.fn();
    const { result } = await renderHook(() => useVoiceInput({ client: client as unknown as GatewayClient, catalog, onNotice, onTranscript: jest.fn() }));

    await act(() => { result.current.begin(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { result.current.end(); await Promise.resolve(); });
    expect(result.current.transcribing).toBe(true);
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'speech-transcribe', requestId: 'voice-request' }));

    await act(() => { client.stateListener?.('closed'); });

    expect(result.current.transcribing).toBe(false);
    expect(onNotice).toHaveBeenCalled();
  });
});
