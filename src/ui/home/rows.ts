/**
 * 「全部会话」页的行模型：把项目树摊平成可渲染的行。
 *
 * 没有卡片背景——分组头 + 缩进行 + 一根左导轨线就够了。这一层只做数据整形，
 * 折叠状态由 UI 传进来，所以切换折叠不需要碰协议。
 */

import { deriveProjects } from '../../protocol/projects';
import type { SessionItem, WorkspacesFrame } from '../../protocol/types';

export type HomeRow =
  | {
      kind: 'group';
      id: string;
      title: string;
      count: number;
      /** 分组对应的宿主目录，cwd 分组时就是 cwd 本身 */
      path?: string;
      collapsed: boolean;
      /** 归档组特殊一点：默认收起，且不参与业务分组 */
      archived?: boolean;
    }
  | { kind: 'session'; item: SessionItem; indent: boolean };

function lastTwoSegments(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('/') : parts[0] ?? path;
}

export function buildHomeRows(
  sessions: readonly SessionItem[],
  workspaces: WorkspacesFrame | null,
  options: {
    collapsed: Record<string, boolean>;
    showArchived: boolean;
    archivedIds: readonly string[];
  },
): HomeRow[] {
  const byId = new Map<string, SessionItem>();
  for (const item of sessions) byId.set(item.sessionId, item);

  const archived = new Set(options.archivedIds);
  const visible = sessions.filter((item) => !archived.has(item.sessionId));
  const board = deriveProjects(visible, workspaces);

  const rows: HomeRow[] = [];
  const pushGroup = (
    id: string,
    title: string,
    items: readonly string[],
    path?: string,
    archivedFlag?: boolean,
  ) => {
    const list = items
      .map((sessionId) => byId.get(sessionId))
      .filter((item): item is SessionItem => item !== undefined);
    if (list.length === 0) return;
    const collapsed = options.collapsed[id] === true;
    rows.push({ kind: 'group', id, title, count: list.length, path, collapsed, archived: archivedFlag });
    if (collapsed) return;
    for (const item of list) rows.push({ kind: 'session', item, indent: true });
  };

  for (const group of board.groups) {
    // cwd 兜底分组的 title 只有最后一段，单看「workspace」没信息量，补上前一层目录。
    const title =
      group.source === 'cwd' && group.path ? lastTwoSegments(group.path) : group.title;
    pushGroup(group.id, title, group.sessions.map((s) => s.sessionId), group.path);
  }
  if (board.loose.length > 0) {
    pushGroup('loose', '未归组', board.loose.map((s) => s.sessionId));
  }
  if (options.showArchived && archived.size > 0) {
    const archivedItems = sessions.filter((item) => archived.has(item.sessionId));
    pushGroup('archived', '已归档', archivedItems.map((item) => item.sessionId), undefined, true);
  }
  return rows;
}
