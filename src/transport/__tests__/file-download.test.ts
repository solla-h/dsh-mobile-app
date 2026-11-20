import { FileDownloader } from '../file-download';
import type { ClientFrame, ServerFrame } from '../../protocol/types';
const mockInstances: { exists: boolean; deleted: boolean; writes: { data: string; options: unknown }[] }[] = [];

jest.mock('expo-crypto', () => ({ randomUUID: (() => {
  let id = 0;
  return () => `uuid-${++id}`;
})() }));

jest.mock('expo-file-system', () => ({
  Directory: jest.fn(() => ({ exists: false, create() { this.exists = true; } })),
  File: jest.fn(() => {
    const instance = {
      exists: false,
      deleted: false,
      writes: [] as { data: string; options: unknown }[],
      uri: 'file:///cache/mock',
      async write(data: string, options: unknown) {
        this.exists = true;
        this.writes.push({ data, options });
      },
      async digest() { return 'digest'; },
      delete() { this.deleted = true; this.exists = false; },
      async canPreview() { return true; },
      async preview() {},
    };
    mockInstances.push(instance);
    return instance;
  }),
  Paths: { cache: {} },
}));

const frame = (kind: string, fields: Record<string, unknown> = {}) => ({ kind, ...fields }) as unknown as ServerFrame;

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}


describe('FileDownloader', () => {
  beforeEach(() => {
    mockInstances.length = 0;
  });

  it('uses decoded bytes from the server offset when requesting the next chunk', async () => {
    const sent: ClientFrame[] = [];
    const states: { path: string; status: string }[] = [];
    const downloader = new FileDownloader('session', (outgoing) => { sent.push(outgoing); return true; }, (path, state) => {
      states.push({ path, status: state.status });
    });

    downloader.open('/workspace/report.bin');
    const resolve = sent[0] as { requestId: string };
    downloader.handleFrame(frame('file-resolved', {
      requestId: resolve.requestId,
      path: '/workspace/report.bin',
      name: 'report.bin',
    }));
    const open = sent[1] as { requestId: string };
    downloader.handleFrame(frame('file-download-opened', {
      requestId: open.requestId,
      transferId: 'transfer-1',
      size: 5,
    }));
    downloader.handleFrame(frame('file-download-chunk', {
      transferId: 'transfer-1', offset: 0, data: 'AQID', eof: false,
    }));
    await flush();

    expect(sent).toContainEqual(expect.objectContaining({ type: 'file-download-read', transferId: 'transfer-1', offset: 3 }));
    expect(mockInstances[0].writes).toEqual([{ data: 'AQID', options: { encoding: 'base64', append: false } }]);
    expect(states).toContainEqual({ path: '/workspace/report.bin', status: 'downloading' });
    downloader.dispose();
  });

  it('removes partial files and fails outstanding transfers after a read error', async () => {
    const sent: ClientFrame[] = [];
    const states: { path: string; status: string; message?: string }[] = [];
    const downloader = new FileDownloader('session', (outgoing) => { sent.push(outgoing); return true; }, (path, state) => {
      states.push({ path, status: state.status, message: state.status === 'error' ? state.message : undefined });
    });

    downloader.open('/workspace/report.bin');
    const resolve = sent[0] as { requestId: string };
    downloader.handleFrame(frame('file-resolved', { requestId: resolve.requestId, path: '/workspace/report.bin' }));
    const open = sent[1] as { requestId: string };
    downloader.handleFrame(frame('file-download-opened', {
      requestId: open.requestId, transferId: 'transfer-1', size: 8,
    }));
    downloader.handleFrame(frame('file-download-chunk', {
      transferId: 'transfer-1', offset: 0, data: 'AQID', eof: false,
    }));
    await flush();
    downloader.handleFrame(frame('error', {
      code: 'file-unreadable', requestType: 'file-download-read',
    }));

    expect(mockInstances[0].deleted).toBe(true);
    expect(states.at(-1)).toEqual({ path: '/workspace/report.bin', status: 'error', message: '文件无法读取' });
    expect(sent.filter((item) => item.type === 'file-download-read')).toHaveLength(2);
    downloader.dispose();
  });
  it('accepts a completed download only after its digest matches', async () => {
    const sent: ClientFrame[] = [];
    const states: { path: string; status: string }[] = [];
    const downloader = new FileDownloader('session', (outgoing) => { sent.push(outgoing); return true; }, (path, state) => {
      states.push({ path, status: state.status });
    });

    downloader.open('/workspace/report.bin');
    const resolve = sent[0] as { requestId: string };
    downloader.handleFrame(frame('file-resolved', { requestId: resolve.requestId, path: '/workspace/report.bin' }));
    const open = sent[1] as { requestId: string };
    downloader.handleFrame(frame('file-download-opened', { requestId: open.requestId, transferId: 'transfer-1', size: 3 }));
    downloader.handleFrame(frame('file-download-chunk', {
      transferId: 'transfer-1', offset: 0, data: 'AQID', eof: true, sha256: 'DIGEST',
    }));
    await flush();

    expect(mockInstances[0].writes).toHaveLength(1);
    expect(states.at(-1)).toEqual({ path: '/workspace/report.bin', status: 'ready' });
    downloader.dispose();
  });

  it('removes partial files and reports local write failures', async () => {
    const sent: ClientFrame[] = [];
    const states: { path: string; status: string; message?: string }[] = [];
    const downloader = new FileDownloader('session', (outgoing) => { sent.push(outgoing); return true; }, (path, state) => {
      states.push({ path, status: state.status, message: state.status === 'error' ? state.message : undefined });
    });

    downloader.open('/workspace/report.bin');
    const resolve = sent[0] as { requestId: string };
    downloader.handleFrame(frame('file-resolved', { requestId: resolve.requestId, path: '/workspace/report.bin' }));
    const open = sent[1] as { requestId: string };
    downloader.handleFrame(frame('file-download-opened', { requestId: open.requestId, transferId: 'transfer-1', size: 6 }));
    const write = jest.fn<Promise<void>, [string, unknown]>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Disk full'));
    Object.assign(mockInstances[0], { write });
    mockInstances[0].exists = true;
    downloader.handleFrame(frame('file-download-chunk', { transferId: 'transfer-1', offset: 0, data: 'AQID', eof: false }));
    await flush();
    downloader.handleFrame(frame('file-download-chunk', { transferId: 'transfer-1', offset: 3, data: 'BAUG', eof: true }));
    await flush();

    expect(write).toHaveBeenCalled();
    expect(mockInstances[0].deleted).toBe(true);
    expect(sent).toContainEqual({ type: 'file-download-cancel', transferId: 'transfer-1' });
    expect(states.at(-1)).toEqual({ path: '/workspace/report.bin', status: 'error', message: 'Disk full' });
    downloader.dispose();
  });
 });

