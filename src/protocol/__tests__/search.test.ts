import { mapSearchResult, normalizeQuery, resolveSearchHits } from '../search';
import type { SessionItem } from '../types';

function session(sessionId: string, title: string | null, updatedAt: number): SessionItem {
  return {
    sessionId,
    updatedAt,
    running: false,
    blank: false,
    projections: { asOfSeq: 1, values: { title } },
  };
}

describe('normalizeQuery', () => {
  it('去掉首尾空白，网关那边也会 trim，这里先挡一次空串', () => {
    expect(normalizeQuery('  网关 协议 ')).toBe('网关 协议');
    expect(normalizeQuery('   ')).toBe('');
  });
});

describe('mapSearchResult', () => {
  it('帧不合法时返回 null，调用方当作没收到结果', () => {
    expect(mapSearchResult(null)).toBeNull();
    expect(mapSearchResult(undefined)).toBeNull();
    expect(mapSearchResult({})).toBeNull();
    expect(mapSearchResult({ items: 'nope' })).toBeNull();
  });

  it('坏条目丢掉，缺 hasMore 当 false', () => {
    expect(
      mapSearchResult({
        kind: 'search',
        items: [
          { sessionId: 's1', snippet: '命中片段' },
          { snippet: '没有 id' },
          { sessionId: '', snippet: '空 id' },
          { sessionId: 's2' },
        ],
      }),
    ).toEqual({
      hits: [
        { sessionId: 's1', snippet: '命中片段' },
        { sessionId: 's2', snippet: '' },
      ],
      hasMore: false,
    });
  });

  it('hasMore 是布尔 true 才算还有更多', () => {
    expect(mapSearchResult({ items: [], hasMore: true })?.hasMore).toBe(true);
    expect(mapSearchResult({ items: [], hasMore: 'yes' })?.hasMore).toBe(false);
  });
});

describe('resolveSearchHits', () => {
  it('补上标题和时间，并标出已归档的命中', () => {
    const views = resolveSearchHits(
      {
        hits: [
          { sessionId: 's1', snippet: '一' },
          { sessionId: 's2', snippet: '二' },
        ],
        hasMore: false,
      },
      [session('s1', '排查网关连接', 111), session('s2', null, 222)],
      ['s2'],
    );

    expect(views).toEqual([
      { sessionId: 's1', snippet: '一', title: '排查网关连接', updatedAt: 111, archived: false },
      { sessionId: 's2', snippet: '二', title: '', updatedAt: 222, archived: true },
    ]);
  });

  it('会话不在列表里时不丢命中，只把标题留空', () => {
    const views = resolveSearchHits(
      { hits: [{ sessionId: 'ghost', snippet: '旧会话' }], hasMore: true },
      [session('s1', '在列表里', 1)],
    );

    expect(views).toEqual([
      { sessionId: 'ghost', snippet: '旧会话', title: '', updatedAt: undefined, archived: false },
    ]);
  });

  it('保持服务端给的命中顺序', () => {
    const views = resolveSearchHits(
      {
        hits: [
          { sessionId: 'b', snippet: '1' },
          { sessionId: 'a', snippet: '2' },
        ],
        hasMore: false,
      },
      [session('a', '甲', 1), session('b', '乙', 2)],
    );

    expect(views.map((hit) => hit.sessionId)).toEqual(['b', 'a']);
  });
});
