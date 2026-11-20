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

