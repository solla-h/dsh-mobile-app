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
      const request = frame as unknown as { rpcId?: string; sessionId?: string; toolName?: string };
      if (!request.rpcId || !request.sessionId) return null;
      return add(map, {
        rpcId: request.rpcId,
        sessionId: request.sessionId,
        kind: 'approval',
        toolName: request.toolName,
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
      const resolved = frame as unknown as { rpcId?: string };
      if (!resolved.rpcId) return null;
      return removeByRpcId(map, resolved.rpcId);
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
