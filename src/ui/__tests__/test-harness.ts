/**
 * 真 App UI 旅程测试的共享底座（只给 src/ui/__tests__ 用）。
 *
 * 唯一被替换的接缝是传输层：FakeGatewayClient 顶掉真 WebSocket 客户端，
 * App / SessionScreen / FocusHome 全部跑真实现。网关行为用「收到什么帧 →
 * 推回什么帧」的脚本描述；存储走真实 storage 模块 + 内存 native 适配器：
 * SecureStore 用下面导出的 secureStoreMock()（各测试文件在 jest.mock 里接上），
 * FileSystem 用 jest-expo 自带的内存实现。
 *
 * 这些测试是「本机 UI 集成」，不是真机 E2E：真机/真网关链路的结论不能由此得出。
 */
import type { HistoryEventFrame, ClientFrame, PairingPayload, ServerFrame, SessionItem } from '../../protocol/types';
import type { ConnectOptions, ConnectionState } from '../../transport/gateway-client';

export interface TransportScript {
  /** connect() 之后同步执行：脚本在这里推 paired / hello / error 等开场帧。 */
  onConnect?: (client: FakeGatewayClient, options: ConnectOptions) => void;
  /** 客户端写帧成功时执行；脚本在这里按帧推响应。 */
  onSend?: (client: FakeGatewayClient, frame: ClientFrame) => void;
}

let activeScript: TransportScript | null = null;

export function setTransportScript(script: TransportScript | null): void {
  activeScript = script;
}

/** SecureStore 的内存实现；测试可以预埋 / 检查键值，走真实 gateway-store 读写逻辑。 */
export const secureStoreMemory = new Map<string, string>();

export function secureStoreMock() {
  return {
    getItemAsync: jest.fn(async (key: string) => secureStoreMemory.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      secureStoreMemory.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      secureStoreMemory.delete(key);
    }),
  };
}

let uuidCounter = 0;

/** 确定性 UUID：requestId 依次为 uuid-1、uuid-2…，断言可预测。 */
export function cryptoMock() {
  return {
    randomUUID: () => `uuid-${(uuidCounter += 1)}`,
  };
}

/**
 * expo-audio 的 JS 模块在 import 期就会摸 AudioPlayer/AudioRecorder 的原型，
 * jest-expo 的 native mock 里没有这两个类，直接 require 会炸；这里给录音链路
 * 一个最小适配器（本套旅程不录音，只保证 App 可挂载）。
 */
export function audioMock() {
  const stream = {
    isStreaming: false,
    start: jest.fn(async () => undefined),
    stop: jest.fn(),
    startFileRecordingAsync: jest.fn(async () => undefined),
    stopFileRecordingAsync: jest.fn(async () => ({
      uri: 'file:///mock/cache/voice.wav',
      sampleRate: 16000,
      channels: 1,
      encoding: 'int16',
      duration: 0,
    })),
  };
  return {
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: false })),
    useAudioStream: () => ({ stream }),
  };
}

type FrameListener = (frame: ServerFrame) => void;
type StateListener = (state: ConnectionState, detail?: string) => void;

/**
 * 带帧监听/状态监听两条接口的假客户端，语义对齐真 GatewayClient：
 * connect() 先 connecting；收到 hello 才 ready 并开始收 send()；hello/paired
 * 的推帧顺序与真机一致（paired 换 token、hello 定案）。
 * 两个实例（conversation + control）各自独立，互不串帧。
 */
export class FakeGatewayClient {
  static instances: FakeGatewayClient[] = [];

  static reset(): void {
    FakeGatewayClient.instances = [];
    activeScript = null;
  }

  private frameListeners = new Set<FrameListener>();
  private stateListeners = new Set<StateListener>();
  private currentState: ConnectionState = 'idle';
  /** socket 是否「打开并完成握手」：决定 send() 返回 true/false（离线语义）。 */
  private accepting = false;

  /** 最近一次 connect 的参数（disconnect 后保留，真客户端同样保留到下次 connect）。 */
  options: ConnectOptions | null = null;
  /** 写进「socket」的全部帧，按顺序；供测试断言真实发送内容。 */
  sent: ClientFrame[] = [];

  constructor() {
    FakeGatewayClient.instances.push(this);
  }

  get state(): ConnectionState {
    return this.currentState;
  }

  get canSend(): boolean {
    return this.accepting;
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  connect(options: ConnectOptions): void {
    this.options = options;
    this.sent = [];
    this.accepting = false;
    this.emitState('connecting');
    activeScript?.onConnect?.(this, options);
  }

  send(frame: ClientFrame): boolean {
    if (!this.accepting) return false;
    this.sent.push(frame);
    activeScript?.onSend?.(this, frame);
    return true;
  }

  disconnect(): void {
    this.accepting = false;
    this.emitState('idle');
  }

  /** 测试脚本推服务端帧；hello 会像真客户端一样先把状态翻到 ready。 */
  emit(frame: ServerFrame): void {
    if (frame.kind === 'hello') {
      this.accepting = true;
      this.emitState('ready');
    }
    if (frame.kind === 'paired') {
      const token = (frame as { token?: unknown }).token;
      if (typeof token === 'string' && token && this.options) {
        this.options = { ...this.options, token, pairingCode: undefined };
      }
    }
    for (const listener of Array.from(this.frameListeners)) listener(frame);
  }

  emitState(state: ConnectionState, detail?: string): void {
    this.currentState = state;
    for (const listener of Array.from(this.stateListeners)) listener(state, detail);
  }
}

/** App 里 channel 未指定（会话流）的那条连接。 */
export function conversationClient(): FakeGatewayClient {
  const found = FakeGatewayClient.instances.find((entry) => entry.options?.channel !== 'control');
  if (!found) throw new Error('找不到 conversation 连接（App 还没 connect？）');
  return found;
}

/** App 里的第二条连接：channel=control（审批/定时任务/插件管理走它）。 */
export function controlClient(): FakeGatewayClient {
  const found = FakeGatewayClient.instances.find((entry) => entry.options?.channel === 'control');
  if (!found) throw new Error('找不到 control 连接（App 还没 connect？）');
  return found;
}

export function resetHarness(): void {
  FakeGatewayClient.reset();
  secureStoreMemory.clear();
  uuidCounter = 0;
}

export const TEST_GATEWAY_ID = 'gw:test-gateway';

export const TEST_SESSION_ID = 's1';

export function sessionFixture(overrides: Partial<SessionItem> = {}): SessionItem {
  return {
    sessionId: TEST_SESSION_ID,
    updatedAt: Date.now(),
    running: false,
    blank: false,
    cwd: '/home/dsh/workspace',
    projections: { asOfSeq: 3, values: { title: '测试会话' } },
    ...overrides,
  };
}

/** 首屏历史：一条用户消息 + 一条助手回复。 */
export function historyEvents(): HistoryEventFrame[] {
  const now = Date.now();
  return [
    {
      seq: 1,
      time: now - 60_000,
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '上一条问的' }] },
    },
    {
      seq: 2,
      time: now - 59_000,
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '上一条答的' }] } },
    },
  ];
}

/** 与真网关 hello 同形状；protocol 3 = compatibility.json 里验证过的版本。 */
export function helloFrame(extra: Record<string, unknown> = {}): ServerFrame {
  return {
    kind: 'hello',
    protocol: 3,
    capabilities: ['file-downloads'],
    authenticated: true,
    gatewayId: 'test-gateway',
    gatewayName: '测试网关',
    device: { id: 'dev-1', name: 'Android' },
    ...extra,
  } as ServerFrame;
}

export function pairedFrame(token = 'token-1'): ServerFrame {
  return { kind: 'paired', token, device: { id: 'dev-1', name: 'Android' } };
}

/** ASCII 载荷的 Base64URL 编码（协议里配对串就是这个形状）。 */
export function base64UrlOfJson(value: unknown): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const text = JSON.stringify(value);
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < text.length; index += 1) {
    buffer = (buffer << 8) | text.charCodeAt(index);
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += alphabet[(buffer >> bits) & 0x3f];
    }
  }
  if (bits > 0) out += alphabet[(buffer << (6 - bits)) & 0x3f];
  return out;
}

export function pairingPayloadText(overrides: Partial<PairingPayload> = {}): string {
  return base64UrlOfJson({
    version: 2,
    publicUrl: 'ws://127.0.0.1:3080/ws/mobile',
    pairingCode: 'pair-code-1',
    expiresAt: Date.now() + 5 * 60_000,
    gatewayId: 'test-gateway',
    gatewayName: '测试网关',
    ...overrides,
  });
}

export interface GatewayScriptOptions {
  sessions: SessionItem[];
  /** 每个会话的首屏历史；缺省空历史。 */
  history?: Record<string, HistoryEventFrame[]>;
  /** 收到 message 帧后脚本回推的助手正文。 */
  reply?: string;
}

/**
 * 正常在线网关的脚本：会话列表、历史、消息回执 + 回复。
 *
 * 响应统一排在微任务里回推：真网关的回包永远晚于 send() 返回，
 * 同步回推会让 `sent` 回执先于 outbox.track 到达，留一条永远「发送中」的
 * 待发消息（并挂一个 20s 的未确认定时器）。
 */
export function scriptGateway(options: GatewayScriptOptions): TransportScript {
  let seq = 100;
  return {
    onConnect(client, connectOptions) {
      if (connectOptions.channel === 'control') {
        // control 只看元数据/待办；给个 hello 让 App 的发目录请求有落点。
        client.emit(helloFrame());
        return;
      }
      if (!connectOptions.token) client.emit(pairedFrame());
      client.emit(helloFrame());
    },
    onSend(client, frame) {
      queueMicrotask(() => {
        if (frame.type === 'sessions') {
          client.emit({ kind: 'sessions', items: options.sessions });
          return;
        }
        if (frame.type === 'workspaces') {
          client.emit({
            kind: 'workspaces',
            items: [],
            archivedSessionIds: [],
            pinnedSessionIds: [],
          });
          return;
        }
        if (frame.type === 'history') {
          const request = frame as { sessionId?: string };
          client.emit({
            kind: 'history',
            sessionId: request.sessionId ?? TEST_SESSION_ID,
            events: options.history?.[request.sessionId ?? ''] ?? [],
            hasMore: false,
          });
          return;
        }
        if (frame.type === 'message') {
          const request = frame as { requestId?: string; sessionId?: string };
          client.emit({ kind: 'sent', requestId: request.requestId, sessionId: request.sessionId });
          if (options.reply) {
            seq += 1;
            client.emit({
              kind: 'event',
              sessionId: request.sessionId ?? TEST_SESSION_ID,
              seq,
              time: Date.now(),
              event: { type: 'assistant/message', text: options.reply },
            });
          }
        }
      });
    },
  };
}
