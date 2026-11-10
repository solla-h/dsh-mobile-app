import * as Network from 'expo-network';
import { AppState } from 'react-native';

import type { ClientFrame, ServerFrame } from '../protocol/types';
import {
  HANDSHAKE_TIMEOUT_MS,
  HEARTBEAT_MS,
  NETWORK_DEBOUNCE_MS,
  PROBE_TIMEOUT_MS,
  REFRESH_AFTER_FAILURES,
  REFRESH_COOLDOWN_MS,
  backoffDelay,
  classifyClose,
  classifyPairingFailure,
  type PairingFailureInput,
  type PairingPreflight,
} from './connection-policy';
import { tr } from '../i18n';

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
  /** 连续失败后向上层要一个可能更新过的地址；没有地址簿时返回 undefined。 */
  refreshUrl?: () => Promise<string | undefined>;
}

type FrameListener = (frame: ServerFrame) => void;
type StateListener = (state: ConnectionState, detail?: string) => void;

/**
 * dsh-mobile-v1 的 WebSocket 客户端。
 * 只负责连接、鉴权、心跳、重连和帧分发；业务状态由上层维护。
 *
 * 三条时间线：
 * - 握手截止：open() 后 12s 内没有 hello/paired 就重连；
 * - 心跳：后台每 25s 一次，超过两轮没有任何帧判假死；
 * - 探活：回前台/切网恢复后 5s 内没有任何帧就主动重连。
 * 这些是候选值，真机网络测试后再调。
 */
export class GatewayClient {
  private socket: WebSocket | null = null;
  private frameListeners = new Set<FrameListener>();
  private stateListeners = new Set<StateListener>();
  private options: ConnectOptions | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private networkTimer: ReturnType<typeof setTimeout> | null = null;
  private probeStartedAt = 0;
  private stopped = true;
  /** 最近一次收到任何帧的时间；心跳用来判断连接是不是已经假死。 */
  private lastFrameAt = 0;
  /** 网络状态监听；断网/恢复时立刻调整重连节奏。 */
  private unwatchNetwork: { remove: () => void } | null = null;
  private online = true;
  /** 第一次网络回调只是建立基线；之后任何 online 事件都可能是 WiFi↔5G/换 AP。 */
  private networkInitialized = false;
  /** 前后台监听；后台期间 JS 定时器会被挂起，回前台不能拿旧时间戳判假死。 */
  private unwatchAppState: { remove: () => void } | null = null;
  /** 最近一次广播的连接状态；订阅前就能查询（onState 不回放当前状态）。 */
  private lastState: ConnectionState = 'idle';
  /** 地址簿刷新：冷却与在途标记；4003/配对码等终止分支不会走到这里。 */
  private lastRefreshAt = 0;
  private refreshing = false;
  /** 当前 socket 是否真的 open 过；配对失败时用来区分「码被用掉」和「根本没连上」。 */
  private socketOpened = false;
  /** 配对前对 wss:// 主机的 HTTP 预检结果。 */
  private pairingPreflight: PairingPreflight = 'unknown';
  private lastPairingFailure: PairingFailureInput | null = null;

  get state(): ConnectionState {
    return this.lastState;
  }

  /** 能否写入当前连接；暂时的 error 提示不一定代表连接已经关闭。 */
  get canSend(): boolean {
    return this.socket?.readyState === 1;
  }

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
    this.lastFrameAt = 0;
    this.socketOpened = false;
    this.pairingPreflight = 'unknown';
    this.lastPairingFailure = null;
    this.watchNetwork();
    this.watchForeground();
    if (options.pairingCode) {
      const current = options;
      void this.probePairingTarget(current).finally(() => {
        if (!this.stopped && this.options === current) this.open();
      });
    } else {
      this.open();
    }
  }

  send(frame: ClientFrame): boolean {
    const socket = this.socket;
    if (!socket || !this.canSend) return false;
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch {
      // socket 在 readyState 检查和 send 之间关掉时，RN 可能直接抛。
      return false;
    }
  }

  disconnect(): void {
    this.stopped = true;
    this.clearTimers();
    this.unwatchNetwork?.remove();
    this.unwatchNetwork = null;
    this.unwatchAppState?.remove();
    this.unwatchAppState = null;
    this.closeSocket();
    this.socketOpened = false;
    this.lastPairingFailure = null;
    this.pairingPreflight = 'unknown';
    this.emitState('idle');
  }

  /**
   * 配对前用普通 HTTP 探一下同一主机：拿到任何 HTTP 响应都说明 DNS/TLS/TCP
   * 基本可达，WS 仍未打开就更可能是网关拒绝了升级（例如配对码无效）。
   * 只对 wss:// 公网入口做，避免 Android cleartext 策略误伤局域网 ws://。
   */
  private async probePairingTarget(options: ConnectOptions): Promise<void> {
    if (!options.url.startsWith('wss://') || typeof fetch !== 'function') {
      this.pairingPreflight = 'unknown';
      return;
    }
    const httpUrl = `https://${options.url.slice('wss://'.length)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(httpUrl, { method: 'GET', signal: controller.signal });
      this.pairingPreflight = 'ok';
    } catch (error) {
      this.pairingPreflight =
        error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'failed';
    } finally {
      clearTimeout(timer);
    }
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

    // 任何路径重新 open 之前先收掉旧 socket，避免两个连接同时活着。
    if (this.socket) {
      this.clearHandshake();
      this.clearProbe();
      this.clearNetworkTimer();
      this.stopHeartbeat();
      this.closeSocket();
    }
    this.socketOpened = false;
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
      this.lastPairingFailure = {
        opened: false,
        timedOut: false,
        preflight: this.pairingPreflight,
      };
      this.emitState('error', error instanceof Error ? error.message : tr("无法建立连接"));
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.startHandshake(socket);

    socket.onopen = () => {
      if (this.socket !== socket) {
        try {
          socket.close();
        } catch {
          // 已经被新连接替换，关不掉也无所谓
        }
        return;
      }
      // 注意：这里不能把 attempt 清零。只有真正收到 hello/paired 才算握手成功，
      // 否则一个「接受后立刻断」的代理会让退避永远停在 1s。
      this.socketOpened = true;
      this.lastFrameAt = Date.now();
      this.startHeartbeat();
    };

    socket.onmessage = (event: { data?: unknown }) => {
      if (this.socket !== socket) return;
      if (typeof event.data !== 'string') return;
      let frame: ServerFrame;
      try {
        frame = JSON.parse(event.data) as ServerFrame;
      } catch {
        return;
      }
      this.lastFrameAt = Date.now();
      // 配对成功：立刻换成长期 token，一次性配对码绝不能留到重连里用。
      if (frame.kind === 'paired') {
        const token = (frame as { token?: unknown }).token;
        if (typeof token === 'string' && token && this.options) {
          this.options = { ...this.options, token, pairingCode: undefined };
        }
        // 不在这里清握手截止：真正可用以 hello 为准；paired 只负责换 token。
      }
      if (frame.kind === 'hello') {
        this.clearHandshake();
        this.attempt = 0;
        if ((frame as { authenticated?: boolean }).authenticated && this.options?.pairingCode) {
          this.options = { ...this.options, pairingCode: undefined };
        }
        this.emitState('ready');
      }
      // OBS-1：一个业务 handler 抛异常不能拖垮其它监听者，也不能炸回
      // socket 回调（那样会带着整条分发链一起死）。逐个隔离。
      this.frameListeners.forEach((listener) => {
        try {
          listener(frame);
        } catch (error) {
          console.warn('[gateway] frame listener failed', frame.kind, error);
        }
      });
    };

    socket.onerror = () => {
      if (this.socket !== socket) return;
      this.emitState('error', tr("连接出错"));
    };

    socket.onclose = (event: { code?: number; reason?: string }) => {
      // 已经被 disconnect()、探活或握手截止换掉的旧 socket，不许再动状态机。
      if (this.socket !== socket) return;
      const opened = this.socketOpened;
      this.socketOpened = false;
      this.lastPairingFailure = {
        opened,
        closeCode: event.code,
        closeReason: event.reason,
        timedOut: false,
        preflight: this.pairingPreflight,
      };
      this.clearHandshake();
      this.clearProbe();
      this.stopHeartbeat();
      this.socket = null;
      if (this.stopped) {
        this.emitState('closed');
        return;
      }
      const decision = classifyClose(event.code, event.reason);
      if (decision.stop) {
        this.stopped = true;
        this.clearTimers();
        this.emitState(decision.message === '网关已关闭' ? 'closed' : 'error', decision.message);
        return;
      }
      this.emitState('error', decision.message);
      if (decision.reconnect) this.scheduleReconnect();
    };
  }

  /** 从 socket 创建开始计时；TCP 挂住和 hello 不来都算握手失败。 */
  private startHandshake(socket: WebSocket): void {
    this.clearHandshake();
    this.handshakeTimer = setTimeout(() => {
      this.handshakeTimer = null;
      if (this.socket !== socket) return;
      this.lastPairingFailure = {
        opened: this.socketOpened,
        timedOut: true,
        preflight: this.pairingPreflight,
      };
      this.dropSocket(tr("连接超时，正在重连"));
      this.scheduleReconnect();
    }, HANDSHAKE_TIMEOUT_MS);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.options?.pairingCode) {
      const failure = this.lastPairingFailure ?? {
        opened: this.socketOpened,
        timedOut: false,
        preflight: this.pairingPreflight,
      };
      const decision = classifyPairingFailure(failure);
      // socket 从未打开 = 配对码还没被 claim，同一个码可以安全重试一次
      // （手机代理抖动很常见）；已打开但没完成 hello 才认定码可能失效。
      if (decision.retryable && this.attempt < 1) {
        this.attempt += 1;
        this.emitState('error', tr("{0}（正在重试一次）", [decision.message]));
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.open();
        }, 1500);
        return;
      }
      this.stopped = true;
      this.emitState('error', decision.message);
      return;
    }
    this.maybeRefreshUrl();
    // 已经有一个在等，就别叠第二个定时器。
    if (this.reconnectTimer) return;
    const delay = backoffDelay(this.attempt);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  /**
   * 地址簿刷新：只在连续失败、有网、冷却到期且没有在途刷新时触发。
   * 不阻塞原有退避——刷新失败时用户仍然按原来的节奏重试。
   */
  private maybeRefreshUrl(): void {
    const options = this.options;
    if (this.stopped || !options?.refreshUrl || this.refreshing) return;
    if (this.attempt < REFRESH_AFTER_FAILURES - 1) return;
    if (!this.online) return;
    if (Date.now() - this.lastRefreshAt < REFRESH_COOLDOWN_MS) return;

    this.refreshing = true;
    // 尝试开始就计冷却：离线/失败时也不会被下一轮立刻再打一次。
    this.lastRefreshAt = Date.now();
    void Promise.resolve()
      .then(() => options.refreshUrl!())
      .then((url) => {
        this.refreshing = false;
        if (this.stopped || this.options !== options) return;
        if (typeof url !== 'string' || url === '' || url === options.url) return;
        this.options = { ...options, url };
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.attempt = 0;
        this.open();
      })
      .catch(() => {
        this.refreshing = false;
      });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      // 手机切网/进电梯时 TCP 常常半开：socket 还是 OPEN，但再也收不到东西。
      // 网关每 ping 都会回 pong，超过两轮没有任何帧就判定假死，主动断开重连。
      if (this.lastFrameAt && Date.now() - this.lastFrameAt > HEARTBEAT_MS * 2) {
        this.dropSocket(tr("连接无响应，正在重连"));
        this.scheduleReconnect();
        return;
      }
      this.send({ type: 'ping' });
    }, HEARTBEAT_MS);
  }

  /**
   * 回前台/切网恢复后的快速探活。
   * 发一个 ping，PROBE_TIMEOUT_MS 内收到任何帧都算活着；否则主动断开重连。
   */
  private probe(): void {
    if (this.stopped) return;
    const socket = this.socket;
    if (!socket) {
      if (this.reconnectTimer) return;
      this.attempt = 0;
      this.open();
      return;
    }
    if (socket.readyState === 0) {
      // 正在握手：有截止定时器就让它跑完，别在回前台时把它掐掉。
      if (this.handshakeTimer) return;
      this.dropSocket(tr("连接已断开，正在重连"));
      this.scheduleReconnect();
      return;
    }
    if (socket.readyState !== 1) {
      this.dropSocket(tr("连接已断开，正在重连"));
      this.scheduleReconnect();
      return;
    }
    this.clearProbe();
    this.probeStartedAt = Date.now();
    this.send({ type: 'ping' });
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      if (this.socket !== socket) return;
      if (this.lastFrameAt >= this.probeStartedAt) {
        // CONN-3：探活通过 = 连接是真的活着的。若之前被误判成 error
        // （如系统报离线但 USB/adb 通道仍通），这里要恢复成 ready——
        // 否则横幅会僵在「设备已离线」直到下一次真重连。
        // 只在 error 上恢复；connecting 仍等 hello 定案，别抢跑。
        if (this.lastState === 'error') this.emitState('ready');
        return;
      }
      this.dropSocket(tr("连接无响应，正在重连"));
      this.scheduleReconnect();
    }, PROBE_TIMEOUT_MS);
  }

  /**
   * 系统层面的网络状态：断网时不用按退避阶梯空转，
   * 恢复时防抖 1.5s 再探活/重连，避免 WiFi/5G 切换瞬间打出一串连接。
   */
  private watchNetwork(): void {
    if (this.unwatchNetwork) return;
    this.networkInitialized = false;
    try {
      this.unwatchNetwork = Network.addNetworkStateListener((state) => {
        const online = state.isConnected !== false && state.isInternetReachable !== false;
        const wasOnline = this.online;
        this.online = online;
        if (this.stopped) return;
        const first = !this.networkInitialized;
        this.networkInitialized = true;
        if (!online) {
          this.clearNetworkTimer();
          // CONN-3：系统判离线但 socket 还 OPEN（USB/adb 通道、局域网无外网、
          // 系统误判）时不要直接把状态打成离线——先探活定真伪。探得动就继续
          // 当好着用；真死了探活失败会走 dropSocket + 重连，横幅照样会出。
          // 不这样做的后果：横幅僵在「设备已离线」直到下一次真重连。
          const socket = this.socket;
          if (socket && socket.readyState === 1) {
            this.probe();
            return;
          }
          if (first || wasOnline) this.emitState('error', tr("设备已离线，等待网络恢复"));
          return;
        }
        // 第一次 online 回调只建立基线；之后任何 online 事件都当成一次网络切换。
        // WiFi→5G 时 isConnected 可能一直是 true，不能只看 offline→online；
        // 也不能只看 type（WiFi 断开后 type 可能仍是 WIFI）。
        if (first) return;
        this.clearNetworkTimer();
        this.networkTimer = setTimeout(() => {
          this.networkTimer = null;
          if (this.stopped) return;
          const socket = this.socket;
          if (!socket) {
            if (this.reconnectTimer) {
              clearTimeout(this.reconnectTimer);
              this.reconnectTimer = null;
            }
            this.attempt = 0;
            this.open();
            return;
          }
          if (socket.readyState === 1) {
            this.probe();
            return;
          }
          this.dropSocket(tr("网络已恢复，正在重连"));
          this.scheduleReconnect();
        }, NETWORK_DEBOUNCE_MS);
      });
    } catch {
      this.unwatchNetwork = null;
    }
  }

  /**
   * 回到前台时不要拿后台期间的旧 lastFrameAt 判假死；
   * 但也别直接把基准重置成现在——那会把「已经半死」的连接当成健康。
   * 统一走 probe()：5s 内没有帧才重连。
   */
  private watchForeground(): void {
    if (this.unwatchAppState) return;
    try {
      this.unwatchAppState = AppState.addEventListener('change', (next) => {
        if (next !== 'active' || this.stopped || !this.online) return;
        if (!this.socket) {
          // 回前台时别让 30s 的退避继续挂着：用户已经在看屏幕了，立刻试一次。
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          this.attempt = 0;
          this.open();
          return;
        }
        this.probe();
      });
    } catch {
      this.unwatchAppState = null;
    }
  }

  private dropSocket(message: string): void {
    this.clearHandshake();
    this.clearProbe();
    this.stopHeartbeat();
    this.closeSocket();
    this.emitState('error', message);
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      socket.close();
    } catch {
      // 关闭失败不影响状态机
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearHandshake(): void {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  private clearProbe(): void {
    if (this.probeTimer) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
  }

  private clearNetworkTimer(): void {
    if (this.networkTimer) {
      clearTimeout(this.networkTimer);
      this.networkTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    this.clearHandshake();
    this.clearProbe();
    this.clearNetworkTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitState(state: ConnectionState, detail?: string): void {
    this.lastState = state;
    // OBS-1：状态监听同样逐个隔离——某个页面的 setState 异常不该掐断其余订阅者。
    this.stateListeners.forEach((listener) => {
      try {
        listener(state, detail);
      } catch (error) {
        console.warn('[gateway] state listener failed', state, error);
      }
    });
  }
}
