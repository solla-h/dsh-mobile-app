/** 把历史事件与实时事件归一成 App 内部的消息模型。 */

import { presentedFilesOf, type PresentedFile } from './files';
import type { ImageAttachmentRef } from './types';

export interface QueuedMessage {
  id: string;
  text: string;
  /** queued=等这一轮结束；steering=已插进当前回合，下一步生效 */
  placement?: string;
}

/** 会话队列：agent 还在跑的时候，新消息会先排在这里，不是丢了。 */
export function mapQueue(items: unknown): QueuedMessage[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const raw = (item ?? {}) as { id?: unknown; placement?: unknown; message?: { content?: unknown } };
      const text = textOfBlocks(raw.message?.content);
      const hasImage = imagesOfBlocks(raw.message?.content).length > 0;
      return {
        id: typeof raw.id === 'string' ? raw.id : '',
        // 纯图片的排队消息也要显示出来，否则它会在队列里「消失」。
        text: text || (hasImage ? '［图片］' : ''),
        placement: typeof raw.placement === 'string' ? raw.placement : undefined,
      };
    })
    .filter((item) => item.id && item.text);
}

export type ChatMessage =
  | {
      id: string;
      kind: 'user';
      text: string;
      time: number;
      seq?: number;
      /** 图片块只带引用，字节要用 attachment 请求单独取。 */
      images?: ImageAttachmentRef[];
    }
  | {
      id: string;
      kind: 'queued';
      text: string;
      time: number;
      queueId: string;
      placement?: string;
      /** 本地乐观回显：还没被服务端确认 */
      pending?: boolean;
      /** 本地回显用的图片 uri（还没上传，拿不到 attachmentId） */
      localUris?: string[];
    }
  | { id: string; kind: 'notice'; text: string; time: number; seq?: number }
  | {
      id: string;
      kind: 'assistant';
      text: string;
      reasoning?: string;
      time: number;
      seq?: number;
      streaming?: boolean;
      failure?: string;
    }
  | {
      id: string;
      kind: 'tool';
      name: string;
      callId?: string;
      args?: string;
      output?: string;
      isError?: boolean;
      time: number;
      seq?: number;
    }
  | {
      id: string;
      kind: 'files';
      /** 本轮交付的文件卡片；字节按需下载，不进消息模型 */
      files: PresentedFile[];
      turn?: number;
      time: number;
      seq?: number;
    };

export interface HistoryEvent {
  type: string;
  seq: number;
  time: number;
  data?: Record<string, unknown>;
}

type Block = { type?: string; text?: string };

function textOfBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((block) => {
      const typed = block as Block;
      if (typed?.type === 'text' && typeof typed.text === 'string') return typed.text;
      return '';
    })
    .filter(Boolean)
    .join('');
}

/** 用户消息里的图片块：{type:"image", attachment:{attachmentId,...}}。 */
function imagesOfBlocks(blocks: unknown): ImageAttachmentRef[] {
  if (!Array.isArray(blocks)) return [];
  const out: ImageAttachmentRef[] = [];
  for (const block of blocks) {
    const typed = block as { type?: string; attachment?: ImageAttachmentRef };
    if (typed?.type === 'image' && typed.attachment?.attachmentId) out.push(typed.attachment);
  }
  return out;
}

function stringifyArgs(args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined;
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/** 历史接口返回的是原始 SessionEvent：{type, seq, time, data}。 */
export function mapHistory(events: HistoryEvent[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  const toolIndex = new Map<string, number>();
  for (const event of events) {
    const data = (event.data ?? {}) as Record<string, any>;
    switch (event.type) {
      case 'user/message': {
        const sourceKind = (data.source as { kind?: string } | undefined)?.kind;
        if (sourceKind && sourceKind !== 'user') {
          // 运行时上下文 / 时间快照是 Harness 自己注入的，不该出现在对话里。
          if (sourceKind === 'model-selection') {
            const summary = (data.source as { summary?: string }).summary;
            out.push({
              id: `h${event.seq}`,
              kind: 'notice',
              text: summary ? `模型切换：${summary}` : '模型已切换',
              time: event.time,
              seq: event.seq,
            });
          }
          break;
        }
        const text = textOfBlocks(data.content);
        const images = imagesOfBlocks(data.content);
        if (text || images.length) {
          out.push({
            id: `h${event.seq}`,
            kind: 'user',
            text,
            time: event.time,
            seq: event.seq,
            images: images.length ? images : undefined,
          });
        }
        break;
      }
      case 'assistant/message': {
        const text = textOfBlocks(data.message?.content);
        const finishKind = (data.finish as { kind?: string } | undefined)?.kind;
        const failure = finishKind === 'error' || finishKind === 'aborted' ? finishKind : undefined;
        if (text || failure) {
          out.push({
            id: `h${event.seq}`,
            kind: 'assistant',
            text,
            time: event.time,
            seq: event.seq,
            failure,
          });
        }
        break;
      }
      case 'deliverables/presented': {
        const files = presentedFilesOf(data.files);
        if (files.length) {
          out.push({
            id: `h${event.seq}`,
            kind: 'files',
            files,
            turn: typeof data.turn === 'number' ? data.turn : undefined,
            time: event.time,
            seq: event.seq,
          });
        }
        break;
      }
      case 'tool/call': {
        if (typeof data.callId === 'string') toolIndex.set(data.callId, out.length);
        out.push({
          id: `h${event.seq}`,
          kind: 'tool',
          name: typeof data.name === 'string' ? data.name : 'tool',
          callId: typeof data.callId === 'string' ? data.callId : undefined,
          args: stringifyArgs(data.arguments),
          time: event.time,
          seq: event.seq,
        });
        break;
      }
      case 'tool/result': {
        const message = (data.message ?? {}) as Record<string, any>;
        const callId =
          (typeof data.callId === 'string' && data.callId) ||
          (typeof message.toolCallId === 'string' && message.toolCallId) ||
          (typeof message.source?.callId === 'string' && message.source.callId) ||
          undefined;
        const index = callId ? toolIndex.get(callId) : undefined;
        if (index !== undefined) {
          const previous = out[index];
          if (previous && previous.kind === 'tool') {
            out[index] = {
              ...previous,
              output:
                (data.output as string) ??
                textOfBlocks(message.content) ??
                (data.preview as string) ??
                previous.output,
              isError: Boolean(data.isError ?? data.meta?.isError),
            };
          }
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function seqOf(message: ChatMessage): number | undefined {
  return 'seq' in message && typeof message.seq === 'number' ? message.seq : undefined;
}

/**
 * 把更早一页历史并到列表前面。
 * 服务端分页是排他游标，理论上不会重叠，但重连/重试可能重发同一页，所以按 seq 去重。
 */
export function prependHistory(current: ChatMessage[], older: HistoryEvent[]): ChatMessage[] {
  if (older.length === 0) return current;
  const seen = new Set<number>();
  for (const message of current) {
    const seq = seqOf(message);
    if (seq !== undefined) seen.add(seq);
  }
  const fresh = mapHistory(older).filter((message) => {
    const seq = seqOf(message);
    return seq === undefined || !seen.has(seq);
  });
  if (fresh.length === 0) return current;
  return [...fresh, ...current];
}

/**
 * 订阅快照只是「最新一段」，replace 只对快照自己覆盖的区间 [oldest, newest] 成立：
 * - 比 oldest 更早的：是翻页翻出来的历史，必须保留；
 * - 比 newest 更新的：是快照生成之后才到的实时消息，也必须保留；
 * - 区间内：以快照为准。
 * 直接整体替换会两头都丢，所以按 seq 做区间合并。
 */
export function mergeSnapshot(current: ChatMessage[], snapshot: HistoryEvent[]): ChatMessage[] {
  if (snapshot.length === 0) return current;
  const mapped = mapHistory(snapshot);
  if (mapped.length === 0) return current;
  const seqValues = snapshot.map((event) => event.seq);
  const oldest = Math.min(...seqValues);
  const newest = Math.max(...seqValues);
  const before: ChatMessage[] = [];
  const after: ChatMessage[] = [];
  const unsequenced: ChatMessage[] = [];
  for (const message of current) {
    const seq = seqOf(message);
    if (seq === undefined) unsequenced.push(message);
    else if (seq < oldest) before.push(message);
    else if (seq > newest) after.push(message);
  }
  const existing = new Set<number>();
  for (const message of before) {
    const seq = seqOf(message);
    if (seq !== undefined) existing.add(seq);
  }
  const added = mapped.filter((message) => {
    const seq = seqOf(message);
    return seq === undefined || !existing.has(seq);
  });
  const next = [...before, ...added, ...after, ...unsequenced];
  const unchanged =
    next.length === current.length && next.every((message, index) => message === current[index]);
  return unchanged ? current : next;
}

/** 实时 event 帧用的是精简投影：assistant/message 直接带 text/reasoning。 */
export function applyRealtime(
  messages: ChatMessage[],
  event: Record<string, any>,
  seq: number,
  time: number,
): ChatMessage[] {
  if (messages.some((message) => 'seq' in message && message.seq === seq)) return messages;
  switch (event.type) {
    case 'user/message': {
      const source = event.source as string | { kind?: string } | undefined;
      const sourceKind = typeof source === 'string' ? source : source?.kind;
      if (sourceKind && sourceKind !== 'user') {
        if (sourceKind === 'model-selection') {
          const summary = (source as { summary?: string }).summary;
          return [
            ...messages,
            { id: `r${seq}`, kind: 'notice', text: summary ? `模型切换：${summary}` : '模型已切换', time, seq },
          ];
        }
        return messages;
      }
      const text = typeof event.text === 'string' ? event.text : '';
      const images = Array.isArray(event.images) ? (event.images as ImageAttachmentRef[]).filter((i) => i?.attachmentId) : [];
      if (!text && images.length === 0) return messages;
      return [
        ...messages,
        { id: `r${seq}`, kind: 'user', text, time, seq, images: images.length ? images : undefined },
      ];
    }
    case 'assistant/message': {
      const text = typeof event.text === 'string' ? event.text : '';
      const reasoning = typeof event.reasoning === 'string' && event.reasoning ? event.reasoning : undefined;
      if (!text && !reasoning) return messages;
      return [...messages, { id: `r${seq}`, kind: 'assistant', text, reasoning, time, seq }];
    }
    case 'deliverables/presented': {
      // 实时帧把 turn/callId/files 放在 event 顶层，历史放在 data 里，形状一致。
      const files = presentedFilesOf(event.files);
      if (!files.length) return messages;
      return [
        ...messages,
        {
          id: `r${seq}`,
          kind: 'files',
          files,
          turn: typeof event.turn === 'number' ? event.turn : undefined,
          time,
          seq,
        },
      ];
    }
    case 'tool/call': {
      const callId = typeof event.callId === 'string' ? event.callId : undefined;
      return [
        ...messages,
        {
          id: `r${seq}`,
          kind: 'tool',
          name: typeof event.name === 'string' ? event.name : 'tool',
          callId,
          args: stringifyArgs(event.arguments),
          time,
          seq,
        },
      ];
    }
    case 'tool/result': {
      const callId = typeof event.callId === 'string' ? event.callId : undefined;
      const index = callId ? messages.findIndex((m) => m.kind === 'tool' && m.callId === callId) : -1;
      if (index < 0) return messages;
      const previous = messages[index];
      if (previous.kind !== 'tool') return messages;
      const next = [...messages];
      next[index] = {
        ...previous,
        output: (event.output as string) ?? (event.preview as string) ?? previous.output,
        isError: Boolean(event.isError),
      };
      return next;
    }
    default:
      return messages;
  }
}
