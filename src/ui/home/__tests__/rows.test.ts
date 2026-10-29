import { buildHomeRows } from '../rows';
import type { SessionItem, WorkspacesFrame } from '../../../protocol/types';

const session = (id: string, cwd?: string, title?: string): SessionItem => ({
  sessionId: id,
  updatedAt: 1,
  running: false,
  blank: false,
  cwd,
  projections: { asOfSeq: 1, values: { title: title ?? null } },
});

const workspaces = (): WorkspacesFrame => ({
  kind: 'workspaces',
  items: [],
  archivedSessionIds: ['gone'],
  pinnedSessionIds: [],
});

describe('buildHomeRows', () => {
  it('按 cwd 分组，会话行带缩进', () => {
    const rows = buildHomeRows(
      [session('a', '/w/one', '甲'), session('b', '/w/one', '乙')],
      workspaces(),
      { collapsed: {}, showArchived: false, archivedIds: [] },
    );
    expect(rows.map((row) => row.kind)).toEqual(['group', 'session', 'session']);
    // cwd 分组标题取最后两层目录，单看最后一段没信息量
    expect(rows[0]).toMatchObject({ title: 'w/one', count: 2 });
  });

  it('折叠的分组只留组头', () => {
    const rows = buildHomeRows([session('a', '/w/one')], workspaces(), {
      collapsed: { 'cwd:/w/one': true },
      showArchived: false,
      archivedIds: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('group');
  });

  it('归档会话默认不出现，打开后单独成组', () => {
    const hidden = buildHomeRows([session('a', '/w'), session('gone', '/w')], workspaces(), {
      collapsed: {},
      showArchived: false,
      archivedIds: ['gone'],
    });
    expect(hidden.filter((row) => row.kind === 'session')).toHaveLength(1);

    const shown = buildHomeRows([session('a', '/w'), session('gone', '/w')], workspaces(), {
      collapsed: {},
      showArchived: true,
      archivedIds: ['gone'],
    });
    const last = shown[shown.length - 1];
    expect(last.kind).toBe('session');
  });

  it('没有 cwd 的会话落到「未归组」', () => {
    const rows = buildHomeRows([session('loose')], workspaces(), {
      collapsed: {},
      showArchived: false,
      archivedIds: [],
    });
    expect(rows[0]).toMatchObject({ kind: 'group', title: '未归组' });
  });
});
