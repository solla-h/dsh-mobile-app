/**
 * 连接状态机的纯策略：常量、退避和关闭码分类。
 *
 * 这些值是候选值，先在真机上跑一轮再调；不要把它们当成已经实测的时限。
 */

export const HEARTBEAT_MS = 25_000;
export const HANDSHAKE_TIMEOUT_MS = 12_000;
export const PROBE_TIMEOUT_MS = 5_000;
export const NETWORK_DEBOUNCE_MS = 1_500;

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
  message: string;
}

/**
 * 4003 有两个来源：管理面重新开启鉴权、设备被撤销。两者都应该停，
 * 但提示不同；不要统一写成「设备授权已失效」。
 * 4004 是网关被关闭，也不该重连。
 * 1011 是会话 follow 失败，网络恢复后可以重试。
 */
export function classifyClose(code?: number, reason?: string): CloseDecision {
  if (code === 4004) {
    return { stop: true, reconnect: false, message: '网关已关闭' };
  }
  if (code === 4003) {
    return {
      stop: true,
      reconnect: false,
      message:
        reason === 'device revoked'
          ? '设备授权已被撤销，请重新配对'
          : '网关重新启用了鉴权，请重新配对',
    };
  }
  if (code === 1006 || code === 1001) {
    return { stop: false, reconnect: true, message: '连接中断，正在重连' };
  }
  return {
    stop: false,
    reconnect: true,
    message: reason || `连接关闭（${code ?? '未知'}）`,
  };
}
