import { diffFile, parseUnifiedDiff } from '../DiffView';

describe('parseUnifiedDiff', () => {
  it('识别新增、删除、上下文和 hunk 头', () => {
    const source = [
      'diff --git a/src/pool.rs b/src/pool.rs',
      '--- a/src/pool.rs',
      '+++ b/src/pool.rs',
      '@@ -12,3 +12,4 @@ impl Pool {',
      ' let a = 1;',
      '-let b = 2;',
      '+let b = 3;',
      '+let c = 4;',
    ].join('\n');
    const rows = parseUnifiedDiff(source);
    expect(rows.map((row) => row.kind)).toEqual([
      'meta',
      'meta',
      'meta',
      'hunk',
      'ctx',
      'del',
      'add',
      'add',
    ]);
    expect(rows[4].no).toBe(12);
    expect(rows[6].no).toBe(13);
    expect(rows[7].no).toBe(14);
    expect(rows[5].no).toBeUndefined();
  });

  it('不是 diff 的文本按普通代码行处理', () => {
    const rows = parseUnifiedDiff('hello\nworld');
    expect(rows.every((row) => row.kind === 'ctx')).toBe(true);
    expect(rows.map((row) => row.text)).toEqual(['hello', 'world']);
  });

  it('没有 hunk 头时不强行编行号', () => {
    const rows = parseUnifiedDiff('+added');
    expect(rows[0].kind).toBe('add');
    expect(rows[0].no).toBeUndefined();
  });
});

describe('diffFile', () => {
  it('优先取 +++ b/ 路径', () => {
    expect(diffFile('--- a/x.rs\n+++ b/src/y.rs')).toBe('src/y.rs');
  });

  it('只有 diff --git 时取 a/ 路径', () => {
    expect(diffFile('diff --git a/src/z.rs b/src/z.rs')).toBe('src/z.rs');
  });

  it('都不是就返回 undefined', () => {
    expect(diffFile('plain text')).toBeUndefined();
  });
});
