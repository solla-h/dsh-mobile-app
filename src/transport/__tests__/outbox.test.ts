import { readJson } from '../../storage/persisted-state';
import {
  OutboxStore,
  UNCONFIRMED_AFTER_MS,
  displayStatusOf,
  normalizeOutboxItem,
} from '../outbox';
import type { ClientFrame } from '../../protocol/types';

jest.mock('../../storage/persisted-state', () => ({
  readJson: jest.fn(),
  writeJson: jest.fn(() => Promise.resolve()),
}));

// jest-expo 的 expo-crypto mock 不实现 randomUUID，这里给个递增序号。
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `uuid-${(n += 1)}` };
});

const readJsonMock = readJson as jest.MockedFunction<typeof readJson>;

/** 记录每次 send 的帧；可以指定从第几次开始返回 false（模拟写不进 socket）。 */
const recorder = (failAt?: number) => {
  const frames: ClientFrame[] = [];
  const send = (frame: ClientFrame): boolean => {
    frames.push(frame);
    return failAt === undefined || frames.length !== failAt;
  };
  return { frames, send };
};

const messageFrame = (frame: ClientFrame) =>
  frame as { type: string; requestId: string; sessionId: string; text: string };

describe('OutboxStore 回执闭环', () => {
  let store: OutboxStore;

  beforeEach(() => {
    store = new OutboxStore();
  });
  afterEach(() => {
    store.dispose();
  });

  it('add 时就把 requestId / gatewayId / 待发状态都定下来', () => {
    const item = store.add({ sessionId: 's1', text: '你好', gatewayId: 'gw-a' });
    expect(item.requestId).toBeTruthy();
    expect(item.status).toBe('pending');
    expect(item.gatewayId).toBe('gw-a');
    expect(store.countFor('s1')).toBe(1);
  });

  it('flush 只发当前网关的条目，帧里带条目的 requestId；发完先标「待确认」不删', () => {
    const mine = store.add({ sessionId: 's1', text: 'A', gatewayId: 'gw-a' });
    store.add({ sessionId: 's2', text: 'B', gatewayId: 'gw-b' });
    const { frames, send } = recorder();
    const result = store.flush(send, 'gw-a');

    expect(result).toEqual({ sent: 1, adopted: 0 });
    expect(frames).toHaveLength(1);
    const frame = messageFrame(frames[0]);
    expect(frame.type).toBe('message');
    expect(frame.requestId).toBe(mine.requestId);
    expect(frame.sessionId).toBe('s1');
    // 已写进 socket 但还没回执：条目仍在，状态是 sending
    const [kept] = store.list('s1');
    expect(kept.status).toBe('sending');
    expect(kept.sentAt).toBeGreaterThan(0);
    // 别的网关的条目原样不动，也没有被发出去
    expect(store.list('s2')[0].status).toBe('pending');
  });

  it('ack 按 requestId 删条目；不相关的回执不误删', () => {
    const first = store.add({ sessionId: 's1', text: 'A', gatewayId: 'gw-a' });
    const second = store.add({ sessionId: 's1', text: 'B', gatewayId: 'gw-a' });
    const { send } = recorder();
    store.flush(send, 'gw-a');

    expect(store.ack('不是这个')).toBe(false);
    expect(store.count()).toBe(2);
    expect(store.ack(first.requestId)).toBe(true);
    expect(store.list('s1').map((item) => item.id)).toEqual([second.id]);
  });

  it('fail 按 requestId 标失败并记原因；失败项不会被 flush 重发', () => {
    const item = store.add({ sessionId: 's1', text: 'A', gatewayId: 'gw-a' });
    const { send } = recorder();
    store.flush(send, 'gw-a');

    expect(store.fail(item.requestId, 'session/not-found：会话不存在')).toBe(true);
    const [kept] = store.list('s1');
    expect(kept.status).toBe('failed');
    expect(kept.error).toContain('会话不存在');

    const again = recorder();
    expect(store.flush(again.send, 'gw-a')).toEqual({ sent: 0, adopted: 0 });
    expect(again.frames).toHaveLength(0);
  });

  it('写不进 socket 就停下：后面的条目保持待发，顺序不被插队', () => {
    const a = store.add({ sessionId: 's1', text: 'A', gatewayId: 'gw-a' });
    const b = store.add({ sessionId: 's1', text: 'B', gatewayId: 'gw-a' });
    const c = store.add({ sessionId: 's1', text: 'C', gatewayId: 'gw-a' });
    const { frames, send } = recorder(2); // 第二条开始写不进去
    const result = store.flush(send, 'gw-a');

    expect(result.sent).toBe(1);
    expect(messageFrame(frames[0]).requestId).toBe(a.requestId);
    expect(store.list('s1').map((item) => [item.text, item.status])).toEqual([
      ['A', 'sending'],
      ['B', 'pending'],
      ['C', 'pending'],
    ]);
    // 恢复后重排：B、C 依次发出
    const retry = recorder();
    expect(store.flush(retry.send, 'gw-a').sent).toBe(2);
    expect(retry.frames.map((frame) => messageFrame(frame).requestId)).toEqual([
      b.requestId,
      c.requestId,
    ]);
  });

  it('手动 retry：换新 requestId（旧回执不能再命中），回到待发可再 flush', () => {
    const item = store.add({ sessionId: 's1', text: 'A', gatewayId: 'gw-a' });
    const { send } = recorder();
    store.flush(send, 'gw-a');
    store.fail(item.requestId, '拒收');
    const oldRequestId = item.requestId;

    expect(store.retry(item.id)).toBe(true);
    const [fresh] = store.list('s1');
    expect(fresh.status).toBe('pending');
    expect(fresh.requestId).not.toBe(oldRequestId);
    expect(fresh.error).toBeUndefined();
    // 迟到的旧回执不再影响新一次发送
    expect(store.ack(oldRequestId)).toBe(false);

    const again = recorder();
    expect(store.flush(again.send, 'gw-a').sent).toBe(1);
    expect(messageFrame(again.frames[0]).requestId).toBe(fresh.requestId);
  });

  it('track：连着发的条目直接以「等回执」入箱，用调用方的 requestId，flush 不重发', () => {
    const item = store.track({
      sessionId: 's1',
      text: '连着发',
      gatewayId: 'gw-a',
      requestId: 'req-1',
    });
    expect(item.status).toBe('sending');
    expect(item.sentAt).toBeGreaterThan(0);
    expect(store.countFor('s1')).toBe(1);

    // 在等回执：不该被 flush 再发一遍（重复发送会出重复消息）
    const { frames, send } = recorder();
    expect(store.flush(send, 'gw-a').sent).toBe(0);
    expect(frames).toHaveLength(0);

    // 回执按调用方给的 requestId 归位
    expect(store.ack('req-1')).toBe(true);
    expect(store.countFor('s1')).toBe(0);
  });

  it('track 带文件收据：重试后随 flush 帧透传，读盘校验保住合法收据', () => {
    const files = [{ receiptId: 'r-1' }, { receiptId: 'r-2' }];
    const item = store.track({
      sessionId: 's1',
      text: '',
      files,
      gatewayId: 'gw-a',
      requestId: 'req-1',
    });
    expect(item.files).toEqual(files);

    // 未确认后用户手动重试：回到 pending，flush 时收据原样进帧
    store.retry(item.id);
    const { frames, send } = recorder();
    store.flush(send, 'gw-a');
    expect((frames[0] as { files?: unknown }).files).toEqual(files);

    // 落盘再读回：合法收据保留，坏条目丢掉
    const normalized = normalizeOutboxItem({
      ...item,
      status: 'pending',
      files: [{ receiptId: 'r-1' }, { nope: 1 }, null],
    });
    expect(normalized?.files).toEqual([{ receiptId: 'r-1' }]);
  });

  it('旧版本条目读盘时补全字段，flush 时按当前网关收养一次', async () => {
    readJsonMock.mockResolvedValueOnce([
      { id: 'old-1', sessionId: 's1', text: '老消息', createdAt: 1 },
    ]);
    const legacyStore = new OutboxStore();
    await legacyStore.load();

    const [legacy] = legacyStore.list('s1');
    expect(legacy.requestId).toBeTruthy();
    expect(legacy.status).toBe('pending');
    expect(legacy.gatewayId).toBeUndefined();

    const { frames, send } = recorder();
    expect(legacyStore.flush(send, 'gw-a')).toEqual({ sent: 1, adopted: 1 });
    expect(messageFrame(frames[0]).sessionId).toBe('s1');
    expect(legacyStore.list('s1')[0].gatewayId).toBe('gw-a');
    // 收养只发生一次
    const again = recorder();
    expect(legacyStore.flush(again.send, 'gw-a').adopted).toBe(0);
    legacyStore.dispose();
  });

  it('坏数据整条丢弃，不连坐其他条目', () => {
    expect(normalizeOutboxItem(null)).toBeNull();
    expect(normalizeOutboxItem({ id: 'x', sessionId: 's1' })).toBeNull(); // 缺 text
    expect(normalizeOutboxItem({ id: 1, sessionId: 's1', text: 'a' })).toBeNull();
  });
});

describe('displayStatusOf', () => {
  const base = {
    id: 'i',
    sessionId: 's',
    text: 't',
    createdAt: 0,
    requestId: 'r',
  };

  it('sending 没超时显示待确认，超时显示未确认', () => {
    const item = { ...base, status: 'sending' as const, sentAt: 1_000 };
    expect(displayStatusOf(item, 1_000 + UNCONFIRMED_AFTER_MS)).toBe('sending');
    expect(displayStatusOf(item, 1_000 + UNCONFIRMED_AFTER_MS + 1)).toBe('unconfirmed');
  });

  it('pending / failed 原样透传', () => {
    expect(displayStatusOf({ ...base, status: 'pending' as const }, 9e12)).toBe('pending');
    expect(displayStatusOf({ ...base, status: 'failed' as const }, 9e12)).toBe('failed');
  });
});
