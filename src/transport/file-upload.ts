import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';

import { base64DecodedBytes } from '../protocol/files';
import type { ClientFrame } from '../protocol/types';

/**
 * 把手机上的文件传到网关（file-upload-v1）。
 *
 * 流程：open（带 size + sha256）→ 按 chunkBytes 逐块发 base64 → finish → 拿 receiptId，
 * 之后把 receiptId 放进 message.files 里，文件才算真正挂到这条消息上。
 *
 * 约束（来自插件实现）：
 * - name 只能是叶子文件名，不能带路径分隔符；
 * - 每块 offset 必须严格等于服务端期望的偏移，且 data 必须是规范 base64；
 * - 整个上传绑定在创建它的那条连接上，断线就作废。
 */

export interface UploadState {
  status: 'hashing' | 'uploading' | 'done' | 'error';
  /** 0..1 */
  progress?: number;
  message?: string;
  receiptId?: string;
}

interface Waiter {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 单个文件的服务端上限是 512 MiB，但手机上整份读成 base64 太吃内存，自己收一收。 */
const LOCAL_MAX_BYTES = 24 * 1024 * 1024;

const FAILURE_TEXT: Record<string, string> = {
  'file-upload-unavailable': '网关没开文件上传',
  'file-too-large': '文件太大',
  'file-upload-limit': '同时上传的文件太多，等一个传完再试',
  'file-upload-offset': '分片偏移对不上，已中断',
  'file-upload-invalid-data': '分片数据不合法，已中断',
  'file-upload-size': '文件内容和声明的大小不一致',
  'file-upload-incomplete': '文件没传完',
  'file-upload-checksum': 'SHA-256 校验失败',
  'file-upload-not-found': '上传会话已失效',
  'file-upload-cancelled': '上传已取消',
  'session-not-found': '会话不存在',
  'bad-request': '上传参数不合法',
};

/**
 * 每块多少 base64 字符。必须按 4 对齐，否则切出来的不是规范 base64，
 * 网关会用 file-upload-invalid-data 拒掉。
 */
export function chunkChars(chunkBytes: number): number {
  return Math.max(4, Math.floor(chunkBytes / 3) * 4);
}

/** 对齐后的字符数换算回字节数（4 字符 = 3 字节，不含填充）。 */
export function bytesOfChars(chars: number): number {
  return (chars / 4) * 3;
}

/** 一片 base64 解出来的真实字节数（末片要扣掉 '=' 填充）。 */
export function decodedBytesOf(slice: string): number {
  return base64DecodedBytes(slice);
}

export class FileUploader {
  private waiters = new Map<string, Waiter>();
  private cancelled = new Set<string>();
  private disposed = false;

  constructor(
    private readonly sessionId: string,
    private readonly send: (frame: ClientFrame) => boolean,
    private readonly onState: (localId: string, state: UploadState) => void,
  ) {}

  /** 返回 true 表示这帧是上传相关的，别再往下传。 */
  handleFrame(frame: { kind?: string; [key: string]: unknown }): boolean {
    const kind = frame.kind;
    if (kind === 'error') {
      const requestType = typeof frame.requestType === 'string' ? frame.requestType : '';
      if (!requestType.startsWith('file-upload')) return false;
      const code = typeof frame.code === 'string' ? frame.code : 'error';
      const key =
        (typeof frame.requestId === 'string' && frame.requestId) ||
        (typeof frame.uploadId === 'string' && frame.uploadId) ||
        '';
      this.fail(key, code, typeof frame.message === 'string' ? frame.message : undefined);
      return true;
    }
    if (!kind || !kind.startsWith('file-upload')) return false;
    const key =
      (typeof frame.requestId === 'string' && frame.requestId) ||
      (typeof frame.uploadId === 'string' && frame.uploadId) ||
      '';
    const waiter = this.waiters.get(key);
    if (!waiter) return true;
    this.waiters.delete(key);
    clearTimeout(waiter.timer);
    waiter.resolve(frame as Record<string, unknown>);
    return true;
  }

  private fail(key: string, code: string, message?: string): void {
    const waiter = key ? this.waiters.get(key) : undefined;
    const error = new Error(FAILURE_TEXT[code] ?? message ?? code);
    if (waiter) {
      this.waiters.delete(key);
      clearTimeout(waiter.timer);
      waiter.reject(error);
      return;
    }
    // 错误帧常常只带 requestType、不带 id：这时按「最早的那个在途请求」认领，
    // 别把其他文件的上传也一起打断。
    const first = this.waiters.entries().next();
    if (first.done) return;
    const [id, pending] = first.value;
    this.waiters.delete(id);
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  private request(
    key: string,
    frame: ClientFrame,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (this.disposed) {
        reject(new Error('已离开会话'));
        return;
      }
      const timer = setTimeout(() => {
        this.waiters.delete(key);
        reject(new Error('网关没有响应'));
      }, timeoutMs);
      this.waiters.set(key, { resolve, reject, timer });
      if (!this.send(frame)) {
        this.waiters.delete(key);
        clearTimeout(timer);
        reject(new Error('连接已断开'));
      }
    });
  }

  async upload(localId: string, file: File): Promise<void> {
    const name = file.name || 'file';
    const size = typeof file.size === 'number' ? file.size : null;
    if (size === null || size <= 0) {
      this.onState(localId, { status: 'error', message: '读不到文件大小' });
      return;
    }
    if (size > LOCAL_MAX_BYTES) {
      this.onState(localId, {
        status: 'error',
        message: `超过 ${Math.floor(LOCAL_MAX_BYTES / 1024 / 1024)} MB，手机上先压缩或拆分`,
      });
      return;
    }

    let uploadId = '';
    let sha256 = '';
    try {
      this.onState(localId, { status: 'hashing', progress: 0 });
      sha256 = await file.digest('SHA-256');
      if (this.disposed || this.cancelled.has(localId)) return;

      const requestId = randomUUID();
      const opened = await this.request(
        requestId,
        { type: 'file-upload-open', requestId, sessionId: this.sessionId, name, size, sha256 },
        30_000,
      );
      uploadId = typeof opened.uploadId === 'string' ? opened.uploadId : '';
      if (!uploadId) throw new Error('网关没有返回 uploadId');
      const chunkBytes =
        typeof opened.chunkBytes === 'number' && opened.chunkBytes > 0 ? opened.chunkBytes : 256 * 1024;

      // 整份读成 base64：移动端附件通常只有几 MB，比在 JS 里逐块编码简单可靠。
      const base64 = await file.base64();
      if (this.disposed || this.cancelled.has(localId)) {
        this.send({ type: 'file-upload-cancel', requestId: randomUUID(), uploadId });
        return;
      }

      // chunkBytes 不一定是 3 的倍数，按 4 字符对齐取整，保证每块都是规范 base64。
      const charsPerChunk = chunkChars(chunkBytes);
      let chars = 0;
      let sentBytes = 0;
      while (chars < base64.length) {
        if (this.disposed || this.cancelled.has(localId)) {
          this.send({ type: 'file-upload-cancel', requestId: randomUUID(), uploadId });
          return;
        }
        const slice = base64.slice(chars, chars + charsPerChunk);
        // 网关按 requestId 回帧（错误帧也带它），所以 waiter 必须用 requestId 做键；
        // uploadId 只在帧里带上，别拿它当键，否则每片都要等满超时。
        const chunkRequestId = randomUUID();
        const accepted = await this.request(
          chunkRequestId,
          { type: 'file-upload-chunk', requestId: chunkRequestId, uploadId, offset: sentBytes, data: slice },
          30_000,
        );
        const nextOffset = accepted.nextOffset;
        if (typeof nextOffset !== 'number') throw new Error('网关没有返回 nextOffset');
        chars += slice.length;
        // 末片带 '=' 填充，解码字节数比 chars/4*3 少 1~2，必须按真实字节累加。
        sentBytes += base64DecodedBytes(slice);
        if (nextOffset !== sentBytes) throw new Error('分片偏移对不上，已中断');
        this.onState(localId, {
          status: 'uploading',
          progress: Math.min(1, sentBytes / size),
        });
      }

      const finishRequestId = randomUUID();
      const finished = await this.request(
        finishRequestId,
        { type: 'file-upload-finish', requestId: finishRequestId, uploadId },
        120_000,
      );
      const receiptId = typeof finished.receiptId === 'string' ? finished.receiptId : '';
      if (!receiptId) throw new Error('网关没有返回 receiptId');
      this.onState(localId, { status: 'done', progress: 1, receiptId });
    } catch (error) {
      if (uploadId) this.send({ type: 'file-upload-cancel', requestId: randomUUID(), uploadId });
      if (this.disposed) return;
      this.onState(localId, {
        status: 'error',
        message: error instanceof Error ? error.message : '上传失败',
      });
    }
  }

  cancel(localId: string): void {
    this.cancelled.add(localId);
  }

  dispose(): void {
    this.disposed = true;
    for (const [key, waiter] of this.waiters) {
      this.waiters.delete(key);
      clearTimeout(waiter.timer);
      waiter.reject(new Error('已离开会话'));
    }
  }
}
