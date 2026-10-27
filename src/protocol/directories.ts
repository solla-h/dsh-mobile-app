/**
 * 目录浏览（directories）帧。
 *
 * 网关直接用宿主的 node:fs 列一层子目录，不依赖 DSH 的 native picker，
 * 所以「新建会话到某个项目目录」在任何部署方式下都能用。
 * 契约见 PROTOCOL.md「工作区与目录」：
 *   { type: 'directories', path? } → { kind: 'directories', path, home, crumbs, entries }
 */

export interface DirectoryNode {
  name: string;
  path: string;
  hidden: boolean;
}

export interface DirectoryListing {
  path: string;
  home?: string;
  crumbs: DirectoryNode[];
  entries: DirectoryNode[];
  truncated: boolean;
}

function nodeOf(value: unknown): DirectoryNode | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const path = typeof raw.path === 'string' ? raw.path : '';
  if (!path) return null;
  const name = typeof raw.name === 'string' && raw.name ? raw.name : path;
  return { name, path, hidden: raw.hidden === true };
}

export function mapDirectories(frame: unknown): DirectoryListing | null {
  if (!frame || typeof frame !== 'object') return null;
  const raw = frame as Record<string, unknown>;
  if (raw.kind !== 'directories') return null;
  const path = typeof raw.path === 'string' ? raw.path : '';
  if (!path) return null;
  const crumbs = Array.isArray(raw.crumbs)
    ? raw.crumbs.map(nodeOf).filter((item): item is DirectoryNode => item !== null)
    : [];
  const entries = Array.isArray(raw.entries)
    ? raw.entries.map(nodeOf).filter((item): item is DirectoryNode => item !== null)
    : [];
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return {
    path,
    home: typeof raw.home === 'string' ? raw.home : undefined,
    // 服务端总会给 crumbs；万一没给，至少留一个当前位置，别让面包屑整条消失。
    crumbs: crumbs.length ? crumbs : [{ name: path, path, hidden: false }],
    entries,
    truncated: raw.truncated === true,
  };
}
