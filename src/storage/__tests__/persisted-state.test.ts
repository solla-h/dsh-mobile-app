import { Directory, File } from 'expo-file-system';

import { draftSessionIds, loadDraft, saveDraft } from '../drafts';
import { readJson, removeJson, writeJson } from '../persisted-state';

jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents' },
  Directory: jest.fn(),
  File: jest.fn(),
}));

const directoryMock = Directory as unknown as jest.Mock;
const fileMock = File as unknown as jest.Mock;
let directory: { exists: boolean; create: jest.Mock };
let file: {
  exists: boolean;
  text: jest.Mock;
  write: jest.Mock;
  delete: jest.Mock;
};

beforeEach(() => {
  directory = { exists: true, create: jest.fn() };
  file = {
    exists: true,
    text: jest.fn().mockResolvedValue('{"saved":true}'),
    write: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn(),
  };
  directoryMock.mockReset().mockReturnValue(directory);
  fileMock.mockReset().mockReturnValue(file);
});

describe('readJson', () => {
  it('reads JSON from the named file in the document state directory', async () => {
    await expect(readJson('drafts')).resolves.toEqual({ saved: true });
    expect(directoryMock).toHaveBeenCalledWith('file:///documents', 'dsh-state');
    expect(fileMock).toHaveBeenCalledWith(directory, 'drafts.json');
    expect(directory.create).not.toHaveBeenCalled();
    expect(file.text).toHaveBeenCalledTimes(1);
  });

  it('creates a missing state directory before accessing a file', async () => {
    directory.exists = false;
    file.exists = false;

    await expect(readJson('drafts')).resolves.toBeNull();

    expect(directory.create).toHaveBeenCalledWith({ intermediates: true });
    expect(file.text).not.toHaveBeenCalled();
  });

  it('returns null for a missing file without attempting to read it', async () => {
    file.exists = false;

    await expect(readJson('missing')).resolves.toBeNull();
    expect(file.text).not.toHaveBeenCalled();
  });

  it.each(['', '{broken'])('returns null for empty or malformed JSON: %s', async (raw) => {
    file.text.mockResolvedValue(raw);

    await expect(readJson('drafts')).resolves.toBeNull();
  });

  it('returns null when reading the file rejects', async () => {
    file.text.mockRejectedValue(new Error('Read failed'));

    await expect(readJson('drafts')).resolves.toBeNull();
  });

  it('returns null when directory creation fails', async () => {
    directory.exists = false;
    directory.create.mockImplementation(() => { throw new Error('Directory unavailable'); });

    await expect(readJson('drafts')).resolves.toBeNull();
    expect(fileMock).not.toHaveBeenCalled();
  });
});

describe('writeJson', () => {
  it('replaces an existing file with serialized JSON', async () => {
    const operations: string[] = [];
    file.delete.mockImplementation(() => { operations.push('delete'); });
    file.write.mockImplementation(async () => { operations.push('write'); });

    await expect(writeJson('drafts', { first: 'Draft text' })).resolves.toBeUndefined();

    expect(operations).toEqual(['delete', 'write']);
    expect(fileMock).toHaveBeenCalledWith(directory, 'drafts.json');
    expect(file.write).toHaveBeenCalledWith('{"first":"Draft text"}');
  });

  it('writes a new file without trying to delete it', async () => {
    directory.exists = false;
    file.exists = false;

    await writeJson('outbox', [{ text: 'Queued message' }]);

    expect(directory.create).toHaveBeenCalledWith({ intermediates: true });
    expect(file.delete).not.toHaveBeenCalled();
    expect(file.write).toHaveBeenCalledWith('[{"text":"Queued message"}]');
  });

  it('absorbs write rejection and allows a later persistence attempt', async () => {
    file.write.mockRejectedValueOnce(new Error('Disk full'));

    await expect(writeJson('drafts', { first: 'Initial' })).resolves.toBeUndefined();
    await expect(writeJson('drafts', { first: 'Edited' })).resolves.toBeUndefined();

    expect(file.write).toHaveBeenCalledTimes(2);
    expect(file.write).toHaveBeenLastCalledWith('{"first":"Edited"}');
  });

  it('absorbs deletion failure without trying to overwrite the existing file', async () => {
    file.delete.mockImplementation(() => { throw new Error('Delete failed'); });

    await expect(writeJson('drafts', {})).resolves.toBeUndefined();
    expect(file.write).not.toHaveBeenCalled();
  });

  it('absorbs directory creation failure', async () => {
    directory.exists = false;
    directory.create.mockImplementation(() => { throw new Error('Directory unavailable'); });

    await expect(writeJson('drafts', {})).resolves.toBeUndefined();
    expect(fileMock).not.toHaveBeenCalled();
  });
});

describe('removeJson', () => {
  it('deletes an existing named file', async () => {
    await expect(removeJson('drafts')).resolves.toBeUndefined();

    expect(fileMock).toHaveBeenCalledWith(directory, 'drafts.json');
    expect(file.delete).toHaveBeenCalledTimes(1);
    expect(file.text).not.toHaveBeenCalled();
    expect(file.write).not.toHaveBeenCalled();
  });

  it('does nothing when the file is already absent', async () => {
    file.exists = false;

    await expect(removeJson('drafts')).resolves.toBeUndefined();
    expect(file.delete).not.toHaveBeenCalled();
  });

  it('absorbs deletion failure', async () => {
    file.delete.mockImplementation(() => { throw new Error('Delete failed'); });

    await expect(removeJson('drafts')).resolves.toBeUndefined();
  });
});

describe('drafts with real persistence helpers', () => {
  it('keeps cached edits after a failed flush and retries on the next edit', async () => {
    jest.useFakeTimers();
    try {
      file.text.mockResolvedValue('{"first":"Saved draft","second":"Keep me"}');
      file.write.mockRejectedValueOnce(new Error('Disk full'));
      expect(await loadDraft('first')).toBe('Saved draft');

      saveDraft('first', 'Unsaved edit');
      await jest.advanceTimersByTimeAsync(400);

      expect(file.write).toHaveBeenCalledTimes(1);
      expect(file.write).toHaveBeenLastCalledWith('{"first":"Unsaved edit","second":"Keep me"}');
      expect(await loadDraft('first')).toBe('Unsaved edit');
      expect(await loadDraft('second')).toBe('Keep me');
      expect(await draftSessionIds()).toEqual(['first', 'second']);
      await jest.advanceTimersByTimeAsync(800);
      expect(file.write).toHaveBeenCalledTimes(1);

      saveDraft('first', 'Next edit');
      await jest.advanceTimersByTimeAsync(400);

      expect(file.write).toHaveBeenCalledTimes(2);
      expect(file.write).toHaveBeenLastCalledWith('{"first":"Next edit","second":"Keep me"}');
      expect(await loadDraft('first')).toBe('Next edit');
      expect(file.text).toHaveBeenCalledTimes(1);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});
