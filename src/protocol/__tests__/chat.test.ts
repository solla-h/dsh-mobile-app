import { applyRealtime, mapHistory, prependHistory, type HistoryEvent } from '../chat';

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

  it('Harness 注入的运行时上下文变成一条 context（对话流隐藏，轨迹页折叠）', () => {
    const messages = mapHistory([
      ev(1, 'user/message', { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'x' }] }),
    ]);
    expect(messages).toEqual([
      { id: 'h1', kind: 'context', tag: 'runtime-context', text: 'x', detail: 'x', time: 1700000000001, seq: 1 },
    ]);
  });

  it('context 的摘要按 source 取：skill 名 / 变更路径 / 引用会话', () => {
    const messages = mapHistory([
      ev(1, 'user/message', { source: { kind: 'skill-invocation', name: 'review' }, content: [{ type: 'text', text: '正文' }] }),
      ev(2, 'user/message', {
        source: { kind: 'agent-instructions', changes: [{ path: 'AGENTS.md' }, { path: 'AGENTS.md' }, { path: 'CLAUDE.md' }] },
        content: [],
      }),
      ev(3, 'user/message', {
        source: { kind: 'session-reference', references: [{ label: 'A' }] },
        content: [],
      }),
    ]);
    expect(messages.map((message) => (message as { text: string }).text)).toEqual([
      'review',
      'AGENTS.md、CLAUDE.md',
      'A',
    ]);
  });

  it('turn/end 变成结论行，error 带上错误消息（实时 reasonDetails 与 history 原始 reason 两种形状）', () => {
    const messages = mapHistory([
      ev(4, 'turn/end', { turn: 2, reason: { kind: 'success' } }),
      ev(5, 'turn/end', { turn: 3, reason: { kind: 'error' }, reasonDetails: { error: { message: '连接超时' } } }),
      ev(6, 'turn/end', { turn: 4, reason: { kind: 'error', error: { code: 'UPSTREAM_500' } } }),
    ]);
    expect(messages[0]).toMatchObject({ kind: 'outcome', turn: 2, reason: 'success', failed: false });
    expect(messages[1]).toMatchObject({ kind: 'outcome', turn: 3, failed: true, text: '本轮出错：连接超时' });
    expect(messages[2]).toMatchObject({ kind: 'outcome', turn: 4, failed: true, text: '本轮出错：UPSTREAM_500' });
  });

  it('assistant 保留 turn/step/usage，tool 用 result 时间减去 call 时间算耗时', () => {
    const messages = mapHistory([
      ev(6, 'assistant/message', {
        turn: 1,
        step: 0,
        message: { content: [{ type: 'text', text: '好' }] },
        usage: { inputTokens: 1200, outputTokens: 8 },
      }),
      ev(7, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: { command: 'ls' } }),
      ev(9, 'tool/result', { turn: 1, step: 1, callId: 'c1', output: 'a\nb', isError: false }),
    ]);
    expect(messages[0]).toMatchObject({ turn: 1, step: 0, usage: { inputTokens: 1200, outputTokens: 8 } });
    expect(messages[1]).toMatchObject({ kind: 'tool', turn: 1, step: 1, durationMs: 2 });
  });

  it('压缩与重试各留一条 warn 通知，压缩失败也留痕', () => {
    const messages = mapHistory([
      ev(1, 'compaction/summary', { shadowedSeqs: [1, 2, 3], shadowedTokenCount: 12000 }),
      ev(2, 'compaction/end', { error: 'summary failed' }),
      ev(3, 'llm/retry', { maxRetries: 3, failure: { code: 'RATE_LIMIT' } }),
    ]);
    expect(messages[0]).toMatchObject({ kind: 'notice', tone: 'warn', text: '上下文已压缩：折叠 3 项 / 12k token' });
    expect(messages[1]).toMatchObject({ kind: 'notice', tone: 'warn', text: '上下文压缩失败：summary failed' });
    expect(messages[2]).toMatchObject({ kind: 'notice', tone: 'warn', text: '模型请求失败（RATE_LIMIT），正在重试（上限 3 次）' });
  });

  it('压缩摘要带上摘要全文，轨迹页折叠着放', () => {
    const messages = mapHistory([
      ev(1, 'compaction/summary', { shadowedTokenCount: 12000, summary: '前面聊了 A、B、C' }),
    ]);
    expect(messages[0]).toMatchObject({
      kind: 'notice',
      text: '上下文已压缩：折叠 12k token',
      detail: '前面聊了 A、B、C',
    });
  });

  it('developer/message 的工具增删折成一行上下文', () => {
    const messages = mapHistory([
      ev(1, 'developer/message', {
        turn: 3,
        message: {
          source: { kind: 'tool-registry' },
          content: [
            { type: 'tool-addition', toolName: 'bash' },
            { type: 'tool-removal', toolName: 'write' },
          ],
        },
      }),
    ]);
    expect(messages[0]).toMatchObject({
      kind: 'context',
      tag: 'tool-registry',
      text: '+bash -write',
      turn: 3,
    });
    expect(messages[0]).not.toHaveProperty('detail');
  });

  it('tool/result 带出截断标记和错误码', () => {
    const messages = mapHistory([
      ev(1, 'tool/call', { callId: 'c1', name: 'bash', arguments: { command: 'x' } }),
      ev(2, 'tool/result', { callId: 'c1', output: 'x', outputTruncated: true, error: { code: 'EACCES' } }),
    ]);
    expect(messages[0]).toMatchObject({ outputTruncated: true, errorCode: 'EACCES' });
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

  it('历史 assistant/message 支持提取内嵌 <think> 标签或 thinking block 到 reasoning', () => {
    const messages = mapHistory([
      ev(8, 'assistant/message', {
        message: {
          content: [
            { type: 'thinking', thinking: '先检查连接池句柄' },
            { type: 'text', text: '<think>补充思考锁机制</think>正式结论：已修复超时。' },
          ],
        },
      }),
    ]);
    expect(messages[0]).toMatchObject({
      kind: 'assistant',
      text: '正式结论：已修复超时。',
      reasoning: '先检查连接池句柄\n\n补充思考锁机制',
    });
  });

  it('审批的审计事件对配成一条：asked 给工具名和 callId，decided 给结论', () => {
    const messages = mapHistory([
      ev(1, 'approval/asked', { id: 'a1', toolName: 'bash', callId: 'c1', reason: '需要写权限' }),
      ev(2, 'approval/decided', { id: 'a1', outcome: 'allowed-once' }),
    ]);
    expect(messages).toEqual([
      {
        id: 'h2',
        kind: 'approval',
        decision: 'approved',
        target: 'bash · 需要写权限',
        callId: 'c1',
        time: 1700000000002,
        seq: 2,
      },
    ]);
  });

  it('撤回与无人应答不当成用户拒绝，认不出的 outcome 干脆不画', () => {
    const messages = mapHistory([
      ev(1, 'approval/asked', { id: 'a1', toolName: 'bash' }),
      ev(2, 'approval/decided', { id: 'a1', outcome: 'cancelled' }),
      ev(3, 'approval/asked', { id: 'a2', toolName: 'write' }),
      ev(4, 'approval/decided', { id: 'a2', outcome: 'unavailable' }),
      ev(5, 'approval/asked', { id: 'a3', toolName: 'read' }),
      ev(6, 'approval/decided', { id: 'a3', outcome: 'who-knows' }),
      ev(7, 'approval/decided', { id: 'orphan', outcome: 'rejected' }),
    ]);
    expect(messages.map((message) => (message as { decision?: string }).decision)).toEqual([
      'canceled',
      'unavailable',
      'denied',
    ]);
    // 没配到 asked 的 decided 照样留痕，只是没有工具名可显示。
    expect(messages[2]).toMatchObject({ target: '工具调用' });
  });

  it('同一步的连续重试并成一行，只涨次数；上游那坨 JSON 压成一行', () => {
    const balloon = `429 {"error":{"message":"${'x'.repeat(400)}"}}`;
    const messages = mapHistory([
      ev(1, 'llm/retry', { turn: 2, step: 3, maxRetries: 5, failure: { message: balloon } }),
      ev(2, 'llm/retry', { turn: 2, step: 3, maxRetries: 5, failure: { message: balloon } }),
      ev(3, 'llm/retry', { turn: 2, step: 4, maxRetries: 5, failure: { status: 429 } }),
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      kind: 'notice',
      tone: 'warn',
      seq: 1,
      text: `模型请求失败（${balloon.slice(0, 80)}…），已重试 2 次（上限 5 次）`,
    });
    expect(messages[1]).toMatchObject({ seq: 3, text: '模型请求失败（HTTP 429），正在重试（上限 5 次）' });
  });

  it('出错原因截到能跟用时挤进两行，别把分隔线撑爆', () => {
    const messages = mapHistory([
      ev(1, 'turn/end', { turn: 2, reason: { kind: 'error', error: { message: 'y'.repeat(300) } } }),
    ]);
    expect((messages[0] as { text: string }).text).toBe(`本轮出错：${'y'.repeat(48)}…`);
  });

  it('历史 tool/result 的失败判定：message.isError / data.error / 结果块三处任一为真', () => {
    const call = ev(1, 'tool/call', { callId: 'c1', name: 'bash', arguments: { command: 'x' } });
    const byMessage = mapHistory([
      call,
      ev(2, 'tool/result', { callId: 'c1', message: { isError: true, content: [{ type: 'text', text: 'boom' }] } }),
    ]);
    expect(byMessage[0]).toMatchObject({ isError: true });
    const byError = mapHistory([
      call,
      ev(2, 'tool/result', { callId: 'c1', error: { name: 'ToolError', code: 'EACCES' } }),
    ]);
    expect(byError[0]).toMatchObject({ isError: true, errorCode: 'EACCES' });
    const byBlock = mapHistory([
      call,
      ev(2, 'tool/result', { callId: 'c1', message: { content: [{ type: 'tool-result', isError: true }] } }),
    ]);
    expect(byBlock[0]).toMatchObject({ isError: true });
  });
});

describe('applyRealtime', () => {
  it('实时帧把 source 拍成字符串，context 摘要只能退化成 kind', () => {
    const messages = applyRealtime([], { type: 'user/message', source: 'skill-invocation', text: '正文' }, 1, 1000);
    expect(messages[0]).toMatchObject({ kind: 'context', tag: 'skill-invocation', text: 'skill-invocation', detail: '正文' });
  });

  it('实时 assistant 也要认 finish/interrupted，不能等重拉历史才显示失败', () => {
    const messages = applyRealtime([], { type: 'assistant/message', text: '', finish: { kind: 'error' } }, 2, 1000);
    expect(messages[0]).toMatchObject({ kind: 'assistant', failure: 'error' });
  });

  it('实时 turn/end 的 reason 已经是拍平的字符串', () => {
    const messages = applyRealtime([], { type: 'turn/end', turn: 4, reason: 'aborted' }, 3, 1000);
    expect(messages[0]).toMatchObject({ kind: 'outcome', turn: 4, reason: 'aborted', failed: true });
  });

  it('同一个 seq 的事件只进一次', () => {
    const once = applyRealtime([], { type: 'turn/end', turn: 1, reason: 'success' }, 9, 1000);
    expect(applyRealtime(once, { type: 'turn/end', turn: 1, reason: 'success' }, 9, 1000)).toBe(once);
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
