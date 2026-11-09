import type { ServerFrame } from './types';

/**
 * 全局待办：审批 / 提问是 agent 停下来等人的唯一原因。
 * 手机不在那个会话里时也必须知道，否则 agent 会一直卡着。
 */
export interface PendingInteraction {
  rpcId: string;
  sessionId: string;
  kind: 'approval' | 'question';
  toolName?: string;
  /**
   * 审批的稳定 id。`approval-response` 必须带它才生效——只拿 rpcId 批不了。
   * 网关在 approval-requested 里就下发了，以前这里没存，等于把批审批的能力丢了。
   */
  approvalId?: string;
  /** 审批理由，直接给用户看；网关优先下发 displayReason。 */
  reason?: string;
  at: number;
}

export type PendingMap = Record<string, PendingInteraction[]>;

const MAX_PER_SESSION = 10;

function add(map: PendingMap, item: PendingInteraction): PendingMap | null {
  const list = map[item.sessionId] ?? [];
  if (list.some((existing) => existing.rpcId === item.rpcId)) return null;
  return { ...map, [item.sessionId]: [...list, item].slice(-MAX_PER_SESSION) };
}

function removeByRpcId(map: PendingMap, rpcId: string): PendingMap | null {
  let touched = false;
  const next: PendingMap = {};
  for (const [sessionId, items] of Object.entries(map)) {
    const kept = items.filter((item) => item.rpcId !== rpcId);
    if (kept.length !== items.length) touched = true;
    if (kept.length > 0) next[sessionId] = kept;
  }
  return touched ? next : null;
}

/**
 * 归约一帧全局待办。返回 null 表示这一帧没有改变任何状态，
 * 调用方可以据此跳过 setState，避免流式事件把列表刷爆。
 */
export function applyPendingFrame(map: PendingMap, frame: ServerFrame, now = Date.now()): PendingMap | null {
  switch (frame.kind) {
    case 'approval-requested': {
      const request = frame as unknown as {
        rpcId?: string;
        sessionId?: string;
        approvalId?: string;
        toolName?: string;
        reason?: string;
        displayReason?: string;
      };
      if (!request.rpcId || !request.sessionId) return null;
      const reason =
        typeof request.displayReason === 'string' && request.displayReason
          ? request.displayReason
          : typeof request.reason === 'string' && request.reason
            ? request.reason
            : undefined;
      return add(map, {
        rpcId: request.rpcId,
        sessionId: request.sessionId,
        kind: 'approval',
        toolName: request.toolName,
        approvalId: request.approvalId,
        reason,
        at: now,
      });
    }
    case 'question-requested': {
      const request = frame as unknown as { rpcId?: string; sessionId?: string };
      if (!request.rpcId || !request.sessionId) return null;
      return add(map, {
        rpcId: request.rpcId,
        sessionId: request.sessionId,
        kind: 'question',
        at: now,
      });
    }
    case 'approval-resolved':
    case 'question-resolved': {
      const resolved = frame as unknown as { rpcId?: string; approvalId?: string };
      if (resolved.rpcId) return removeByRpcId(map, resolved.rpcId);
      // rpcId 缺失时用 approvalId 兜底，别让这条待办永远挂着。
      if (resolved.approvalId) return removeByApprovalId(map, resolved.approvalId);
      return null;
    }
    case 'approval-response':
    case 'question-response': {
      // 只有被拒收（not-pending）才需要在这里清理，正常应答随后会有 resolved。
      const receipt = frame as unknown as { rpcId?: string; accepted?: boolean };
      if (!receipt.rpcId || receipt.accepted !== false) return null;
      return removeByRpcId(map, receipt.rpcId);
    }
    default:
      return null;
  }
}

export function pendingItems(map: PendingMap, sessionId: string): PendingInteraction[] {
  return map[sessionId] ?? [];
}

/**
 * 这个会话是不是「恰好一条待审批」。
 * 语音批审批只在唯一一条时才敢猜——多条时猜错的代价是批错命令。
 */
export function soleApproval(map: PendingMap, sessionId: string): PendingInteraction | undefined {
  const items = map[sessionId] ?? [];
  if (items.length !== 1) return undefined;
  const only = items[0];
  return only.kind === 'approval' ? only : undefined;
}

function removeByApprovalId(map: PendingMap, approvalId: string): PendingMap | null {
  let touched = false;
  const next: PendingMap = {};
  for (const [sessionId, items] of Object.entries(map)) {
    const kept = items.filter((item) => item.approvalId !== approvalId);
    if (kept.length !== items.length) touched = true;
    if (kept.length > 0) next[sessionId] = kept;
  }
  return touched ? next : null;
}

export function pendingTotal(map: PendingMap): number {
  return Object.values(map).reduce((sum, items) => sum + items.length, 0);
}

/** 卡片上的一行摘要，例如「待审批 · write」「待回答 · 2」。 */
export function describePending(items: PendingInteraction[]): string {
  if (items.length === 0) return '';
  const approvals = items.filter((item) => item.kind === 'approval');
  const questions = items.filter((item) => item.kind === 'question');
  const parts: string[] = [];
  if (approvals.length === 1) parts.push(approvals[0].toolName ? '待审批 · ' + approvals[0].toolName : '待审批');
  else if (approvals.length > 1) parts.push('待审批 · ' + approvals.length);
  if (questions.length === 1) parts.push('待回答');
  else if (questions.length > 1) parts.push('待回答 · ' + questions.length);
  return parts.join('　');
}
