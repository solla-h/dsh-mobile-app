import { randomUUID } from 'expo-crypto';
import { Directory, File as FsFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { base64DecodedBytes, baseName } from '../protocol/files';
import type { ClientFrame, ServerFrame } from '../protocol/types';
import type { FileUiState } from '../ui/FileCards';

/**
 * 工作区文件下载：file-resolve → file-download-open → 逐块 read。
 *
 * 服务端把 transferId 绑在创建它的连接上，所以这里只用会话那条连接；
 * 块按顺序请求（写完上一块才要下一块），offset 用服务端回的 offset 加上已解码字节数。
 */
interface Transfer {
  transferId: string;
  /** 卡片上的原始路径，也是 UI 状态的键 */
  path: string;
  file: FsFile;
  name: string;
  mediaType?: string;
  size: number;
  received: number;
  busy: boolean;
}

interface ReadyFile {
  file: FsFile;
  mediaType?: string;
  name: string;
}

const RESOLVE_TIMEOUT_MS = 15000;
const DOWNLOAD_DIR = 'dsh-files';

/** 同名的不同文件要分开存：一个路径一个目录，文件名保持干净。 */
function shortHash(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  return hash >>> 0;
}

function safeFileName(path: string, name?: string): string {
  const raw = (name ?? baseName(path)).replace(/[\\/:*?"<>|]+/g, '_').trim();
  return raw || 'file';
}

export class FileDownloader {
  private send: (frame: ClientFrame) => boolean;
  private sessionId: string;
  private onState: (path: string, state: FileUiState) => void;
  private resolving = new Map<string, { path: string; timer: ReturnType<typeof setTimeout> }>();
  private opening = new Map<string, { path: string; name: string; mediaType?: string }>();
  private transfers = new Map<string, Transfer>();
  private ready = new Map<string, ReadyFile>();
  /** 已经取消掉的 transferId：服务端回的 cancel 结果不该再弹到顶部错误条。 */
  private cancelled = new Set<string>();
  private disposed = false;

  constructor(
    sessionId: string,
    send: (frame: ClientFrame) => boolean,
    onState: (path: string, state: FileUiState) => void,
  ) {
    this.sessionId = sessionId;
    this.send = send;
    this.onState = onState;
  }

  /** 返回 true 表示这一帧属于文件传输，外层不用再处理。 */
  handleFrame(frame: ServerFrame): boolean {
    if (this.disposed) return false;
    const kind = frame.kind;
    if (kind === 'file-resolved') {
      const resolved = frame as unknown as {
        requestId: string;
        path: string;
        name?: string;
        mediaType?: string;
      };
      const entry = this.resolving.get(resolved.requestId);
      if (!entry) return false;
      clearTimeout(entry.timer);
      this.resolving.delete(resolved.requestId);
      this.requestOpen(entry.path, resolved.path, resolved.name, resolved.mediaType);
      return true;
    }
    if (kind === 'file-download-opened') {
      const opened = frame as unknown as {
        requestId: string;
        transferId: string;
        name?: string;
        mediaType?: string;
        size?: number;
      };
      const entry = this.opening.get(opened.requestId);
      if (!entry) return false;
      this.opening.delete(opened.requestId);
      this.beginTransfer(opened.transferId, entry.path, entry.name, entry.mediaType, opened.size ?? 0);
      return true;
    }
    if (kind === 'file-download-chunk') {
      const chunk = frame as unknown as {
        transferId: string;
        offset: number;
        data: string;
        eof?: boolean;
        sha256?: string;
      };
      const transfer = this.transfers.get(chunk.transferId);
      if (!transfer) return true;
      void this.consume(transfer, chunk);
      return true;
    }
    if (kind === 'file-download-cancelled') {
      // 主动取消的回执，没有需要展示的东西。
      return true;
    }
    if (kind === 'error') {
      const failure = frame as unknown as {
        code?: string;
        message?: string;
        requestType?: string;
        requestId?: string;
      };
      const type = failure.requestType;
      if (type === 'file-download-cancel' || type === 'file-download-read') {
        // 传输已经死了再取消会回 file-transfer-not-found，这类错误只影响内部状态。
        if (failure.requestId) this.cancelled.delete(failure.requestId);
        return true;
      }
      if (type !== 'file-resolve' && type !== 'file-download-open') return false;
      const requestId = failure.requestId;
      const path =
        (requestId ? this.resolving.get(requestId)?.path : undefined) ??
        (requestId ? this.opening.get(requestId)?.path : undefined);
      if (!path) return false;
      if (requestId) {
        const timer = this.resolving.get(requestId)?.timer;
        if (timer) clearTimeout(timer);
        this.resolving.delete(requestId);
        this.opening.delete(requestId);
      }
      this.fail(path, describeFailure(failure.code, failure.message));
      return true;
    }
    return false;
  }

  /** 点卡片：没下过就从头下，下过就直接打开。 */
  open(path: string): void {
    if (this.disposed) return;
    const cached = this.ready.get(path);
    if (cached && cached.file.exists) {
      void this.present(cached.file, path, cached.mediaType, cached.name);
      return;
    }
    this.ready.delete(path);
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      if (!this.resolving.has(requestId)) return;
      this.resolving.delete(requestId);
      this.fail(path, '解析超时，请重试');
    }, RESOLVE_TIMEOUT_MS);
    this.resolving.set(requestId, { path, timer });
    this.onState(path, { status: 'resolving' });
    const sent = this.send({ type: 'file-resolve', requestId, sessionId: this.sessionId, path });
    if (!sent) {
      clearTimeout(timer);
      this.resolving.delete(requestId);
      this.fail(path, '连接已断开，无法下载');
    }
  }

  /** 离开会话时把还在跑的传输全部收掉，避免回调打到已经卸载的组件上。 */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.resolving.values()) clearTimeout(entry.timer);
    this.resolving.clear();
    this.opening.clear();
    for (const transfer of this.transfers.values()) {
      this.send({ type: 'file-download-cancel', transferId: transfer.transferId });
      this.removeFile(transfer.file);
    }
    this.transfers.clear();
    this.ready.clear();
  }

  private requestOpen(
    path: string,
    canonicalPath: string,
    name?: string,
    mediaType?: string,
  ): void {
    const requestId = randomUUID();
    this.opening.set(requestId, { path, name: name ?? baseName(path), mediaType });
    this.onState(path, { status: 'downloading', progress: 0 });
    const sent = this.send({
      type: 'file-download-open',
      requestId,
      sessionId: this.sessionId,
      path: canonicalPath,
    });
    if (!sent) {
      this.opening.delete(requestId);
      this.fail(path, '连接已断开，无法下载');
    }
  }

  private beginTransfer(
    transferId: string,
    path: string,
    name: string,
    mediaType: string | undefined,
    size: number,
  ): void {
    try {
      // 每个路径一个子目录：同名文件互不覆盖，文件名还能保持原样显示。
      const directory = new Directory(Paths.cache, DOWNLOAD_DIR, String(shortHash(path)));
      if (!directory.exists) directory.create({ intermediates: true });
      const file = new FsFile(directory, safeFileName(path, name));
      if (file.exists) file.delete();
      this.transfers.set(transferId, {
        transferId,
        path,
        file,
        name,
        mediaType,
        size,
        received: 0,
        busy: false,
      });
      this.send({ type: 'file-download-read', transferId, offset: 0 });
    } catch (failure) {
      // 服务端的并发名额是网关级的，本地起不来也要把 transfer 退掉。
      this.send({ type: 'file-download-cancel', transferId });
      this.fail(path, failure instanceof Error ? failure.message : '无法创建临时文件');
    }
  }

  private async consume(
    transfer: Transfer,
    chunk: { offset: number; data: string; eof?: boolean; sha256?: string },
  ): Promise<void> {
    if (transfer.busy) return;
    transfer.busy = true;
    try {
      const bytes = base64DecodedBytes(chunk.data);
      if (bytes > 0) {
        // 服务端给的就是标准 Base64，直接按 base64 追加，避免在 JS 里解一遍再拼大数组。
        await transfer.file.write(chunk.data, { encoding: 'base64', append: transfer.received > 0 });
        transfer.received += bytes;
      }
      if (this.disposed) return;
      if (!chunk.eof) {
        transfer.busy = false;
        this.send({
          type: 'file-download-read',
          transferId: transfer.transferId,
          offset: chunk.offset + bytes,
        });
        const total = transfer.size > 0 ? transfer.size : transfer.received;
        this.onState(transfer.path, {
          status: 'downloading',
          progress: total > 0 ? Math.min(0.99, transfer.received / total) : 0,
        });
        return;
      }
      await this.finish(transfer, chunk.sha256);
    } catch (failure) {
      transfer.busy = false;
      this.transfers.delete(transfer.transferId);
      this.send({ type: 'file-download-cancel', transferId: transfer.transferId });
      this.fail(transfer.path, failure instanceof Error ? failure.message : '写入文件失败');
    }
  }

  private async finish(transfer: Transfer, expected?: string): Promise<void> {
    this.transfers.delete(transfer.transferId);
    if (this.disposed) return;
    try {
      if (expected) {
        const digest = await transfer.file.digest('SHA-256');
        // 校验是异步的，期间用户可能已经离开这个会话。
        if (this.disposed) return;
        if (String(digest).toLowerCase() !== expected.toLowerCase()) {
          this.removeFile(transfer.file);
          this.fail(transfer.path, '文件校验失败，请重试');
          return;
        }
      }
      this.ready.set(transfer.path, {
        file: transfer.file,
        mediaType: transfer.mediaType,
        name: transfer.name,
      });
      this.onState(transfer.path, { status: 'ready', progress: 1 });
      await this.present(transfer.file, transfer.path, transfer.mediaType, transfer.name);
    } catch (failure) {
      this.fail(transfer.path, failure instanceof Error ? failure.message : '校验失败');
    }
  }

  /** 优先用系统预览（ACTION_VIEW），没有能打开它的应用时退回分享面板。 */
  private async present(file: FsFile, path: string, mediaType?: string, name?: string): Promise<void> {
    try {
      if (await file.canPreview()) {
        await file.preview();
        return;
      }
    } catch {
      // 预览失败就退到分享面板，别直接判死。
    }
    if (this.disposed) return;
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        this.fail(path, '系统里没有能打开这个文件的应用');
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: mediaType,
        dialogTitle: name ?? baseName(path),
      });
    } catch (failure) {
      this.fail(path, failure instanceof Error ? failure.message : '打开文件失败');
    }
  }

  private removeFile(file: FsFile): void {
    try {
      if (file.exists) file.delete();
    } catch {
      // 删不掉就留着，下次同名会先删除再写
    }
  }

  private fail(path: string, message: string): void {
    if (this.disposed) return;
    this.onState(path, { status: 'error', message });
  }
}

function describeFailure(code?: string, message?: string): string {
  switch (code) {
    case 'file-not-found':
      return '文件已不存在';
    case 'file-not-allowed':
      return '文件不在会话工作目录内';
    case 'file-not-regular':
      return '这不是一个普通文件';
    case 'file-too-large':
      return '文件超过下载上限';
    case 'file-changed':
      return '文件在下载前被修改了，请重试';
    case 'file-unreadable':
      return '文件无法读取';
    case 'file-download-disabled':
      return '网关已关闭文件下载';
    case 'file-transfer-limit':
      return '同时下载的文件太多，稍后再试';
    case 'bad-request':
      return '路径无效';
    default:
      return message ? message : '下载失败';
  }
}
