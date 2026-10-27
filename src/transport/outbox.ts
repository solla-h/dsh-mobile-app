import { randomUUID } from 'expo-crypto';

import { readJson, writeJson } from '../storage/persisted-state';
import type { ClientFrame, OutgoingImage } from '../protocol/types';

/**
 * 离线发件箱。
 *
 * 断线时发的消息不能就这么丢掉：先落盘，连上之后按原顺序重发。
 * 放在模块级单例里，这样切会话、切页面都不会把待发内容弄丢。
 */
export interface OutboxItem {
  id: string;
  sessionId: string;
  text: string;
  images?: OutgoingImage[];
  mode?: 'queue' | 'steer';
  createdAt: number;
}

const STORAGE_KEY = 'outbox';

type Listener = () => void;

class OutboxStore {
  private items: OutboxItem[] = [];
  private listeners = new Set<Listener>();
  private loaded = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await readJson<OutboxItem[]>(STORAGE_KEY);
    this.loaded = true;
    if (!Array.isArray(stored)) return;
    // 只保留形状完整的条目，坏数据不该让整个发件箱失效。
    this.items = stored.filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.sessionId === 'string' &&
        typeof item.text === 'string',
    );
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 某个会话的待发消息，按加入顺序。 */
  list(sessionId: string): OutboxItem[] {
    return this.items.filter((item) => item.sessionId === sessionId);
  }

  count(): number {
    return this.items.length;
  }

  add(input: { sessionId: string; text: string; images?: OutgoingImage[]; mode?: 'queue' | 'steer' }): OutboxItem {
    const item: OutboxItem = {
      id: randomUUID(),
      sessionId: input.sessionId,
      text: input.text,
      images: input.images,
      mode: input.mode,
      createdAt: Date.now(),
    };
    this.items = [...this.items, item];
    this.emit();
    this.persist();
    return item;
  }

  remove(id: string): void {
    const next = this.items.filter((item) => item.id !== id);
    if (next.length === this.items.length) return;
    this.items = next;
    this.emit();
    this.persist();
  }

  /**
   * 把发件箱里能发的都发出去。返回成功发出的条数。
   * 一旦某条发不出去就停下，保证会话内的先后顺序不被后面的消息插队。
   */
  flush(send: (frame: ClientFrame) => boolean): number {
    if (this.items.length === 0) return 0;
    const remaining: OutboxItem[] = [];
    let sent = 0;
    let blocked = false;
    for (const item of this.items) {
      if (blocked) {
        remaining.push(item);
        continue;
      }
      const ok = send({
        type: 'message',
        sessionId: item.sessionId,
        text: item.text,
        mode: item.mode ?? 'queue',
        images: item.images,
      });
      if (ok) sent += 1;
      else {
        blocked = true;
        remaining.push(item);
      }
    }
    if (sent > 0) {
      this.items = remaining;
      this.emit();
      this.persist();
    }
    return sent;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
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
