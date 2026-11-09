import { applyOutlineFrame, entryCount, lastResponse } from '../outline-cache';
import type { OutlineMap } from '../outline-cache';

const entry = (turn: number, response: string, prompt = '提示' + turn) => ({
  turn,
  seq: turn * 10,
  prompt,
  response,
});

const baseline = (projections: Record<string, unknown>) => ({
  kind: 'projection-baseline',
  projections,
});

const projection = (turnOutline: unknown) => ({
  asOfSeq: 1,
  values: { turnOutline },
});

const updated = (sessionId: unknown, turnOutline: unknown) => ({
  kind: 'turn-outline-updated',
  sessionId,
  turnOutline,
});

describe('applyOutlineFrame / projection-baseline', () => {
  it('快照整体替换：旧会话被覆盖，快照里没有的会话要删掉', () => {
    const before: OutlineMap = {
      s1: [entry(1, '旧回复')],
      s2: [entry(1, '这次不会有')],
    };
    expect(
      applyOutlineFrame(
        before,
        baseline({
          s1: projection([entry(2, '新回复')]),
          s3: projection([entry(1, '刚出现的会话')]),
        }),
      ),
    ).toEqual({
      s1: [entry(2, '新回复')],
      s3: [entry(1, '刚出现的会话')],
    });
  });

  it('turnOutline 为 null 或缺失的会话不进缓存', () => {
    expect(
      applyOutlineFrame(
        { s1: [entry(1, '还留着')], s2: [entry(1, '要清掉')] },
        baseline({ s1: projection(null), s2: { asOfSeq: 2, values: {} } }),
      ),
      // 快照是整体替换：s1 这次是 null、s2 干脆没有，两个都必须从缓存里消失
    ).toEqual({});
  });

  it('快照里没有任何大纲时得到空对象', () => {
    expect(applyOutlineFrame({ s1: [entry(1, 'x')] }, baseline({ s1: projection(null) }))).toEqual(
      {},
    );
  });
});

describe('applyOutlineFrame / turn-outline-updated', () => {
  it('null 表示失效，删掉这个会话', () => {
    const before: OutlineMap = { s1: [entry(1, 'a')], s2: [entry(1, 'b')] };
    expect(
      applyOutlineFrame(before, { kind: 'turn-outline-updated', sessionId: 's1', turnOutline: null }),
    ).toEqual({ s2: [entry(1, 'b')] });
  });

  it('空数组是合法大纲，会话要留成 []', () => {
    const next = applyOutlineFrame({}, { kind: 'turn-outline-updated', sessionId: 's1', turnOutline: [] });
    expect(next).toEqual({ s1: [] });
    expect(lastResponse(next as OutlineMap, 's1')).toBeUndefined();
  });

  it('增量只动目标会话', () => {
    const before: OutlineMap = { s1: [entry(1, 'a')], s2: [entry(1, 'b')] };
    expect(
      applyOutlineFrame(before, { kind: 'turn-outline-updated', sessionId: 's2', turnOutline: [entry(2, '新')] }),
    ).toEqual({ s1: [entry(1, 'a')], s2: [entry(2, '新')] });
  });

  it('正在跑的轮次 response 还是空串，也要进缓存', () => {
    const next = applyOutlineFrame(
      {},
      { kind: 'turn-outline-updated', sessionId: 's1', turnOutline: [entry(1, ''), entry(2, '')] },
    );
    expect(next).toEqual({ s1: [entry(1, ''), entry(2, '')] });
    expect(lastResponse(next as OutlineMap, 's1')).toBeUndefined();
  });
});

describe('applyOutlineFrame / 坏数据', () => {
  it('不是对象、未知 kind 一律忽略', () => {
    expect(applyOutlineFrame({}, null)).toBeNull();
    expect(applyOutlineFrame({}, undefined)).toBeNull();
    expect(applyOutlineFrame({}, 'projection-baseline')).toBeNull();
    expect(applyOutlineFrame({}, { kind: 'message' })).toBeNull();
  });

  it('快照缺 projections / 结构不对就忽略整帧', () => {
    expect(applyOutlineFrame({ s1: [entry(1, 'x')] }, { kind: 'projection-baseline' })).toBeNull();
    expect(applyOutlineFrame({ s1: [entry(1, 'x')] }, baseline([] as never))).toBeNull();
  });

  it('增量缺 sessionId 或 turnOutline 不是数组就忽略', () => {
    expect(applyOutlineFrame({}, { kind: 'turn-outline-updated', turnOutline: [] })).toBeNull();
    expect(applyOutlineFrame({}, updated('', []))).toBeNull();
    expect(applyOutlineFrame({}, updated('s1', 'nope'))).toBeNull();
    expect(applyOutlineFrame({}, updated('s1', undefined))).toBeNull();
  });

  it('坏 entry 丢掉，缺 turn / seq 的整条不要', () => {
    const next = applyOutlineFrame(
      {},
      {
        kind: 'turn-outline-updated',
        sessionId: 's1',
        turnOutline: [
          { turn: 1, seq: 10, prompt: '好的', response: '在' },
          { turn: '1', seq: 10, prompt: 'x', response: 'x' },
          { turn: 2, prompt: 'x', response: 'x' },
          null,
          'entry',
          { turn: 3, seq: 30 },
        ],
      },
    );
    expect(next).toEqual({
      s1: [
        { turn: 1, seq: 10, prompt: '好的', response: '在' },
        // 文本字段坏了退化成空串，但这一轮还在
        { turn: 3, seq: 30, prompt: '', response: '' },
      ],
    });
  });

  it('文本按 UTF-16 长度截断，别让超长 response 撑爆列表', () => {
    const next = applyOutlineFrame(
      {},
      updated('s1', [{ turn: 1, seq: 1, prompt: 'a'.repeat(60), response: 'b'.repeat(200) }]),
    );
    const entries = (next as OutlineMap).s1;
    expect(entries[0].prompt).toHaveLength(50);
    expect(entries[0].response).toHaveLength(120);
  });
});

describe('applyOutlineFrame / 引用稳定', () => {
  it('内容没变时返回 null，调用方保留原 map', () => {
    const map: OutlineMap = { s1: [entry(1, '一样的')] };
    expect(
      applyOutlineFrame(map, { kind: 'turn-outline-updated', sessionId: 's1', turnOutline: [entry(1, '一样的')] }),
    ).toBeNull();
    // asOfSeq 变了但大纲没变，也算没变
    expect(applyOutlineFrame(map, baseline({ s1: projection([entry(1, '一样的')]) }))).toBeNull();
  });

  it('删一个不存在的会话不算变化', () => {
    const map: OutlineMap = { s1: [entry(1, 'x')] };
    expect(applyOutlineFrame(map, { kind: 'turn-outline-updated', sessionId: 'nope', turnOutline: null })).toBeNull();
  });

  it('有变化时返回新对象，旧 map 不被就地改写', () => {
    const map: OutlineMap = { s1: [entry(1, 'a')] };
    const next = applyOutlineFrame(map, updated('s1', [entry(1, 'a'), entry(2, 'b')])) as OutlineMap;
    expect(next).not.toBe(map);
    expect(map.s1).toHaveLength(1);
    expect(next.s1).toHaveLength(2);
  });
});

describe('lastResponse', () => {
  it('跳过末尾 response 为空的轮次，取最后一条非空', () => {
    const map: OutlineMap = { s1: [entry(1, '第一轮'), entry(2, '第二轮'), entry(3, '  '), entry(4, '')] };
    expect(lastResponse(map, 's1')).toBe('第二轮');
  });

  it('返回的是 trim 之后的内容', () => {
    expect(lastResponse({ s1: [entry(1, '  缩进过的回复  ')] }, 's1')).toBe('缩进过的回复');
  });

  it('会话不存在或大纲为空都返回 undefined', () => {
    expect(lastResponse({}, 's1')).toBeUndefined();
    expect(lastResponse({ s1: [] }, 's1')).toBeUndefined();
    expect(lastResponse({ s1: [entry(1, ''), entry(2, '   ')] }, 's1')).toBeUndefined();
  });
});

describe('entryCount', () => {
  it('累加所有会话的轮数', () => {
    expect(entryCount({})).toBe(0);
    expect(entryCount({ s1: [entry(1, 'a'), entry(2, 'b')], s2: [], s3: [entry(1, 'c')] })).toBe(3);
  });
});
