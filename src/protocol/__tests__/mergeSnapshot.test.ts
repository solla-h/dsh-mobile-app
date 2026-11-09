import { mapHistory, mergeSnapshot, type ChatMessage, type HistoryEvent } from '../chat';

// mergeSnapshot 是「缓存摆出 + 新鲜窗口回填」和「重连补最新一页」共用的对账函数，
// HIST-1 起它变成了关键路径：缓存里可能带着翻页翻出的更早内容，合并规则必须钉死。

const ev = (seq: number, type: string, data: Record<string, unknown>): HistoryEvent =>
  ({ seq, type, time: 1700000000000 + seq, data }) as unknown as HistoryEvent;

const userMsg = (seq: number, text: string) =>
  ev(seq, 'user/message', { content: [{ type: 'text', text }] });

const textsOf = (messages: ChatMessage[]): string[] =>
  messages.map((message) => ('text' in message ? message.text : String(message.kind)));

describe('mergeSnapshot', () => {
  it('区间内以快照为准，更早的翻页历史与更新的实时消息都保留', () => {
    const current = mapHistory([userMsg(1, 'a'), userMsg(2, 'b'), userMsg(3, 'c'), userMsg(4, 'd')]);
    const next = mergeSnapshot(current, [userMsg(2, 'b2'), userMsg(3, 'c2')]);
    expect(textsOf(next)).toEqual(['a', 'b2', 'c2', 'd']);
  });

  it('快照整体比缓存新时缓存原样保留（缓存不缺旧内容）', () => {
    const current = mapHistory([userMsg(1, 'a'), userMsg(2, 'b')]);
    const next = mergeSnapshot(current, [userMsg(3, 'c'), userMsg(4, 'd')]);
    expect(textsOf(next)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('快照整体比缓存旧时更新的消息不丢（对账不倒退）', () => {
    const current = mapHistory([userMsg(3, 'c'), userMsg(4, 'd')]);
    const next = mergeSnapshot(current, [userMsg(1, 'a'), userMsg(2, 'b')]);
    expect(textsOf(next)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('空快照返回原引用（未订阅到内容的会话查询是常态）', () => {
    const current = mapHistory([userMsg(1, 'a')]);
    expect(mergeSnapshot(current, [])).toBe(current);
  });

  it('没有 seq 的本地行始终保留，且排在末尾', () => {
    const local: ChatMessage = { id: 'local', kind: 'notice', text: '本地提示', time: 0 };
    const current = [...mapHistory([userMsg(2, 'b')]), local];
    const next = mergeSnapshot(current, [userMsg(2, 'b2')]);
    expect(textsOf(next)).toEqual(['b2', '本地提示']);
    expect(next[next.length - 1]).toBe(local);
  });

  // 翻页补洞回归（HIST-1 评审确认过的错序）：缓存停在 1..3，离开期间推进到 9..12，
  // 补洞页 6..8 的 seq 比缓存块新，必须插回中间而不是并到最前。
  it('缓存旧块与新鲜窗口之间有洞时，补洞页按 seq 插回中间', () => {
    const cached = mapHistory([userMsg(1, 'a'), userMsg(2, 'b'), userMsg(3, 'c')]);
    const withWindow = mergeSnapshot(cached, [userMsg(9, 'i'), userMsg(10, 'j'), userMsg(11, 'k'), userMsg(12, 'l')]);
    expect(textsOf(withWindow)).toEqual(['a', 'b', 'c', 'i', 'j', 'k', 'l']);
    const filled = mergeSnapshot(withWindow, [userMsg(6, 'f'), userMsg(7, 'g'), userMsg(8, 'h')]);
    expect(textsOf(filled)).toEqual(['a', 'b', 'c', 'f', 'g', 'h', 'i', 'j', 'k', 'l']);
  });

  it('翻页整页比已加载都早时并到最前；与现有重叠的部分以新页为准', () => {
    const current = mapHistory([userMsg(5, 'e'), userMsg(6, 'f')]);
    const next = mergeSnapshot(current, [userMsg(3, 'c'), userMsg(4, 'd'), userMsg(5, 'e2')]);
    expect(textsOf(next)).toEqual(['c', 'd', 'e2', 'f']);
  });
});
