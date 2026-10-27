import type { ClientFrame, ServerFrame } from '../protocol/types';

export type ConnectionState = 'idle' | 'connecting' | 'ready' | 'closed' | 'error';

export interface ConnectOptions {
  /** ws:// 或 wss:// 的 /ws/mobile 地址 */
  url: string;
  /** 长期设备 token；首次配对时为空 */
  token?: string;
  /** 一次性配对码；仅在首次配对时提供 */
  pairingCode?: string;
  deviceId: string;
  deviceName: string;
  /**
   * split-channels：control 只收会话元数据和全局审批/提问，
   * conversation 只收订阅的会话流。不传则是单连接 legacy 模式。
   */
  channel?: 'control' | 'conversation';
}

type FrameListener = (frame: ServerFrame) => void;
type StateListener = (state: ConnectionState, detail?: string) => void;

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const HEARTBEAT_MS = 25000;

/**
 * dsh-mobile-v1 的 WebSocket 客户端。
 * 只负责连接、鉴权、心跳、重连和帧分发；业务状态由上层维护。
 */
export class GatewayClient {
  private socket: WebSocket | null = null;
  private frameListeners = new Set<FrameListener>();
  private stateListeners = new Set<StateListener>();
  private options: ConnectOptions | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  connect(options: ConnectOptions): void {
    this.disconnect();
    this.options = options;
    this.stopped = false;
    this.attempt = 0;
    this.open();
  }

  send(frame: ClientFrame): boolean {
    if (!this.socket || this.socket.readyState !== 1) return false;
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  disconnect(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      try {
        socket.close();
      } catch {
        // 关闭失败不影响状态机
      }
    }
    this.emitState('idle');
  }

  private open(): void {
    const options = this.options;
    if (!options) return;

    const protocols = options.pairingCode
      ? ['dsh-mobile-v1', `dsh-pair.${options.pairingCode}`]
      : ['dsh-mobile-v1'];
    const headers: Record<string, string> = { 'X-DSH-Device-ID': options.deviceId };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.channel) headers['X-DSH-Channel'] = options.channel;

    this.emitState('connecting');
    const Socket = WebSocket as unknown as new (
      url: string,
      protocols: string[],
      init: { headers: Record<string, string> },
    ) => WebSocket;

    let socket: WebSocket;
    try {
      socket = new Socket(options.url, protocols, { headers });
    } catch (error) {
      this.emitState('error', error instanceof Error ? error.message : '无法建立连接');
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.startHeartbeat();
    };

    socket.onmessage = (event: { data?: unknown }) => {
      if (typeof event.data !== 'string') return;
      let frame: ServerFrame;
      try {
        frame = JSON.parse(event.data) as ServerFrame;
      } catch {
        return;
      }
      // 配对成功：立刻换成长期 token，一次性配对码绝不能留到重连里用。
      if (frame.kind === 'paired') {
        const token = (frame as { token?: unknown }).token;
        if (typeof token === 'string' && token && this.options) {
          this.options = { ...this.options, token, pairingCode: undefined };
          this.attempt = 0;
        }
      }
      if (frame.kind === 'hello') {
        if ((frame as { authenticated?: boolean }).authenticated && this.options?.pairingCode) {
          this.options = { ...this.options, pairingCode: undefined };
        }
        this.emitState('ready');
      }
      this.frameListeners.forEach((listener) => listener(frame));
    };

    socket.onerror = () => {
      this.emitState('error', '连接出错');
    };

    socket.onclose = (event: { code?: number; reason?: string }) => {
      this.stopHeartbeat();
      this.socket = null;
      if (this.stopped) {
        this.emitState('closed');
        return;
      }
      if (event.code === 4004) {
        this.stopped = true;
        this.emitState('closed', '网关已关闭');
        return;
      }
      if (event.code === 4003) {
        this.emitState('error', '服务端重新开启了鉴权，正在重连');
      } else if (event.code === 1006 || event.code === 1001) {
        this.emitState('error', '连接中断，正在重连');
      } else {
        this.emitState('error', event.reason || `连接关闭（${event.code ?? '未知'}）`);
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    // 配对码是一次性的，重试必然还是失败。这里一次都不重试，直接停。
    if (this.options?.pairingCode) {
      this.stopped = true;
      this.emitState('error', '配对码已被使用或已过期。每个配对码只能用一次，请在服务器上重新运行 dsh-pair');
      return;
    }
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitState(state: ConnectionState, detail?: string): void {
    this.stateListeners.forEach((listener) => listener(state, detail));
  }
}
