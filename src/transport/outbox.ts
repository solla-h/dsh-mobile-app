import { randomUUID } from 'expo-crypto';

import { readJson, writeJson } from '../storage/persisted-state';
import type { ClientFrame, OutgoingImage } from '../protocol/types';

/**
 * 离线发件箱。
 *
 * 断线时发的消息不能就这么丢掉：先落盘，连上之后按原顺序重发。
 * 但「写进 socket」不等于服务端收到，所以条目不再发完即删：
 *   pending --flush 写进 socket--> sending --`sent` 回执--> 删除
 *                                       \--`error` 回执--> failed
 *                                       \--超时没回执--> 按未确认展示
 * 超时与失败都只提示 + 等用户手动重试——网关对普通消息不去重，自动重发会出重复消息。
 * 条目带 gatewayId：切到别的网关时不会把上一个网关的待发消息误发过去。
 */
export type OutboxStatus = 'pending' | 'sending' | 'failed';

export interface OutboxItem {
  id: string;
  /** 写入时所属网关；旧版本数据没有这个字段，flush 时按当前活动网关收养 */
  gatewayId?: string;
  sessionId: string;
  text: string;
  images?: OutgoingImage[];
  /**
   * 已上传文件的收据（只有「连着发但没等到回执」的条目才有）。
   * 收据绑在创建它的连接上：断线后重试多半会被网关拒（回执过期），失败会照常展示。
   */
  files?: { receiptId: string }[];
  mode?: 'queue' | 'steer';
  createdAt: number;
  /** 随 message 帧发给网关；sent/error 回执按它归位 */
  requestId: string;
  status: OutboxStatus;
  /** status === 'sending' 的发出时刻 */
  sentAt?: number;
  /** status === 'failed' 时展示的失败原因 */
  error?: string;
}

/** `sending` 超过这个时长还没等到回执，就按「未确认」展示（不改数据、不自动重发）。 */
export const UNCONFIRMED_AFTER_MS = 20_000;

/** 展示状态：只多一个派生值 unconfirmed，持久化的仍是三态。 */
export function displayStatusOf(item: OutboxItem, now: number): OutboxStatus | 'unconfirmed' {
  if (
    item.status === 'sending' &&
    item.sentAt !== undefined &&
    now - item.sentAt > UNCONFIRMED_AFTER_MS
  ) {
    return 'unconfirmed';
  }
  return item.status;
}

/** 读盘时的整条校验：坏数据不该让整个发件箱失效；旧版本条目在这里补齐新字段。 */
export function normalizeOutboxItem(raw: unknown): OutboxItem | null {
  const item = raw as Partial<OutboxItem> | null;
  if (
    !item ||
    typeof item.id !== 'string' ||
    typeof item.sessionId !== 'string' ||
    typeof item.text !== 'string'
  ) {
    return null;
  }
  return {
    id: item.id,
    gatewayId: typeof item.gatewayId === 'string' ? item.gatewayId : undefined,
    sessionId: item.sessionId,
    text: item.text,
    images: Array.isArray(item.images) ? (item.images as OutgoingImage[]) : undefined,
    files: Array.isArray(item.files)
      ? item.files.filter(
          (entry): entry is { receiptId: string } =>
            Boolean(entry) && typeof (entry as { receiptId?: unknown }).receiptId === 'string',
        )
      : undefined,
    mode: item.mode === 'steer' || item.mode === 'queue' ? item.mode : undefined,
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
    // 「发出即删」时代的遗留条目没有这两个字段：补一个 requestId 并按待发处理。
    requestId:
      typeof item.requestId === 'string' && item.requestId ? item.requestId : randomUUID(),
    status: item.status === 'sending' || item.status === 'failed' ? item.status : 'pending',
    sentAt: typeof item.sentAt === 'number' ? item.sentAt : undefined,
    error: typeof item.error === 'string' ? item.error : undefined,
  };
}

const STORAGE_KEY = 'outbox';

type Listener = () => void;

export interface FlushResult {
  /** 本次真正写进 socket 的条数 */
  sent: number;
  /** 本次按当前网关收养的旧版本条目数 */
  adopted: number;
}

/** 展示用的条目：多一个查询时折算的 displayStatus。 */
export interface OutboxDisplayItem extends OutboxItem {
  displayStatus: OutboxStatus | 'unconfirmed';
}

export class OutboxStore {
  private items: OutboxItem[] = [];
  private listeners = new Set<Listener>();
  private loaded = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;

  async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await readJson<unknown>(STORAGE_KEY);
    this.loaded = true;
    if (!Array.isArray(stored)) return;
    this.items = stored
      .map(normalizeOutboxItem)
      .filter((item): item is OutboxItem => item !== null);
    this.emit();
    this.armStaleTimer();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 某个会话的待发消息，按加入顺序。 */
  list(sessionId: string): OutboxItem[] {
    return this.items.filter((item) => item.sessionId === sessionId);
  }

  /**
   * 展示用列表：查询时把「sending 超时」折算成派生状态。
   * 时钟收在模块里，界面渲染保持纯函数（react-hooks/purity）。
   */
  listForDisplay(sessionId: string): OutboxDisplayItem[] {
    const now = Date.now();
    return this.items
      .filter((item) => item.sessionId === sessionId)
      .map((item) => ({ ...item, displayStatus: displayStatusOf(item, now) }));
  }

  count(): number {
    return this.items.length;
  }

  /** 某个会话还有几条没确认，列表上打标用。 */
  countFor(sessionId: string): number {
    return this.items.reduce((total, item) => (item.sessionId === sessionId ? total + 1 : total), 0);
  }

  add(input: {
    sessionId: string;
    text: string;
    images?: OutgoingImage[];
    mode?: 'queue' | 'steer';
    gatewayId?: string;
  }): OutboxItem {
    const item: OutboxItem = {
      id: randomUUID(),
      gatewayId: input.gatewayId,
      sessionId: input.sessionId,
      text: input.text,
      images: input.images,
      mode: input.mode,
      createdAt: Date.now(),
      requestId: randomUUID(),
      status: 'pending',
    };
    this.items = [...this.items, item];
    this.commit();
    return item;
  }

  /**
   * 连着发（帧已写进 socket）的条目：直接以「等回执」状态入箱。
   * 与 add 的区别只是起点——同样靠 `sent` 回执删除、超时转「未确认」、可手动重试。
   * 这样「TCP 活着但网关对该消息静默」时不会永远停在「发送中…」，退回列表也有待发标记。
   */
  track(input: {
    sessionId: string;
    text: string;
    images?: OutgoingImage[];
    files?: { receiptId: string }[];
    mode?: 'queue' | 'steer';
    gatewayId?: string;
    requestId: string;
  }): OutboxItem {
    const item: OutboxItem = {
      id: randomUUID(),
      gatewayId: input.gatewayId,
      sessionId: input.sessionId,
      text: input.text,
      images: input.images,
      files: input.files,
      mode: input.mode,
      createdAt: Date.now(),
      requestId: input.requestId,
      status: 'sending',
      sentAt: Date.now(),
    };
    this.items = [...this.items, item];
    this.commit();
    return item;
  }

  remove(id: string): void {
    const next = this.items.filter((item) => item.id !== id);
    if (next.length === this.items.length) return;
    this.items = next;
    this.commit();
  }

  /** 网关回执 `sent`：命中 requestId 才算真正收到，删条目。 */
  ack(requestId: string | undefined): boolean {
    if (!requestId) return false;
    const next = this.items.filter((item) => item.requestId !== requestId);
    if (next.length === this.items.length) return false;
    this.items = next;
    this.commit();
    return true;
  }

  /** 网关回执 `error`：标失败，等用户决定重试还是移除，不自动重发。 */
  fail(requestId: string | undefined, error?: string): boolean {
    if (!requestId) return false;
    let hit = false;
    this.items = this.items.map((item) => {
      if (item.requestId !== requestId) return item;
      hit = true;
      return { ...item, status: 'failed' as const, sentAt: undefined, error };
    });
    if (hit) this.commit();
    return hit;
  }

  /** 手动重试：换一个 requestId（上一次的迟到回执不能再命中它），回到待发。 */
  retry(id: string): boolean {
    let hit = false;
    this.items = this.items.map((item) => {
      if (item.id !== id) return item;
      hit = true;
      return {
        ...item,
        status: 'pending' as const,
        requestId: randomUUID(),
        sentAt: undefined,
        error: undefined,
      };
    });
    if (hit) this.commit();
    return hit;
  }

  /**
   * 把发件箱里「属于当前网关、还没发出去」的条目发出去。
   * - 只发 `pending`：`sending` 在等回执、`failed` 等用户拍板，都不重发；
   * - 一旦某条写不进 socket 就停下，保证先后顺序不被后面的消息插队；
   * - 别的网关的条目原样留着；旧版本没有 gatewayId 的条目按当前网关收养一次。
   */
  flush(send: (frame: ClientFrame) => boolean, gatewayId?: string): FlushResult {
    if (this.items.length === 0) return { sent: 0, adopted: 0 };
    const next: OutboxItem[] = [];
    let sent = 0;
    let adopted = 0;
    let blocked = false;
    for (const item of this.items) {
      const adopting = item.gatewayId === undefined && gatewayId !== undefined;
      const base = adopting ? { ...item, gatewayId } : item;
      if (adopting) adopted += 1;
      const owner = base.gatewayId;
      if (gatewayId !== undefined && owner !== gatewayId) {
        // 别的网关的待发消息：留在发件箱，等切回那个网关再发。
        next.push(item);
        continue;
      }
      if (blocked || base.status !== 'pending') {
        next.push(base);
        continue;
      }
      const ok = send({
        type: 'message',
        requestId: base.requestId,
        sessionId: base.sessionId,
        text: base.text,
        mode: base.mode ?? 'queue',
        images: base.images,
        files: base.files,
      });
      if (ok) {
        sent += 1;
        next.push({ ...base, status: 'sending', sentAt: Date.now(), error: undefined });
      } else {
        blocked = true;
        next.push(base);
      }
    }
    if (sent > 0 || adopted > 0) {
      this.items = next;
      this.commit();
    }
    return { sent, adopted };
  }

  /** 测试用：清掉待触发的内部定时器（生产路径靠状态变化自然重排）。 */
  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.staleTimer) {
      clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** 状态有变：通知界面、落盘、重排「未确认」提醒。 */
  private commit(): void {
    this.emit();
    this.persist();
    this.armStaleTimer();
  }

  /**
   * 到最早一条 `sending` 的「未确认」时刻再通知一次界面
   * （从「待确认」翻成「未确认」），只翻这一次，不循环。
   */
  private armStaleTimer(): void {
    if (this.staleTimer) {
      clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }
    let earliest = Number.POSITIVE_INFINITY;
    for (const item of this.items) {
      if (item.status === 'sending' && item.sentAt !== undefined) {
        earliest = Math.min(earliest, item.sentAt + UNCONFIRMED_AFTER_MS);
      }
    }
    if (!Number.isFinite(earliest)) return;
    this.staleTimer = setTimeout(() => {
      this.staleTimer = null;
      this.emit();
    }, Math.max(0, earliest - Date.now()) + 50);
  }

  private persist(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    // 连续发多条时只写一次盘。
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void writeJson(STORAGE_KEY, this.items);
    }, 120);
  }
}

export const outbox = new OutboxStore();
