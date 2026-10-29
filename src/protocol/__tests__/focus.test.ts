import { selectFocusSessions } from '../focus';
import type { OutlineMap } from '../outline-cache';
import { applyPendingFrame, type PendingMap } from '../pending';
import type { ServerFrame, SessionItem } from '../types';

const session = (overrides: Partial<SessionItem> & { sessionId: string }): SessionItem => ({
  updatedAt: 1_000,
  running: false,
  blank: false,
  ...overrides,
});

/** 待办用真实归约器造，省得跟着 PendingInteraction 的字段漂移。 */
const pendingOf = (spec: Record<string, number>): PendingMap => {
  let map: PendingMap = {};
  for (const [sessionId, count] of Object.entries(spec)) {
    for (let i = 0; i < count; i += 1) {
      const frame = { kind: 'approval-requested', rpcId: sessionId + ':' + i, sessionId };
      map = applyPendingFrame(map, frame as unknown as ServerFrame) ?? map;
    }
  }
  return map;
};

/** 一轮大纲：response 是 agent 上一轮说过的话，卡片上就显示它。 */
const outlineOf = (responses: Record<string, string>): OutlineMap => {
  const map: OutlineMap = {};
  for (const [sessionId, response] of Object.entries(responses)) {
    map[sessionId] = [{ turn: 1, seq: 1, prompt: '修一下构建', response }];
  }
  return map;
};

const ids = (entries: { sessionId: string }[]) => entries.map((entry) => entry.sessionId);

describe('selectFocusSessions', () => {
  it('子会话不进网格', () => {
    const sessions = [
      session({ sessionId: 'main', running: true }),
      session({ sessionId: 'child', running: true, parentSessionId: 'main' }),
    ];
    expect(ids(selectFocusSessions(sessions, { pending: {} }))).toEqual(['main']);
  });

  it('归档的会话不进网格', () => {
    const sessions = [
      session({ sessionId: 'gone', running: true }),
      session({ sessionId: 'live', running: true }),
    ];
    const entries = selectFocusSessions(sessions, { pending: {}, archivedIds: ['gone'] });
    expect(ids(entries)).toEqual(['live']);
  });

  it('空白会话即使有待办也不进网格', () => {
    const sessions = [
      session({ sessionId: 'empty', blank: true, running: true }),
      session({ sessionId: 'real', running: true }),
    ];
    const entries = selectFocusSessions(sessions, { pending: pendingOf({ empty: 1 }) });
    expect(ids(entries)).toEqual(['real']);
  });

  it('只在跑的会话也入选，字段完整', () => {
    const sessions = [
      session({ sessionId: 'run', running: true, updatedAt: 1_700_000_000_000 }),
    ];
    expect(selectFocusSessions(sessions, { pending: {} })).toEqual([
      {
        sessionId: 'run',
        title: '',
        updatedAt: 1_700_000_000_000,
        running: true,
        pendingCount: 0,
        summary: '',
      },
    ]);
  });

  it('只有待办、没在跑的会话也入选', () => {
    const sessions = [session({ sessionId: 'wait' })];
    const entries = selectFocusSessions(sessions, { pending: pendingOf({ wait: 1 }) });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ sessionId: 'wait', running: false, pendingCount: 1 });
  });

  it('有待办的排在只在跑的前面，哪怕它更旧', () => {
    const sessions = [
      session({ sessionId: 'run-new', running: true, updatedAt: 9_000 }),
      session({ sessionId: 'wait-old', updatedAt: 1_000 }),
    ];
    const entries = selectFocusSessions(sessions, { pending: pendingOf({ 'wait-old': 1 }) });
    expect(ids(entries)).toEqual(['wait-old', 'run-new']);
  });

  it('同一档内按最近活动倒序，待办多的更靠前', () => {
    const running = [
      session({ sessionId: 'old', running: true, updatedAt: 1_000 }),
      session({ sessionId: 'new', running: true, updatedAt: 5_000 }),
    ];
    expect(ids(selectFocusSessions(running, { pending: {} }))).toEqual(['new', 'old']);

    const waiting = [
      session({ sessionId: 'few', updatedAt: 5_000 }),
      session({ sessionId: 'many', updatedAt: 1_000 }),
    ];
    const entries = selectFocusSessions(waiting, { pending: pendingOf({ few: 1, many: 3 }) });
    expect(ids(entries)).toEqual(['many', 'few']);
  });

  it('默认最多四张卡，传更大的 limit 也压到四张', () => {
    const sessions = Array.from({ length: 6 }, (_, index) =>
      session({ sessionId: 's' + index, running: true, updatedAt: index * 1_000 }),
    );
    expect(selectFocusSessions(sessions, { pending: {} })).toHaveLength(4);
    expect(selectFocusSessions(sessions, { pending: {}, limit: 9 })).toHaveLength(4);
    expect(selectFocusSessions(sessions, { pending: {}, limit: 2 })).toHaveLength(2);
    expect(selectFocusSessions(sessions, { pending: {}, limit: 0 })).toEqual([]);
  });

  it('摘要取自最近一轮回复，没有大纲时是空串', () => {
    const sessions = [
      session({ sessionId: 'with-outline', running: true }),
      session({ sessionId: 'no-outline', running: true }),
    ];
    const entries = selectFocusSessions(sessions, {
      pending: {},
      outlines: outlineOf({ 'with-outline': '已修好构建，等你确认' }),
    });
    const summaryOf = (sessionId: string) =>
      entries.find((entry) => entry.sessionId === sessionId)?.summary;
    expect(summaryOf('with-outline')).toBe('已修好构建，等你确认');
    expect(summaryOf('no-outline')).toBe('');
    expect(selectFocusSessions(sessions, { pending: {} })[0].summary).toBe('');
  });

  it('没有标题时保持空串，只有空白的标题也被 trim 掉', () => {
    const sessions = [
      session({ sessionId: 'no-title', running: true, updatedAt: 2_000 }),
      session({
        sessionId: 'spaces',
        running: true,
        updatedAt: 1_000,
        projections: { asOfSeq: 1, values: { title: '   ' } },
      }),
    ];
    expect(selectFocusSessions(sessions, { pending: {} }).map((entry) => entry.title)).toEqual([
      '',
      '',
    ]);
  });

  it('没有待办也没有在跑时，仍然常驻最近的会话（只是排在后面）', () => {
    const sessions = [
      session({ sessionId: 'old', updatedAt: 1_000 }),
      session({ sessionId: 'new', updatedAt: 9_000 }),
      session({ sessionId: 'blank', blank: true }),
    ];
    expect(ids(selectFocusSessions(sessions, { pending: {} }))).toEqual(['new', 'old']);
  });

  it('排序优先级：待审批 > 进行中 > 刚聊过', () => {
    const sessions = [
      session({ sessionId: 'idle-new', updatedAt: 9_000 }),
      session({ sessionId: 'running-old', running: true, updatedAt: 1_000 }),
      session({ sessionId: 'wait-oldest', updatedAt: 100 }),
    ];
    const entries = selectFocusSessions(sessions, { pending: pendingOf({ 'wait-oldest': 1 }) });
    expect(ids(entries)).toEqual(['wait-oldest', 'running-old', 'idle-new']);
  });

  it('常驻四张卡：六个会话也只取最靠前的四个', () => {
    const sessions = Array.from({ length: 6 }, (_, index) =>
      session({ sessionId: 's' + index, updatedAt: index * 1_000 }),
    );
    expect(ids(selectFocusSessions(sessions, { pending: {} }))).toEqual([
      's5',
      's4',
      's3',
      's2',
    ]);
  });
});
