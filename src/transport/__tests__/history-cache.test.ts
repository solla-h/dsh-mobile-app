import type { ChatMessage } from '../../protocol/chat';
import {
  cacheHistory,
  clearHistoryCache,
  dropCachedGateway,
  getCachedHistory,
} from '../history-cache';

const msg = (text: string): ChatMessage => ({ id: text, kind: 'notice', text, time: 0 });

beforeEach(() => clearHistoryCache());

describe('history-cache', () => {
  it('按 (gatewayId, sessionId) 取回同一引用：存的是不可变替换后的数组，不拷贝', () => {
    const messages = [msg('a')];
    cacheHistory('gw1', 's1', messages);
    expect(getCachedHistory('gw1', 's1')).toBe(messages);
  });

  it('同 sessionId 不同网关互不串', () => {
    cacheHistory('gw1', 's1', [msg('a')]);
    expect(getCachedHistory('gw2', 's1')).toBeUndefined();
  });

  it('超过 8 个会话淘汰最久未读的，get 命中会刷新年龄', () => {
    for (let i = 1; i <= 8; i += 1) cacheHistory('gw', `s${i}`, [msg(`m${i}`)]);
    getCachedHistory('gw', 's1'); // 摸一下 s1：最久未读变成 s2
    cacheHistory('gw', 's9', [msg('m9')]);
    expect(getCachedHistory('gw', 's1')).toBeDefined();
    expect(getCachedHistory('gw', 's2')).toBeUndefined();
    expect(getCachedHistory('gw', 's9')).toBeDefined();
  });

  it('写入空数组等于删除：别把「空会话」的假象留给下次进入', () => {
    cacheHistory('gw', 's1', [msg('a')]);
    cacheHistory('gw', 's1', []);
    expect(getCachedHistory('gw', 's1')).toBeUndefined();
  });

  it('dropCachedGateway 只清该网关的命名空间', () => {
    cacheHistory('gw1', 's1', [msg('a')]);
    cacheHistory('gw2', 's1', [msg('b')]);
    dropCachedGateway('gw1');
    expect(getCachedHistory('gw1', 's1')).toBeUndefined();
    expect(getCachedHistory('gw2', 's1')).toBeDefined();
  });

  it('同键重写覆盖旧值', () => {
    cacheHistory('gw', 's1', [msg('a')]);
    const next = [msg('a'), msg('b')];
    cacheHistory('gw', 's1', next);
    expect(getCachedHistory('gw', 's1')).toBe(next);
  });

  it('在途工具行（output 未到）不写缓存；已完成的不受影响', () => {
    const running: ChatMessage = { id: 't1', kind: 'tool', name: 'Bash', time: 0, seq: 1 };
    const done: ChatMessage = { id: 't2', kind: 'tool', name: 'Bash', time: 0, seq: 2, output: 'ok' };
    cacheHistory('gw', 's1', [running, done]);
    expect(getCachedHistory('gw', 's1')?.map((m) => m.id)).toEqual(['t2']);
  });

  it('只剩在途工具行时不落缓存（等于删除）', () => {
    const running: ChatMessage = { id: 't1', kind: 'tool', name: 'Bash', time: 0, seq: 1 };
    cacheHistory('gw', 's1', [running]);
    expect(getCachedHistory('gw', 's1')).toBeUndefined();
  });
});
