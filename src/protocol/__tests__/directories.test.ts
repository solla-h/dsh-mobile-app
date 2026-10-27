import { mapDirectories } from '../directories';

describe('mapDirectories', () => {
  it('解析 crumbs 与 entries，并按名字排序', () => {
    const listing = mapDirectories({
      kind: 'directories',
      path: '/home/me/project',
      home: '/home/me',
      crumbs: [
        { name: '/', path: '/', hidden: false },
        { name: 'project', path: '/home/me/project', hidden: false },
      ],
      entries: [
        { name: 'src', path: '/home/me/project/src', hidden: false },
        { name: '.git', path: '/home/me/project/.git', hidden: true },
      ],
      truncated: false,
    });
    expect(listing).not.toBeNull();
    expect(listing?.path).toBe('/home/me/project');
    expect(listing?.home).toBe('/home/me');
    expect(listing?.crumbs.map((item) => item.name)).toEqual(['/', 'project']);
    expect(listing?.entries.map((item) => item.name)).toEqual(['.git', 'src']);
    expect(listing?.entries[0].hidden).toBe(true);
  });

  it('丢掉没有 path 的条目，而不是整帧作废', () => {
    const listing = mapDirectories({
      kind: 'directories',
      path: '/tmp',
      crumbs: [],
      entries: [{ name: 'a' }, { name: 'b', path: '/tmp/b' }, null, 'x'],
    });
    expect(listing?.entries).toEqual([{ name: 'b', path: '/tmp/b', hidden: false }]);
    // 没有 crumbs 时至少有一个当前位置，面包屑不会整条消失。
    expect(listing?.crumbs).toEqual([{ name: '/tmp', path: '/tmp', hidden: false }]);
  });

  it('非 directories 帧或缺少 path 时返回 null', () => {
    expect(mapDirectories(null)).toBeNull();
    expect(mapDirectories({ kind: 'sessions', path: '/tmp' })).toBeNull();
    expect(mapDirectories({ kind: 'directories' })).toBeNull();
  });
});
