import { deriveProjects } from '../projects';
import type { SessionItem, WorkspacesFrame } from '../types';

function session(
  sessionId: string,
  options: { title?: string | null; cwd?: string; updatedAt?: number } = {},
): SessionItem {
  return {
    sessionId,
    updatedAt: options.updatedAt ?? 0,
    running: false,
    blank: false,
    cwd: options.cwd,
    projections: { asOfSeq: 1, values: { title: options.title ?? null } },
  };
}

function workspaces(
  items: WorkspacesFrame['items'],
  options: { archived?: string[]; pinned?: string[] } = {},
): WorkspacesFrame {
  return {
    kind: 'workspaces',
    items,
    archivedSessionIds: options.archived ?? [],
    pinnedSessionIds: options.pinned ?? [],
  };
}

describe('deriveProjects', () => {
  it('工作区覆盖的会话按服务端手动顺序，没被认领的按 cwd 兜底分组', () => {
    const board = deriveProjects(
      [
        session('a', { title: '甲', cwd: '/w/临时会话', updatedAt: 300 }),
        session('b', { title: '乙', cwd: '/w/临时会话', updatedAt: 100 }),
        // 跟工作区同一个 cwd，但没被登记进 sessionIds，必须靠 cwd 兜底
        session('c', { title: '丙', cwd: '/w/临时会话', updatedAt: 200 }),
        session('d', { title: '丁', cwd: '/w/临时会话', updatedAt: 500 }),
        session('e', { title: '戊', cwd: '/w/其它', updatedAt: 50 }),
      ],
      workspaces([
        {
          workspaceId: 'w1',
          path: '/w/临时会话',
          title: 'temp-session',
          sessionIds: ['b', 'a'],
        },
      ]),
    );

    expect(board.groups.map((group) => group.id)).toEqual([
      'workspace:w1',
      'cwd:/w/临时会话',
      'cwd:/w/其它',
    ]);
    // 手动顺序不能被 updatedAt 重排
    expect(board.groups[0].sessions.map((item) => item.sessionId)).toEqual(['b', 'a']);
    expect(board.groups[0].title).toBe('temp-session');
    expect(board.groups[1].sessions.map((item) => item.sessionId)).toEqual(['d', 'c']);
    expect(board.groups[1].title).toBe('临时会话');
    expect(board.loose).toEqual([]);
  });

  it('归档会话不进任何组，但归档集合原样带回', () => {
    const board = deriveProjects(
      [
        session('a', { cwd: '/w', updatedAt: 1 }),
        session('gone', { cwd: '/w', updatedAt: 2 }),
        session('also-gone', { cwd: '/w', updatedAt: 3 }),
      ],
      workspaces([], { archived: ['gone', 'also-gone'] }),
    );

    expect(board.groups).toHaveLength(1);
    expect(board.groups[0].sessions.map((item) => item.sessionId)).toEqual(['a']);
    expect(board.archivedSessionIds).toEqual(['gone', 'also-gone']);
  });

  it('完全没有 workspaces 帧时降级成「全部按 cwd 分组」', () => {
    const board = deriveProjects([
      session('a', { cwd: '/w/one', updatedAt: 1 }),
      session('b', { cwd: '/w/one', updatedAt: 2 }),
      session('c', { cwd: '/w/two', updatedAt: 3 }),
    ]);

    expect(board.groups.map((group) => group.id)).toEqual(['cwd:/w/two', 'cwd:/w/one']);
    expect(board.groups.map((group) => group.source)).toEqual(['cwd', 'cwd']);
    expect(board.archivedSessionIds).toEqual([]);
  });

  it('没有 cwd 的会话落到 loose，不硬塞进任何组', () => {
    const board = deriveProjects([
      session('a', { cwd: '/w', updatedAt: 1 }),
      session('b', { updatedAt: 5 }),
      session('c', { updatedAt: 9 }),
    ]);

    expect(board.groups).toHaveLength(1);
    expect(board.loose.map((item) => item.sessionId)).toEqual(['c', 'b']);
  });

  it('工作区成员全被归档时不产出空组', () => {
    const board = deriveProjects(
      [session('a', { updatedAt: 1 })],
      workspaces(
        [{ workspaceId: 'w1', path: '/w', title: '空组', sessionIds: ['x', 'y'] }],
        { archived: ['x', 'y'] },
      ),
    );

    expect(board.groups).toEqual([]);
  });

  it('同一个会话被两个工作区登记时只出现一次', () => {
    const board = deriveProjects(
      [session('a', { cwd: '/w' })],
      workspaces([
        { workspaceId: 'w1', path: '/w', title: '一号', sessionIds: ['a'] },
        { workspaceId: 'w2', path: '/w', title: '二号', sessionIds: ['a'] },
      ]),
    );

    expect(board.groups.map((group) => group.id)).toEqual(['workspace:w1']);
    expect(board.groups[0].sessions).toHaveLength(1);
  });

  it('置顶标记落到会话上，置顶集合的顺序原样透传', () => {
    const board = deriveProjects(
      [session('a', { cwd: '/w' }), session('b', { cwd: '/w' })],
      workspaces([], { pinned: ['b', 'a'] }),
    );

    // 置顶集合的「最近置顶在前」原样透传，分组内部顺序不动，由 UI 决定要不要提前
    expect(board.pinnedSessionIds).toEqual(['b', 'a']);
    expect(board.groups[0].sessions.map((item) => item.sessionId).sort()).toEqual(['a', 'b']);
    expect(board.groups[0].sessions.every((item) => item.pinned)).toBe(true);
  });

  it('组内 updatedAt 取最新的一条', () => {
    const board = deriveProjects([
      session('a', { cwd: '/w', updatedAt: 10 }),
      session('b', { cwd: '/w', updatedAt: 99 }),
    ]);

    expect(board.groups[0].updatedAt).toBe(99);
  });
});
