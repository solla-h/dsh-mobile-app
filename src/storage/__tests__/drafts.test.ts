import type * as Drafts from '../drafts';

jest.mock('../persisted-state', () => ({
  readJson: jest.fn(),
  writeJson: jest.fn(async () => undefined),
}));

let drafts: typeof Drafts;
let readMock: jest.Mock;
let writeMock: jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  // The cache and debounce timer are module state; each test gets a fresh instance.
  jest.isolateModules(() => {
    drafts = jest.requireActual<typeof Drafts>('../drafts');
    const storage = jest.requireMock('../persisted-state') as {
      readJson: jest.Mock;
      writeJson: jest.Mock;
    };
    readMock = storage.readJson;
    writeMock = storage.writeJson;
  });
  readMock.mockReset().mockResolvedValue(null);
  writeMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('draft cache', () => {
  it('loads saved drafts once and lists only sessions with nonempty text', async () => {
    readMock.mockResolvedValue({ first: 'Saved draft', second: 'Another draft', empty: '' });

    expect(await drafts.loadDraft('first')).toBe('Saved draft');
    expect(await drafts.loadDraft('missing')).toBe('');
    expect(await drafts.draftSessionIds()).toEqual(['first', 'second']);
    expect(await drafts.loadDraft('second')).toBe('Another draft');
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(readMock).toHaveBeenCalledWith('drafts');
    expect(writeMock).not.toHaveBeenCalled();
  });

  it.each([null, 'invalid draft map', 7])('uses an empty cache for invalid saved state: %s', async (stored) => {
    readMock.mockResolvedValue(stored);

    expect(await drafts.loadDraft('missing')).toBe('');
    expect(await drafts.draftSessionIds()).toEqual([]);
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it('makes edits visible immediately while preserving other loaded drafts', async () => {
    readMock.mockResolvedValue({ first: 'Old text', second: 'Keep me' });
    await drafts.loadDraft('first');

    drafts.saveDraft('first', 'New text');

    expect(await drafts.loadDraft('first')).toBe('New text');
    expect(await drafts.loadDraft('second')).toBe('Keep me');
    expect(writeMock).not.toHaveBeenCalled();
    jest.advanceTimersByTime(400);
    expect(writeMock).toHaveBeenCalledWith('drafts', { first: 'New text', second: 'Keep me' });
  });

  it('can save before the first load without rereading over the new text', async () => {
    drafts.saveDraft('first', 'New draft');

    expect(await drafts.loadDraft('first')).toBe('New draft');
    expect(await drafts.draftSessionIds()).toEqual(['first']);
    expect(readMock).not.toHaveBeenCalled();
  });
});

describe('draft debounce', () => {
  it('waits 400 ms after the last edit and coalesces edits across sessions', () => {
    drafts.saveDraft('first', 'Initial');
    jest.advanceTimersByTime(200);
    drafts.saveDraft('first', 'Latest');
    drafts.saveDraft('second', 'Other session');
    jest.advanceTimersByTime(399);
    expect(writeMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);

    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith('drafts', { first: 'Latest', second: 'Other session' });
    jest.advanceTimersByTime(1000);
    expect(writeMock).toHaveBeenCalledTimes(1);
  });

  it('removes a cleared draft immediately and persists its deletion after the debounce', async () => {
    readMock.mockResolvedValue({ first: 'Remove me', second: 'Keep me' });
    await drafts.loadDraft('first');
    drafts.saveDraft('first', 'Edited but unsaved');
    jest.advanceTimersByTime(200);

    drafts.clearDraft('first');

    expect(await drafts.loadDraft('first')).toBe('');
    expect(await drafts.draftSessionIds()).toEqual(['second']);
    jest.advanceTimersByTime(399);
    expect(writeMock).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith('drafts', { second: 'Keep me' });
  });

  it('treats an empty save as deletion and writes an empty map when the last draft is cleared', async () => {
    drafts.saveDraft('first', 'Temporary');
    drafts.saveDraft('first', '');

    expect(await drafts.loadDraft('first')).toBe('');
    expect(await drafts.draftSessionIds()).toEqual([]);
    jest.advanceTimersByTime(400);
    expect(writeMock).toHaveBeenCalledWith('drafts', {});
  });

  it('limits both persisted and cached drafts to 30 entries when flushing', async () => {
    for (let index = 0; index < 31; index += 1) {
      drafts.saveDraft(`session-${index}`, `Draft ${index}`);
    }
    const expected = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`session-${index + 1}`, `Draft ${index + 1}`]),
    );

    jest.advanceTimersByTime(400);

    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith('drafts', expected);
    expect(await drafts.loadDraft('session-0')).toBe('');
    expect(await drafts.loadDraft('session-30')).toBe('Draft 30');
    expect(await drafts.draftSessionIds()).toEqual(Object.keys(expected));
  });
});
