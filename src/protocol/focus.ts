/**
 * 首页 2x2 聚焦网格的选片。
 *
 * 最初只收「待审批 / 进行中」，结果 agent 一答完卡片就消失，用户反而找不到入口——
 * 这个网格的本意是「快速回到刚才那几个会话」，所以现在**常驻最近 4 个会话**，
 * 只是把需要你出手的排在前面：待审批 > 进行中 > 刚聊过的。
 *
 * 子会话（带 parentSessionId）一律剔除：那是 agent 自己派出去干活的，
 * 跟父会话并排出现会让网格凭空翻倍，而且点进去也没有人在等。
 */

import type { OutlineMap } from './outline-cache';
import { lastResponse } from './outline-cache';
import type { PendingMap } from './pending';
import { pendingItems } from './pending';
import type { SessionItem } from './types';

export interface FocusEntry {
  sessionId: string;
  /** 空串表示服务端还没给标题，兜底文案由 UI 决定 */
  title: string;
  /** 毫秒时间戳，原样透传（服务端给的就是毫秒） */
  updatedAt: number;
  running: boolean;
  /** 待办条数；0 表示这张卡只是「还在跑」 */
  pendingCount: number;
  /**
   * 上一轮 agent 回复的摘要，没有大纲投影时是空串。
   * 正在跑的会话这里是**上一轮**的回复，别当实时流用。
   */
  summary: string;
}

/** 网格是 2x2，最多四张卡 */
const MAX_FOCUS = 4;

/** limit 可以调小（窄屏降级成单列），但不可能超过四格 */
function clampLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return MAX_FOCUS;
  return Math.max(0, Math.min(MAX_FOCUS, Math.floor(limit)));
}

/**
 * 有待办的排前面（条数多的更靠前），同一档内按最近活动倒序。
 * 最后用 sessionId 兜底，避免同一毫秒的会话在两次渲染里互换位置。
 */
function rank(entry: FocusEntry): number {
  if (entry.pendingCount > 0) return 0;
  return entry.running ? 1 : 2;
}

function compare(a: FocusEntry, b: FocusEntry): number {
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  if (a.pendingCount !== b.pendingCount) return b.pendingCount - a.pendingCount;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  if (a.sessionId === b.sessionId) return 0;
  return a.sessionId < b.sessionId ? -1 : 1;
}

/**
 * @param sessions sessions 帧的 items，原样传进来（归档、子会话都在里面，这里自己剔）
 * @param options.archivedIds workspaces 帧的 archivedSessionIds
 * @param options.outlines 轮次大纲缓存，只用来取摘要
 * @param options.limit 默认 4，会被夹到 0..4
 */
export function selectFocusSessions(
  sessions: readonly SessionItem[],
  options: {
    pending: PendingMap;
    archivedIds?: readonly string[];
    outlines?: OutlineMap;
    limit?: number;
  },
): FocusEntry[] {
  const limit = clampLimit(options.limit);
  if (limit === 0) return [];

  // 归档只是从导航里藏起来，sessions 帧照样返回，所以得自己剔一遍。
  const archived = new Set(options.archivedIds ?? []);
  const entries: FocusEntry[] = [];

  for (const item of sessions) {
    if (!item || typeof item.sessionId !== 'string' || !item.sessionId) continue;
    if (archived.has(item.sessionId)) continue;
    if (item.blank === true) continue;
    if (item.parentSessionId) continue;

    // 全部可见会话都进候选：网格常驻最近 4 个，排序决定谁优先。
    const pendingCount = pendingItems(options.pending, item.sessionId).length;
    const running = item.running === true;

    entries.push({
      sessionId: item.sessionId,
      title: item.projections?.values.title?.trim() ?? '',
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
      running,
      pendingCount,
      summary: options.outlines ? lastResponse(options.outlines, item.sessionId) ?? '' : '',
    });
  }

  return entries.sort(compare).slice(0, limit);
}
