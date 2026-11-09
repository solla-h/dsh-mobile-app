import { activitySummary, groupMessages, type ActivityStep } from '../group';
import type { ChatMessage } from '../../../protocol/chat';

const at = (id: string, n: number): number => 1000 + n;

function user(id: string, text: string, n: number): ChatMessage {
  return { id, kind: 'user', text, time: at(id, n) };
}
function think(id: string, text: string, n: number): ChatMessage {
  return { id, kind: 'assistant', text: '', reasoning: text, time: at(id, n) };
}
function answer(id: string, text: string, n: number): ChatMessage {
  return { id, kind: 'assistant', text, time: at(id, n) };
}
function tool(id: string, n: number): ChatMessage {
  return { id, kind: 'tool', name: 'exec', output: 'ok', time: at(id, n) };
}
function running(id: string, n: number): ChatMessage {
  return { id, kind: 'tool', name: 'exec', time: at(id, n) };
}

describe('groupMessages activity 折叠', () => {
  it('正式回答之前的思考与工具收成一个 activity 胶囊', () => {
    const rows = groupMessages([
      user('u1', '问题', 1),
      think('t1', '想一想', 2),
      tool('c1', 3),
      think('t2', '再想想', 4),
      tool('c2', 5),
      tool('c3', 6),
      answer('a1', '正式回答', 7),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(['message', 'activity', 'message']);
    const activity = rows[1];
    if (activity.kind !== 'activity') throw new Error('unexpected');
    // 两个纯思考 + 两组工具
    expect(activity.steps.map((step) => step.kind)).toEqual(['message', 'tools', 'message', 'tools']);
    const answerRow = rows[2];
    if (answerRow.kind !== 'message' || answerRow.message.kind !== 'assistant') {
      throw new Error('unexpected');
    }
    expect(answerRow.message.text).toBe('正式回答');
  });

  it('最后一轮还在跑时保持原样（实时进度不被藏）', () => {
    const rows = groupMessages([user('u1', '问题', 1), think('t1', '思考中', 2), running('c1', 3)], {
      running: true,
    });
    expect(rows.map((row) => row.kind)).toEqual(['message', 'message', 'tools']);
  });

  it('最后一轮已结束（没有正文）也折叠成胶囊', () => {
    const rows = groupMessages([user('u1', '问题', 1), think('t1', '思考', 2), tool('c1', 3)]);
    expect(rows.map((row) => row.kind)).toEqual(['message', 'activity']);
  });

  it('用户消息打断时上一轮活动折叠（那一轮已结束）', () => {
    const rows = groupMessages([
      user('u1', '问题 1', 1),
      think('t1', '思考', 2),
      user('u2', '问题 2', 3),
      answer('a1', '回答 2', 4),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(['message', 'activity', 'message', 'message']);
  });

  it('多段正文：每段回答前的活动各自折叠', () => {
    const rows = groupMessages([
      user('u1', '问题', 1),
      think('t1', '第一段思考', 2),
      answer('a1', '中间回答', 3),
      think('t2', '第二段思考', 4),
      answer('a2', '最终回答', 5),
    ]);
    expect(rows.map((row) => row.kind)).toEqual([
      'message',
      'activity',
      'message',
      'activity',
      'message',
    ]);
  });

  it('同一 assistant 自带 reasoning 与正文时原样保留（ThinkPill 自行折叠）', () => {
    const message: ChatMessage = {
      id: 'a1',
      kind: 'assistant',
      text: '回答',
      reasoning: '思考',
      time: 2000,
    };
    const rows = groupMessages([user('u1', '问题', 1), message]);
    expect(rows.map((row) => row.kind)).toEqual(['message', 'message']);
  });
});

describe('activitySummary', () => {
  const toolStep = (
    entries: { name: string; output?: string; isError?: boolean }[],
  ): ActivityStep => ({
    kind: 'tools',
    id: 'tools-1',
    tools: entries.map((entry, index) => ({
      id: `t${index}`,
      name: entry.name,
      time: 0,
      output: 'output' in entry ? entry.output : 'ok',
      isError: entry.isError,
    })),
  });

  it('思考段数与工具名（单个工具不带「等」）', () => {
    const summary = activitySummary([
      { kind: 'message', id: 'm1', message: think('t1', '想', 1) },
      toolStep([{ name: 'bash' }]),
    ]);
    expect(summary).toEqual({ label: '思考 1 段 · 调用 Bash', failed: 0 });
  });

  it('两个工具名用顿号并列', () => {
    const summary = activitySummary([toolStep([{ name: 'read' }, { name: 'bash' }])]);
    expect(summary.label).toBe('调用 Read、Bash');
  });

  it('超过两个工具名折叠成「等 N 步」', () => {
    const summary = activitySummary([
      toolStep([{ name: 'bash' }, { name: 'read' }, { name: 'grep' }, { name: 'edit' }]),
    ]);
    expect(summary).toEqual({ label: '调用 Bash、Read 等 4 步', failed: 0 });
  });

  it('失败计数：isError 与退出码都算，running（无 output）不算', () => {
    const summary = activitySummary([
      toolStep([
        { name: 'bash', isError: true },
        { name: 'build', output: 'boom\n[exit code: 1]' },
        { name: 'read', output: undefined },
      ]),
    ]);
    // running 的工具名也计入「等 N 步」的总数。
    expect(summary.failed).toBe(2);
    expect(summary.label).toBe('调用 Bash、Build 等 3 步 · 2 次失败');
  });
});
