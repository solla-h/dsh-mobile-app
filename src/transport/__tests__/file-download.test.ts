
import { FileDownloader } from '../file-download';

jest.mock('expo-file-system', () => {
  const files: Record<string, unknown>[] = [];
  const Directory = jest.fn(function () {
    return { exists: false, create: jest.fn() };
  });
  const File = jest.fn(function () {
    const file = {
      exists: true,
      write: jest.fn(async function (this: { exists: boolean }) { this.exists = true; }),
      uri: 'file:///cache/download',
      delete: jest.fn(function (this: { exists: boolean }) { this.exists = false; }),
      digest: jest.fn(async () => 'expected'),
      canPreview: jest.fn(async () => false),
      preview: jest.fn(async () => undefined),
    };
    files.push(file);
    return file;
  });
  return { Directory, File, Paths: { cache: 'cache' }, __files: files };
});

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'request-id') }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => false), shareAsync: jest.fn() }));

const fileSystemMock = jest.requireMock('expo-file-system') as {
  __files: { delete: jest.Mock; digest: jest.Mock }[];
};

function startDownload() {
  const send = jest.fn(() => true);
  const onState = jest.fn();
  const downloader = new FileDownloader('session', send, onState);
  downloader.open('/workspace/report.txt');
  downloader.handleFrame({ kind: 'file-resolved', requestId: 'request-id', path: '/workspace/report.txt' });
  downloader.handleFrame({
    kind: 'file-download-opened', requestId: 'request-id', transferId: 'transfer-1',
    path: '/workspace/report.txt',
  });
  return { downloader, send, onState };
}

beforeEach(() => {
  jest.useFakeTimers();
  fileSystemMock.__files.length = 0;
});
afterEach(() => jest.useRealTimers());

it('fails and cancels the active transfer on a read error', () => {
  const { downloader, send, onState } = startDownload();
  expect(downloader.handleFrame({
    kind: 'error', code: 'file-unreadable', message: 'cannot read', requestType: 'file-download-read',
  })).toBe(true);
  expect(send).toHaveBeenCalledWith({ type: 'file-download-cancel', transferId: 'transfer-1' });
  expect(onState).toHaveBeenLastCalledWith('/workspace/report.txt', expect.objectContaining({ status: 'error' }));
  expect(fileSystemMock.__files[0].delete).toHaveBeenCalled();
  downloader.dispose();
});

it('times out a silent open and reports a retryable failure', () => {
  const send = jest.fn(() => true);
  const onState = jest.fn();
  const downloader = new FileDownloader('session', send, onState);
  downloader.open('/workspace/report.txt');
  downloader.handleFrame({ kind: 'file-resolved', requestId: 'request-id', path: '/workspace/report.txt' });
  jest.advanceTimersByTime(15_000);
  expect(onState).toHaveBeenLastCalledWith('/workspace/report.txt', expect.objectContaining({ status: 'error' }));
  downloader.dispose();
});

it('times out a silent read, cancels its transfer, and removes the partial file', () => {
  const { downloader, send, onState } = startDownload();
  jest.advanceTimersByTime(15_000);
  expect(send).toHaveBeenCalledWith({ type: 'file-download-cancel', transferId: 'transfer-1' });
  expect(onState).toHaveBeenLastCalledWith('/workspace/report.txt', expect.objectContaining({ status: 'error' }));
  expect(fileSystemMock.__files[0].delete).toHaveBeenCalled();
  downloader.dispose();
});

it('dispose cancels transfers and clears their temporary files', () => {
  const { downloader, send } = startDownload();
  const file = fileSystemMock.__files[0];
  downloader.dispose();
  expect(send).toHaveBeenCalledWith({ type: 'file-download-cancel', transferId: 'transfer-1' });
  expect(file.delete).toHaveBeenCalledTimes(1);
});

it('removes a downloaded file when checksum validation fails', async () => {
  const { downloader, onState } = startDownload();
  const file = fileSystemMock.__files[0];
  file.digest.mockResolvedValue('wrong');
  downloader.handleFrame({
    kind: 'file-download-chunk', transferId: 'transfer-1', offset: 0, data: '', eof: true, sha256: 'expected',
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(file.delete).toHaveBeenCalled();
  expect(onState).toHaveBeenLastCalledWith('/workspace/report.txt', expect.objectContaining({ status: 'error' }));
  downloader.dispose();
});
