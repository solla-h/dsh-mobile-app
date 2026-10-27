import { mapHistory, prependHistory, type HistoryEvent } from '../chat';

const ev = (seq: number, type: string, data: Record<string, unknown>): HistoryEvent =>
  ({ seq, type, time: 1700000000000 + seq, data }) as unknown as HistoryEvent;

describe('mapHistory', () => {
  it('用户消息按 content blocks 拼文本', () => {
    const messages = mapHistory([
      ev(1, 'user/message', { content: [{ type: 'text', text: '你好' }] }),
    ]);
    expect(messages).toEqual([
      { id: 'h1', kind: 'user', text: '你好', time: 1700000000001, seq: 1, images: undefined },
    ]);
  });

  it('Harness 注入的运行时上下文不显示', () => {
    const messages = mapHistory([
      ev(1, 'user/message', { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'x' }] }),
    ]);
    expect(messages).toEqual([]);
  });

  it('模型切换变成一条 notice', () => {
    const messages = mapHistory([
      ev(2, 'user/message', {
        source: { kind: 'model-selection', summary: 'GPT-6.1' },
        content: [{ type: 'text', text: 'ignored' }],
      }),
    ]);
    expect(messages[0]).toMatchObject({ kind: 'notice', text: '模型切换：GPT-6.1' });
  });

  it('tool/result 按 callId 并回对应的 tool/call', () => {
    const messages = mapHistory([
      ev(3, 'tool/call', { callId: 'c1', name: 'bash', arguments: { command: 'ls' } }),
      ev(4, 'tool/result', { callId: 'c1', output: 'a.txt', isError: false }),
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      kind: 'tool',
      name: 'bash',
      callId: 'c1',
      output: 'a.txt',
      isError: false,
    });
  });

  it('孤儿 tool/result 不会凭空造出一条消息', () => {
    const messages = mapHistory([ev(5, 'tool/result', { callId: 'nope', output: 'x' })]);
    expect(messages).toEqual([]);
  });

  it('deliverables/presented 变成文件卡片', () => {
    const messages = mapHistory([
      ev(6, 'deliverables/presented', {
        turn: 2,
        files: [{ path: '/home/dsh/hello.md', description: '测试文件' }],
      }),
    ]);
    expect(messages[0]).toMatchObject({
      kind: 'files',
      turn: 2,
      files: [{ path: '/home/dsh/hello.md', description: '测试文件' }],
    });
  });

  it('assistant 的 error/aborted finish 记成 failure', () => {
    const messages = mapHistory([
      ev(7, 'assistant/message', {
        message: { content: [{ type: 'text', text: '半截' }] },
        finish: { kind: 'aborted' },
      }),
    ]);
    expect(messages[0]).toMatchObject({ kind: 'assistant', text: '半截', failure: 'aborted' });
  });
});

describe('prependHistory', () => {
  it('按 seq 去重，重叠的旧消息不会重复出现', () => {
    const current = mapHistory([ev(2, 'user/message', { content: [{ type: 'text', text: 'b' }] })]);
    const merged = prependHistory(current, [
      ev(1, 'user/message', { content: [{ type: 'text', text: 'a' }] }),
      ev(2, 'user/message', { content: [{ type: 'text', text: 'b' }] }),
    ]);
    expect(merged.map((message) => (message as { text: string }).text)).toEqual(['a', 'b']);
  });

  it('没有新消息时返回原数组引用', () => {
    const current = mapHistory([ev(1, 'user/message', { content: [{ type: 'text', text: 'a' }] })]);
    expect(prependHistory(current, [])).toBe(current);
  });
});
