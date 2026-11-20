import { randomUUID } from 'expo-crypto';
import { Directory, File as FsFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { base64DecodedBytes, baseName } from '../protocol/files';
import type { ClientFrame, ServerFrame } from '../protocol/types';
import type { FileUiState } from '../ui/FileCards';
import { tr } from '../i18n';

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
  timer?: ReturnType<typeof setTimeout>;
}
interface ReadyFile {
  file: FsFile;
  mediaType?: string;
  name: string;
}

const RESOLVE_TIMEOUT_MS = 15000;
const TRANSFER_TIMEOUT_MS = 15000;
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
  private opening = new Map<
    string,
    { path: string; name: string; mediaType?: string; timer: ReturnType<typeof setTimeout> }
  >();
  private transfers = new Map<string, Transfer>();
  private ready = new Map<string, ReadyFile>();
  private reading: string | null = null;
  private readQueue: string[] = [];
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
      clearTimeout(entry.timer);
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
        transferId?: string;
      };
      const type = failure.requestType;
      if (type === 'file-download-cancel') return true;
      if (type === 'file-download-read') {
        const transfer = this.transfers.get(this.reading ?? '');
        if (transfer) {
          this.reading = null;
          this.failTransfer(transfer, describeFailure(failure.code, failure.message));
          this.readNext();
        }
        return true;
      }
      if (type !== 'file-resolve' && type !== 'file-download-open') return false;
      const requestId = failure.requestId;
      const resolve = requestId ? this.resolving.get(requestId) : undefined;
      const open = requestId ? this.opening.get(requestId) : undefined;
      const path = resolve?.path ?? open?.path;
      if (!path) return false;
      clearTimeout(resolve?.timer);
      clearTimeout(open?.timer);
      if (requestId) {
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
      this.fail(path, tr("解析超时，请重试"));
    }, RESOLVE_TIMEOUT_MS);
    this.resolving.set(requestId, { path, timer });
    this.onState(path, { status: 'resolving' });
    const sent = this.send({ type: 'file-resolve', requestId, sessionId: this.sessionId, path });
    if (!sent) {
      clearTimeout(timer);
      this.resolving.delete(requestId);
      this.fail(path, tr("连接已断开，无法下载"));
    }
  }

  /** 离开会话时清理正在进行的请求和传输。 */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.resolving.values()) clearTimeout(entry.timer);
    this.resolving.clear();
    for (const entry of this.opening.values()) clearTimeout(entry.timer);
    this.opening.clear();
    for (const transfer of this.transfers.values()) {
      clearTimeout(transfer.timer);
      this.send({ type: 'file-download-cancel', transferId: transfer.transferId });
      this.removeFile(transfer.file);
    }
    this.readQueue = [];
    this.ready.clear();
  }
  private requestOpen(
    path: string,
    canonicalPath: string,
    name?: string,
    mediaType?: string,
  ): void {
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      if (!this.opening.has(requestId)) return;
      this.opening.delete(requestId);
      this.fail(path, tr("下载失败，请检查网络后重试"));
    }, TRANSFER_TIMEOUT_MS);
    this.opening.set(requestId, { path, name: name ?? baseName(path), mediaType, timer });
    this.onState(path, { status: 'downloading', progress: 0 });
    const sent = this.send({
      type: 'file-download-open', requestId, sessionId: this.sessionId, path: canonicalPath,
    });
    if (!sent) {
      clearTimeout(timer);
      this.opening.delete(requestId);
      this.fail(path, tr("连接已断开，无法下载"));
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
      const directory = new Directory(Paths.cache, DOWNLOAD_DIR, String(shortHash(path)));
      if (!directory.exists) directory.create({ intermediates: true });
      const file = new FsFile(directory, safeFileName(path, name));
      if (file.exists) file.delete();
      const transfer: Transfer = {
        transferId, path, file, name, mediaType, size, received: 0, busy: false,
      };
      this.transfers.set(transferId, transfer);
      this.readQueue.push(transferId);
      this.readNext();
    } catch (failure) {
      this.send({ type: 'file-download-cancel', transferId });
      this.fail(path, failure instanceof Error ? failure.message : tr("无法创建临时文件"));
    }
  }

  private readNext(offset?: number): void {
    if (this.reading || this.disposed) return;
    const transferId = this.readQueue.shift();
    const next = transferId ? this.transfers.get(transferId) : undefined;
    if (!next) return;
    this.reading = next.transferId;
    next.timer = setTimeout(() => {
      this.reading = null;
      this.failTransfer(next, tr("下载失败，请检查网络后重试"));
      this.readNext();
    }, TRANSFER_TIMEOUT_MS);
    if (!this.send({ type: 'file-download-read', transferId: next.transferId, offset: offset ?? next.received })) {
      clearTimeout(next.timer);
      this.reading = null;
      this.failTransfer(next, tr("连接已断开，无法下载"));
      this.readNext();
    }
  }

  private failTransfer(transfer: Transfer, message: string): void {
    clearTimeout(transfer.timer);
    this.transfers.delete(transfer.transferId);
    this.readQueue = this.readQueue.filter((id) => id !== transfer.transferId);
    this.send({ type: 'file-download-cancel', transferId: transfer.transferId });
    this.removeFile(transfer.file);
    this.fail(transfer.path, message);
  }

  private async consume(
    transfer: Transfer,
    chunk: { offset: number; data: string; eof?: boolean; sha256?: string },
  ): Promise<void> {
    if (transfer.busy) return;
    transfer.busy = true;
    clearTimeout(transfer.timer);
    try {
      const bytes = base64DecodedBytes(chunk.data);
      if (bytes > 0) {
        await transfer.file.write(chunk.data, { encoding: 'base64', append: transfer.received > 0 });
        transfer.received += bytes;
      }
      if (this.disposed) return;
      if (!chunk.eof) {
        transfer.busy = false;
        this.onState(transfer.path, {
          status: 'downloading',
          progress: transfer.size > 0 ? Math.min(0.99, transfer.received / transfer.size) : 0,
        });
        this.readQueue.unshift(transfer.transferId);
        this.readNext(chunk.offset + bytes);
        return;
      }
      this.transfers.delete(transfer.transferId);
      this.reading = null;
      await this.finish(transfer, chunk.sha256);
      this.readNext();
    } catch (failure) {
      transfer.busy = false;
      this.failTransfer(transfer, failure instanceof Error ? failure.message : tr("写入文件失败"));
      this.readNext();
    }
  }

  private async finish(transfer: Transfer, expected?: string): Promise<void> {
    this.transfers.delete(transfer.transferId);
    if (this.disposed) return;
    try {
      if (expected) {
        const digest = await transfer.file.digest('SHA-256');
        if (this.disposed) return;
        if (String(digest).toLowerCase() !== expected.toLowerCase()) {
          this.removeFile(transfer.file);
          this.fail(transfer.path, tr("文件校验失败，请重试"));
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
      this.fail(transfer.path, failure instanceof Error ? failure.message : tr("校验失败"));
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
        this.fail(path, tr("系统里没有能打开这个文件的应用"));
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: mediaType,
        dialogTitle: name ?? baseName(path),
      });
    } catch (failure) {
      this.fail(path, failure instanceof Error ? failure.message : tr("打开文件失败"));
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
      return tr("文件已不存在");
    case 'file-not-allowed':
      return tr("文件不在会话工作目录内");
    case 'file-not-regular':
      return tr("这不是一个普通文件");
    case 'file-too-large':
      return tr("文件超过下载上限");
    case 'file-changed':
      return tr("文件在下载前被修改了，请重试");
    case 'file-unreadable':
      return tr("文件无法读取");
    case 'file-download-disabled':
      return tr("网关已关闭文件下载");
    case 'file-transfer-limit':
      return tr("同时下载的文件太多，稍后再试");
    case 'bad-request':
      return tr("路径无效");
    default:
      return message ? message : tr("下载失败");
  }
}
