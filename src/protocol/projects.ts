/**
 * 首页看板的整形层：把 sessions + workspaces 两帧拼成「项目 → 会话」的树。
 *
 * 这里有个反直觉的事实（真网关实测，default-vnic 上 30 个会话）：
 * workspaces 只覆盖**显式创建**的工作区，只有 3 个会话落在里面，
 * 其余 27 个的 cwd 全是 /home/dsh/workspace，谁也没认领。
 * 所以不能只按 workspaces 分组，必须给没被认领的会话按 cwd 兜底分组，
 * 否则看板上会凭空少掉大半会话。cwd 也没有的会话才落到 loose。
 *
 * 另外：归档只是从导航里隐藏，sessions 帧照样返回（18/30 都是归档的），
 * 所以这里要自己把它们剔掉，并把归档集合原样带回给 UI 显示「已归档 N 个」。
 *
 * 这个模块只决定数据结构，不决定折叠、置顶条、排序动画——那些是 UI 的事。
 */

import type { SessionItem, WorkspacesFrame } from './types';

export interface ProjectSession {
  sessionId: string;
  /** 空串表示服务端还没有标题，兜底文案由 UI 决定 */
  title: string;
  /** 毫秒时间戳，原样透传（服务端给的就是毫秒） */
  updatedAt: number;
  running: boolean;
  blank: boolean;
  pinned: boolean;
}

/** workspace：服务端登记的工作区；cwd：从会话的 cwd 推导出来的分组 */
export type ProjectSource = 'workspace' | 'cwd';

export interface ProjectGroup {
  /** 稳定 key，可以直接当 FlatList 的 keyExtractor：workspace:<id> / cwd:<path> */
  id: string;
  title: string;
  source: ProjectSource;
  /** 宿主目录绝对路径；cwd 分组时就是 cwd 本身 */
  path?: string;
  /** 组内最近一次活动，给 UI 排序用 */
  updatedAt: number;
  /**
   * 组内会话。工作区分组保持服务端的手动顺序，cwd 分组按最近活动排。
   */
  sessions: ProjectSession[];
}

export interface ProjectBoard {
  /**
   * 工作区分组按服务端注册表顺序在前，cwd 分组按最近活动在后；
   * 想整体按时间排就自己用 updatedAt 再排一次。
   */
  groups: ProjectGroup[];
  /** 既没有工作区归属、也没有 cwd 的会话 */
  loose: ProjectSession[];
  archivedSessionIds: string[];
  pinnedSessionIds: string[];
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function toProjectSession(item: SessionItem, pinned: Set<string>): ProjectSession {
  return {
    sessionId: item.sessionId,
    title: item.projections?.values.title?.trim() ?? '',
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
    running: item.running === true,
    blank: item.blank === true,
    pinned: pinned.has(item.sessionId),
  };
}

function newest(sessions: ProjectSession[]): number {
  let max = 0;
  for (const session of sessions) if (session.updatedAt > max) max = session.updatedAt;
  return max;
}

/**
 * @param sessions sessions 帧的 items，原样传进来（不要先过滤归档）
 * @param workspaces workspaces 帧；没拿到时退化成「全部按 cwd 分组」
 */
export function deriveProjects(
  sessions: readonly SessionItem[],
  workspaces?: WorkspacesFrame | null,
): ProjectBoard {
  const archivedSessionIds = workspaces?.archivedSessionIds ?? [];
  const pinnedSessionIds = workspaces?.pinnedSessionIds ?? [];
  const archived = new Set(archivedSessionIds);
  const pinned = new Set(pinnedSessionIds);

  const visible = new Map<string, SessionItem>();
  for (const item of sessions) {
    if (!item || typeof item.sessionId !== 'string' || !item.sessionId) continue;
    if (archived.has(item.sessionId)) continue;
    visible.set(item.sessionId, item);
  }

  const claimed = new Set<string>();
  const workspaceGroups: ProjectGroup[] = [];
  for (const workspace of workspaces?.items ?? []) {
    if (!workspace || typeof workspace.workspaceId !== 'string' || !workspace.workspaceId) continue;
    const members: ProjectSession[] = [];
    for (const sessionId of workspace.sessionIds ?? []) {
      const item = visible.get(sessionId);
      // 同一个会话可能被两个工作区都登记了，只认第一个，避免重复出现
      if (!item || claimed.has(sessionId)) continue;
      claimed.add(sessionId);
      members.push(toProjectSession(item, pinned));
    }
    // 组里一个可见会话都没有就别占位（全被归档了）
    if (members.length === 0) continue;
    workspaceGroups.push({
      id: `workspace:${workspace.workspaceId}`,
      title: workspace.title?.trim() || basename(workspace.path ?? '') || '未命名工作区',
      source: 'workspace',
      path: workspace.path,
      updatedAt: newest(members),
      sessions: members,
    });
  }

  const cwdBuckets = new Map<string, ProjectSession[]>();
  const loose: ProjectSession[] = [];
  for (const item of visible.values()) {
    if (claimed.has(item.sessionId)) continue;
    const session = toProjectSession(item, pinned);
    const cwd = typeof item.cwd === 'string' ? item.cwd.trim() : '';
    if (!cwd) {
      loose.push(session);
      continue;
    }
    const bucket = cwdBuckets.get(cwd);
    if (bucket) bucket.push(session);
    else cwdBuckets.set(cwd, [session]);
  }

  const cwdGroups: ProjectGroup[] = [];
  for (const [path, members] of cwdBuckets) {
    members.sort((a, b) => b.updatedAt - a.updatedAt);
    cwdGroups.push({
      id: `cwd:${path}`,
      title: basename(path),
      source: 'cwd',
      path,
      updatedAt: newest(members),
      sessions: members,
    });
  }
  cwdGroups.sort((a, b) => b.updatedAt - a.updatedAt);
  loose.sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    groups: [...workspaceGroups, ...cwdGroups],
    loose,
    archivedSessionIds: [...archivedSessionIds],
    pinnedSessionIds: [...pinnedSessionIds],
  };
}
