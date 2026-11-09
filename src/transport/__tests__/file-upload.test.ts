import type { File } from 'expo-file-system';
import type { ClientFrame } from '../../protocol/types';
import { FileUploader, bytesOfChars, chunkChars, decodedBytesOf } from '../file-upload';

jest.mock('expo-crypto', () => {
  let id = 0;
  return { randomUUID: () => `request-${++id}` };
});

const base64Of = (length: number, fill: number): string =>
  btoa(Array.from({ length }, () => String.fromCharCode(fill)).join(''));

/**
 * 分片切分的核心不变量：
 * - 每块长度是 4 的倍数（规范 base64）
 * - offset 用「已经发出去的字节数」累加，末片要扣掉 '=' 填充
 * 这两个错了网关会直接 file-upload-offset / file-upload-invalid-data。
 */
describe('chunkChars', () => {
  it('默认 256 KiB 分片按 4 字符对齐', () => {
    expect(chunkChars(256 * 1024)).toBe(349524);
    expect(chunkChars(256 * 1024) % 4).toBe(0);
  });

  it('小分片至少给 4 个字符', () => {
    expect(chunkChars(1)).toBe(4);
    expect(chunkChars(0)).toBe(4);
  });
});

describe('decodedBytesOf', () => {
  it('按填充算出真实字节数', () => {
    expect(decodedBytesOf('YWJj')).toBe(3);
    expect(decodedBytesOf('YWI=')).toBe(2);
    expect(decodedBytesOf('YQ==')).toBe(1);
    expect(bytesOfChars(4)).toBe(3);
  });
});

describe('切片本身', () => {
  it('每片都能原样 base64 解码再编码回来', () => {
    const payload = base64Of(1024, 7);
    const chars = chunkChars(300);
    let offset = 0;
    let chunks = 0;
    while (offset < payload.length) {
      const slice = payload.slice(offset, offset + chars);
      expect(slice.length % 4).toBe(0);
      expect(btoa(atob(slice))).toBe(slice);
      offset += slice.length;
      chunks += 1;
    }
    expect(chunks).toBeGreaterThan(1);
    expect(offset).toBe(payload.length);
  });

  it('累计字节数和服务端 nextOffset 一致（含末片填充）', () => {
    const payload = base64Of(1000, 1);
    const chars = chunkChars(300);
    let charsOffset = 0;
    let sentBytes = 0;
    while (charsOffset < payload.length) {
      const slice = payload.slice(charsOffset, charsOffset + chars);
      charsOffset += slice.length;
      sentBytes += decodedBytesOf(slice);
      // 服务端返回的 nextOffset 就是这个累计值
      expect(sentBytes).toBe(atob(payload.slice(0, charsOffset)).length);
    }
    expect(sentBytes).toBe(1000);
  });
});

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const localFile = (digest: () => Promise<string>): File => ({
  name: 'test.txt', size: 3, digest, base64: async () => 'YWJj',
}) as unknown as File;

it('重连后旧校验结果不能覆盖新上传；已发送移除的文件不再重传', async () => {
  let resolveOld!: (digest: string) => void;
  const digest = jest.fn()
    .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveOld = resolve; }))
    .mockResolvedValue('digest');
  const states = jest.fn();
  const sent: ClientFrame[] = [];
  const uploader = new FileUploader('s1', (frame) => {
    sent.push(frame);
    queueMicrotask(() => {
      if (frame.type === 'file-upload-open') {
        uploader.handleFrame({ kind: 'file-upload-opened', requestId: frame.requestId, uploadId: 'new-upload' });
      } else if (frame.type === 'file-upload-chunk') {
        uploader.handleFrame({ kind: 'file-upload-chunk-accepted', requestId: frame.requestId, nextOffset: 3 });
      } else if (frame.type === 'file-upload-finish') {
        uploader.handleFrame({ kind: 'file-upload-completed', requestId: frame.requestId, receiptId: 'new-receipt' });
      }
    });
    return true;
  }, states);
  try {
    const old = uploader.upload('local', localFile(digest));
    uploader.setConnected(false);
    uploader.setConnected(true);
    await flush();
    expect(states).toHaveBeenLastCalledWith('local', { status: 'done', progress: 1, receiptId: 'new-receipt' });
    const count = states.mock.calls.length;
    resolveOld('stale-digest');
    await old;
    expect(states).toHaveBeenCalledTimes(count);
    expect(sent.filter((frame) => frame.type === 'file-upload-open')).toHaveLength(1);
    uploader.cancel('local');
    uploader.setConnected(false);
    uploader.setConnected(true);
    await flush();
    expect(sent.filter((frame) => frame.type === 'file-upload-open')).toHaveLength(1);
  } finally { uploader.dispose(); }
});

it('移除文件时即使 open 回包晚到也会取消，且迟到的错误不能终止另一份上传', async () => {
  const sent: ClientFrame[] = [];
  const states = jest.fn();
  const uploader = new FileUploader('s1', (frame) => { sent.push(frame); return true; }, states);
  try {
    const first = uploader.upload('removed', localFile(async () => 'digest'));
    await flush();
    const open = sent[0];
    if (open.type !== 'file-upload-open') throw new Error('Expected upload open');
    uploader.cancel('removed');
    uploader.handleFrame({ kind: 'file-upload-opened', requestId: open.requestId, uploadId: 'removed-upload' });
    await first;
    expect(sent).toContainEqual(expect.objectContaining({ type: 'file-upload-cancel', uploadId: 'removed-upload' }));
    expect(states.mock.calls.some(([id, state]) => id === 'removed' && state.status === 'done')).toBe(false);
    const second = uploader.upload('kept', localFile(async () => 'digest'));
    await flush();
    uploader.handleFrame({ kind: 'error', requestType: 'file-upload-open', requestId: open.requestId, code: 'bad-request' });
    await flush();
    expect(states).toHaveBeenLastCalledWith('kept', { status: 'hashing', progress: 0 });
    uploader.setConnected(false);
    await second;
    expect(states).toHaveBeenLastCalledWith('kept', { status: 'waiting' });
  } finally { uploader.dispose(); }
});
