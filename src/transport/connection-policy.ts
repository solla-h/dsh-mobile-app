import { tr } from '../i18n';
/**
 * 连接状态机的纯策略：常量、退避和关闭码分类。
 *
 * 这些值是候选值，先在真机上跑一轮再调；不要把它们当成已经实测的时限。
 */

export const HEARTBEAT_MS = 25_000;
export const HANDSHAKE_TIMEOUT_MS = 12_000;
export const PROBE_TIMEOUT_MS = 5_000;
export const NETWORK_DEBOUNCE_MS = 1_500;

/**
 * 连续失败后向上层要一次可能更新过的地址。
 * 候选值：太早会打扰冷启动，太晚用户等得久；真机后再调。
 */
export const REFRESH_AFTER_FAILURES = 2;
export const REFRESH_COOLDOWN_MS = 60_000;

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/** 第 attempt 次重连前的等待；attempt 从 0 开始。 */
export function backoffDelay(attempt: number): number {
  return BACKOFF_MS[Math.min(Math.max(0, attempt), BACKOFF_MS.length - 1)];
}

export interface CloseDecision {
  /** 不再自动重连（凭据/网关状态已经不可恢复） */
  stop: boolean;
  /** 关闭后是否应该走重连阶梯 */
  reconnect: boolean;
  /**
   * 结构化分类。上层靠它决定 UI 姿态，不要改回去匹配 message 文案：
   * 文案会随界面语言翻译，控制流不能跟着变。
   * - shutdown：网关自己关掉了，连接本身是干净的，界面显示「已断开」
   * - reauth：凭据不可恢复，必须回配对页
   * - transient：网络抖动，会自动重连
   */
  kind: 'shutdown' | 'reauth' | 'transient';
  message: string;
}

export type PairingPreflight = 'unknown' | 'ok' | 'timeout' | 'failed';

export interface PairingFailureInput {
  /** WebSocket 是否曾 open（服务端接受了升级）。false 时配对码通常还没被 claim。 */
  opened: boolean;
  closeCode?: number;
  closeReason?: string;
  /** 握手截止定时器触发（没有收到 hello/paired）。 */
  timedOut: boolean;
  /** 对同一主机的 HTTP 预检：ok 说明 DNS/TLS/TCP 基本可达。 */
  preflight: PairingPreflight;
}

export interface PairingFailureDecision {
  message: string;
  /** 同一个配对码可以安全地再试一次（socket 未打开，码未被 claim）。 */
  retryable: boolean;
  /** 需要用户在服务器上重新生成配对码。 */
  regenerate: boolean;
}

/**
 * 区分「配对码失效」和「网络/代理连不上」。
 *
 * 旧实现把任何认证前失败都写成「配对码已被使用或已过期」，手机开了
 * VPN/VPN 时会把网络问题误报成码的问题。这里只在 WebSocket 真的 open
 * 过（服务端接受了升级、但没完成 hello）时才判定码可能失效；socket 都
 * 没打开时，用 HTTP 预检结果把网络/代理和握手拒绝分开。
 */
export function classifyPairingFailure(input: PairingFailureInput): PairingFailureDecision {
  if (input.closeCode === 4004) {
    return {
      message: tr("网关已关闭，请先在服务器上启用移动网关"),
      retryable: false,
      regenerate: false,
    };
  }
  if (input.closeCode === 4003) {
    return {
      message: tr("网关要求重新鉴权，请重新配对：在服务器上重新生成配对码"),
      retryable: false,
      regenerate: true,
    };
  }
  if (input.opened) {
    return {
      message:
        tr("连接已建立但配对未完成：配对码可能已被使用或过期。请在服务器上重新生成配对码后重新配对。"),
      retryable: false,
      regenerate: true,
    };
  }
  if (input.preflight === 'failed') {
    return {
      message:
        tr("连不上网关：手机网络或代理阻断了连接。请关闭 VPN/代理后重试；仍失败请检查 Wi-Fi/蜂窝网络。"),
      retryable: true,
      regenerate: false,
    };
  }
  if (input.preflight === 'timeout' || input.timedOut) {
    return {
      message:
        tr("连接网关超时：请检查手机网络/VPN/代理后重试；配对码可能仍在有效期内。"),
      retryable: true,
      regenerate: false,
    };
  }
  return {
    message:
      tr("网关拒绝或未能完成连接：配对码可能已失效，也可能是代理拦截了 WebSocket。请先关闭代理重试；仍失败就在服务器上重新生成配对码。"),
    retryable: true,
    regenerate: false,
  };
}

/**
 * 4003 有两个来源：管理面重新开启鉴权、设备被撤销。两者都应该停，
 * 但提示不同；不要统一写成「设备授权已失效」。
 * 4004 是网关被关闭，也不该重连。
 * 1011 是会话 follow 失败，网络恢复后可以重试。
 */
export function classifyClose(code?: number, reason?: string): CloseDecision {
  if (code === 4004) {
    return {
      stop: true,
      reconnect: false,
      kind: 'shutdown',
      message: tr("网关已关闭"),
    };
  }
  if (code === 4003) {
    return {
      stop: true,
      reconnect: false,
      kind: 'reauth',
      message:
        reason === 'device revoked'
          ? tr("设备授权已被撤销，请重新配对")
          : tr("网关重新启用了鉴权，请重新配对"),
    };
  }
  if (code === 1006 || code === 1001) {
    return {
      stop: false,
      reconnect: true,
      kind: 'transient',
      message: tr("连接中断，正在重连"),
    };
  }
  return {
    stop: false,
    reconnect: true,
    kind: 'transient',
    message: reason || tr("连接关闭（{0}）", [code ?? tr("未知")]),
  };
}
