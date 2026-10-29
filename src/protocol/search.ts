/**
 * 会话全文搜索。网关侧落的是 session/search，不是本地过滤标题那种假搜索。
 *
 * 真网关实测的三件事：
 *  - 命中项只有 { sessionId, snippet }，标题要自己拿 id 去 sessions 里 join；
 *  - 单次最多 20 条、片段最多 240 个码点，请求没有翻页参数，
 *    hasMore 只说明「还有更多」，想拿全只能自己收窄 query；
 *  - 已归档会话照样会被搜到（20 条里 12 条是归档的），得由调用方决定标不标出来。
 *
 * 空白 query 网关会直接回 bad-request，所以先过 normalizeQuery 再发。
 */

import type { SearchFrame, SessionItem } from './types';

/** 服务端单次返回上限，和 dsh 的 SESSION_SEARCH_RESULT_LIMIT 对齐 */
export const SEARCH_RESULT_LIMIT = 20;
/** 片段长度上限（Unicode 码点），超出部分服务端已经截断 */
export const SEARCH_SNIPPET_MAX_CODE_POINTS = 240;

export interface SearchHit {
  sessionId: string;
  snippet: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** true 表示服务端还有更多命中，但当前协议拿不到第二页 */
  hasMore: boolean;
}

/** 网关自己也会 trim，这里提前挡掉空串，省一次 bad-request 往返。 */
export function normalizeQuery(raw: string): string {
  return raw.trim();
}

/** 帧不合法（不是对象、items 不是数组）时返回 null，调用方当作没收到结果。 */
export function mapSearchResult(raw: unknown): SearchResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const frame = raw as Partial<SearchFrame>;
  if (!Array.isArray(frame.items)) return null;
  const hits: SearchHit[] = [];
  for (const entry of frame.items) {
    if (!entry || typeof entry.sessionId !== 'string' || !entry.sessionId) continue;
    hits.push({
      sessionId: entry.sessionId,
      snippet: typeof entry.snippet === 'string' ? entry.snippet : '',
    });
  }
  return { hits, hasMore: frame.hasMore === true };
}

export interface SearchHitView extends SearchHit {
  /** 空串表示会话不在当前列表里（或还没标题），兜底文案由 UI 决定 */
  title: string;
  updatedAt?: number;
  archived: boolean;
}

/**
 * 把命中项和会话列表对齐，补上标题、时间和归档标记。
 * 找不到对应会话时**不丢**：保留 sessionId 和片段，标题留空，
 * 这样搜索不会因为列表没刷新就少给结果。
 */
export function resolveSearchHits(
  result: SearchResult,
  sessions: readonly SessionItem[],
  archivedSessionIds: readonly string[] = [],
): SearchHitView[] {
  const byId = new Map<string, SessionItem>();
  for (const item of sessions) {
    if (item && typeof item.sessionId === 'string') byId.set(item.sessionId, item);
  }
  const archived = new Set(archivedSessionIds);
  return result.hits.map((hit) => {
    const item = byId.get(hit.sessionId);
    return {
      sessionId: hit.sessionId,
      snippet: hit.snippet,
      title: item?.projections?.values.title?.trim() ?? '',
      updatedAt: typeof item?.updatedAt === 'number' ? item.updatedAt : undefined,
      archived: archived.has(hit.sessionId),
    };
  });
}
