import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';

import { base64DecodedBytes } from '../protocol/files';
import type { ClientFrame } from '../protocol/types';
import { tr } from '../i18n';

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
  status: 'waiting' | 'hashing' | 'uploading' | 'done' | 'error';
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

/**
 * 写入失败 = 连接已经没了，而不是这次上传本身有问题。
 * 上层据此把上传留在 waiting（重连后自动续传）；
 * 用类型判断而不是比较 message 文案——文案会按界面语言翻译。
 */
class DisconnectedError extends Error {}

/** 单个文件的服务端上限是 512 MiB，但手机上整份读成 base64 太吃内存，自己收一收。 */
const LOCAL_MAX_BYTES = 24 * 1024 * 1024;

const FAILURE_TEXT: Record<string, string> = {
  get 'file-upload-unavailable'() { return tr("网关没开文件上传"); },
  get 'file-too-large'() { return tr("文件太大"); },
  get 'file-upload-limit'() { return tr("同时上传的文件太多，等一个传完再试"); },
  get 'file-upload-offset'() { return tr("分片偏移对不上，已中断"); },
  get 'file-upload-invalid-data'() { return tr("分片数据不合法，已中断"); },
  get 'file-upload-size'() { return tr("文件内容和声明的大小不一致"); },
  get 'file-upload-incomplete'() { return tr("文件没传完"); },
  get 'file-upload-checksum'() { return tr("SHA-256 校验失败"); },
  get 'file-upload-not-found'() { return tr("上传会话已失效"); },
  get 'file-upload-cancelled'() { return tr("上传已取消"); },
  get 'session-not-found'() { return tr("会话不存在"); },
  get 'bad-request'() { return tr("上传参数不合法"); },
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

interface Upload {
  file: File;
  state: UploadState;
  uploadId?: string;
}

export class FileUploader {
  private waiters = new Map<string, Waiter>();
  private uploads = new Map<string, Upload>();
  private connectionVersion = 0;
  private disposed = false;

  constructor(
    private readonly sessionId: string,
    private readonly send: (frame: ClientFrame) => boolean,
    private readonly onState: (localId: string, state: UploadState) => void,
    private connected = true,
  ) {}

  /** 连接上的上传/收据不能跨重连复用；保留本地 File，ready 后从 open 重新上传。 */
  setConnected(connected: boolean): void {
    if (this.disposed || connected === this.connected) return;
    this.connected = connected;
    if (connected) {
      for (const [id, upload] of this.uploads) {
        if (upload.state.status === 'waiting') void this.upload(id, upload.file);
      }
      return;
    }
    this.connectionVersion += 1;
    for (const [id, upload] of this.uploads) {
      if (upload.state.status === 'error') continue;
      const state: UploadState = { status: 'waiting' };
      // 换掉对象身份，让旧连接的 digest/base64/回包完成后不能覆盖新状态。
      this.uploads.set(id, { file: upload.file, state });
      this.onState(id, state);
    }
    this.rejectWaiters(tr("连接已断开"));
  }

  private rejectWaiters(message: string): void {
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    }
    this.waiters.clear();
  }

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
    // 带 id 的迟到错误属于旧请求，不能误伤另一份正在上传的文件。
    if (key) return;
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
        reject(new Error(tr("已离开会话")));
        return;
      }
      const timer = setTimeout(() => {
        this.waiters.delete(key);
        reject(new Error(tr("网关没有响应")));
      }, timeoutMs);
      this.waiters.set(key, { resolve, reject, timer });
      if (!this.send(frame)) {
        this.waiters.delete(key);
        clearTimeout(timer);
        reject(new DisconnectedError(tr("连接已断开")));
      }
    });
  }

  async upload(localId: string, file: File): Promise<void> {
    if (this.disposed) return;
    const previous = this.uploads.get(localId);
    if (previous && !['waiting', 'error'].includes(previous.state.status)) return;
    const upload: Upload = { file, state: { status: 'waiting' } };
    const connectionVersion = this.connectionVersion;
    this.uploads.set(localId, upload);
    const active = () => !this.disposed && this.connected && this.uploads.get(localId) === upload;
    const update = (state: UploadState) => {
      upload.state = state;
      this.onState(localId, state);
    };
    if (!this.connected) {
      update({ status: 'waiting' });
      return;
    }

    let uploadId = '';
    try {
      const name = file.name || 'file';
      const size = typeof file.size === 'number' ? file.size : null;
      if (size === null || size <= 0) throw new Error(tr("读不到文件大小"));
      if (size > LOCAL_MAX_BYTES) {
        throw new Error(tr("超过 {0} MB，手机上先压缩或拆分", [Math.floor(LOCAL_MAX_BYTES / 1024 / 1024)]));
      }
      update({ status: 'hashing', progress: 0 });
      const sha256 = await file.digest('SHA-256');
      if (!active()) return;

      const requestId = randomUUID();
      const opened = await this.request(
        requestId,
        { type: 'file-upload-open', requestId, sessionId: this.sessionId, name, size, sha256 },
        30_000,
      );
      uploadId = typeof opened.uploadId === 'string' ? opened.uploadId : '';
      if (!active()) {
        // open 回包之前文件已移除：只清理原连接，不能把旧 uploadId 发到新连接。
        if (uploadId && this.connected && connectionVersion === this.connectionVersion) {
          this.send({ type: 'file-upload-cancel', requestId: randomUUID(), uploadId });
        }
        return;
      }
      if (!uploadId) throw new Error(tr("网关没有返回 uploadId"));
      upload.uploadId = uploadId;
      const chunkBytes =
        typeof opened.chunkBytes === 'number' && opened.chunkBytes > 0 ? opened.chunkBytes : 256 * 1024;

      // 整份读成 base64：移动端附件通常只有几 MB，比在 JS 里逐块编码简单可靠。
      const base64 = await file.base64();
      if (!active()) return;

      // chunkBytes 不一定是 3 的倍数，按 4 字符对齐取整，保证每块都是规范 base64。
      const charsPerChunk = chunkChars(chunkBytes);
      let chars = 0;
      let sentBytes = 0;
      while (chars < base64.length) {
        if (!active()) return;
        const slice = base64.slice(chars, chars + charsPerChunk);
        // 网关按 requestId 回帧（错误帧也带它），所以 waiter 必须用 requestId 做键；
        // uploadId 只在帧里带上，别拿它当键，否则每片都要等满超时。
        const chunkRequestId = randomUUID();
        const accepted = await this.request(
          chunkRequestId,
          { type: 'file-upload-chunk', requestId: chunkRequestId, uploadId, offset: sentBytes, data: slice },
          30_000,
        );
        if (!active()) return;
        const nextOffset = accepted.nextOffset;
        if (typeof nextOffset !== 'number') throw new Error(tr("网关没有返回 nextOffset"));
        chars += slice.length;
        // 末片带 '=' 填充，解码字节数比 chars/4*3 少 1~2，必须按真实字节累加。
        sentBytes += base64DecodedBytes(slice);
        if (nextOffset !== sentBytes) throw new Error(tr("分片偏移对不上，已中断"));
        update({
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
      if (!active()) return;
      const receiptId = typeof finished.receiptId === 'string' ? finished.receiptId : '';
      if (!receiptId) throw new Error(tr("网关没有返回 receiptId"));
      update({ status: 'done', progress: 1, receiptId });
    } catch (error) {
      if (!active()) return;
      if (uploadId) this.send({ type: 'file-upload-cancel', requestId: randomUUID(), uploadId });
      const message = error instanceof Error ? error.message : tr("上传失败");
      update(error instanceof DisconnectedError ? { status: 'waiting' } : { status: 'error', message });
    }
  }

  cancel(localId: string): void {
    const upload = this.uploads.get(localId);
    this.uploads.delete(localId);
    if (this.connected && upload?.uploadId &&
        (upload.state.status === 'hashing' || upload.state.status === 'uploading')) {
      this.send({ type: 'file-upload-cancel', requestId: randomUUID(), uploadId: upload.uploadId });
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const id of this.uploads.keys()) this.cancel(id);
    this.rejectWaiters(tr("已离开会话"));
  }
}
