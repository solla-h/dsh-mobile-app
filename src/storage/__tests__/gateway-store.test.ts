import * as SecureStore from 'expo-secure-store';

import {
  activateGateway,
  loadActiveGateway,
  loadGateways,
  patchGatewayIfExists,
  removeGateway,
  upsertGateway,
  type SavedGateway,
} from '../gateway-store';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-device-id' }));

const GATEWAYS_KEY = 'dsh.gateways.v2';
const ACTIVE_KEY = 'dsh.gateways.active';
const LEGACY_KEY = 'dsh.gateway.v1';
const getMock = SecureStore.getItemAsync as jest.Mock;
const setMock = SecureStore.setItemAsync as jest.Mock;
const deleteMock = SecureStore.deleteItemAsync as jest.Mock;
let memory: Map<string, string>;

function gateway(name: string): SavedGateway {
  return {
    id: `gw:${name}`,
    gatewayId: name,
    url: `wss://${name}.example.com/ws/mobile`,
    pairedAt: 100,
  };
}

function seed(items: SavedGateway[], activeId = items[0]?.id): void {
  memory.set(GATEWAYS_KEY, JSON.stringify(items));
  if (activeId) memory.set(ACTIVE_KEY, activeId);
}

beforeEach(() => {
  memory = new Map();
  getMock.mockReset().mockImplementation(async (key: string) => memory.get(key) ?? null);
  setMock.mockReset().mockImplementation(async (key: string, value: string) => {
    memory.set(key, value);
  });
  deleteMock.mockReset().mockImplementation(async (key: string) => {
    memory.delete(key);
  });
});

describe('gateway write lock', () => {
  it('serializes overlapping upserts so neither gateway is lost', async () => {
    seed([]);
    const { promise: blockedWrite, resolve: releaseWrite } = Promise.withResolvers<void>();
    const { promise: writeStarted, resolve: signalWrite } = Promise.withResolvers<void>();
    setMock.mockImplementationOnce(async (key: string, value: string) => {
      signalWrite();
      await blockedWrite;
      memory.set(key, value);
    });

    const first = upsertGateway(gateway('first'));
    const second = upsertGateway(gateway('second'));
    await writeStarted;
    const readsWhileBlocked = getMock.mock.calls.length;
    releaseWrite();
    await Promise.all([first, second]);

    expect(readsWhileBlocked).toBe(1);
    expect(await loadGateways()).toEqual([gateway('second'), gateway('first')]);
    expect((await loadActiveGateway())?.id).toBe('gw:second');
  });

  it('merges concurrent patches against the latest record without changing the active gateway', async () => {
    seed([gateway('first'), gateway('second')], 'gw:second');

    await Promise.all([
      patchGatewayIfExists('gw:first', { gatewayName: 'Renamed' }),
      patchGatewayIfExists('gw:first', (current) => ({ label: `${current.gatewayName} label` })),
      activateGateway('gw:second'),
    ]);

    expect((await loadGateways())[0]).toEqual({
      ...gateway('first'),
      gatewayName: 'Renamed',
      label: 'Renamed label',
    });
    expect((await loadActiveGateway())?.id).toBe('gw:second');
  });

  it('allows queued writes to continue after an earlier write rejects', async () => {
    seed([]);
    setMock.mockRejectedValueOnce(new Error('SecureStore unavailable'));

    const failed = upsertGateway(gateway('first'));
    const queued = upsertGateway(gateway('second'));
    await expect(failed).rejects.toThrow('SecureStore unavailable');
    await expect(queued).resolves.toEqual(gateway('second'));
    expect(await loadGateways()).toEqual([gateway('second')]);
    expect((await loadActiveGateway())?.id).toBe('gw:second');
  });
});

describe('legacy gateway migration', () => {
  it('migrates and activates a legacy record once, preserving its pairing metadata', async () => {
    const legacy = {
      url: 'wss://legacy.example.com/ws/mobile',
      gatewayId: 'legacy',
      label: 'Legacy gateway',
      pairedAt: 42,
    };
    memory.set(LEGACY_KEY, JSON.stringify(legacy));
    const migrated = { ...legacy, id: 'gw:legacy' };

    expect(await loadGateways()).toEqual([migrated]);
    expect(JSON.parse(memory.get(GATEWAYS_KEY)!)).toEqual([migrated]);
    expect(memory.get(ACTIVE_KEY)).toBe('gw:legacy');
    expect(memory.has(LEGACY_KEY)).toBe(false);
    expect(await loadActiveGateway()).toEqual(migrated);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledTimes(2);
  });

  it('uses the URL as the stable identity when a legacy gateway has no gatewayId', async () => {
    const legacy = { url: 'wss://legacy.example.com/ws/mobile', pairedAt: 42 };
    memory.set(LEGACY_KEY, JSON.stringify(legacy));

    expect(await loadGateways()).toEqual([{ ...legacy, id: `url:${legacy.url}` }]);
    expect(memory.get(ACTIVE_KEY)).toBe(`url:${legacy.url}`);
  });

  it.each(['{broken', 'null', JSON.stringify({ label: 'Missing URL' })])(
    'ignores invalid legacy data without writing or deleting it: %s',
    async (raw) => {
      memory.set(LEGACY_KEY, raw);
      expect(await loadGateways()).toEqual([]);
      expect(setMock).not.toHaveBeenCalled();
      expect(deleteMock).not.toHaveBeenCalled();
    },
  );

  it('keeps the current list authoritative when legacy data also exists', async () => {
    seed([gateway('current')]);
    memory.set(LEGACY_KEY, JSON.stringify(gateway('legacy')));

    expect(await loadGateways()).toEqual([gateway('current')]);
    expect(setMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe('gateway identity and deletion', () => {
  it('updates a changed endpoint for the same gateway while preserving local id and pairedAt', async () => {
    const existing = { ...gateway('first'), id: 'local:first', label: 'Old label' };
    seed([existing, gateway('second')], 'gw:second');
    const incoming = {
      ...gateway('first'),
      id: 'replacement-id',
      url: 'wss://replacement.example.com/ws/mobile',
      endpoints: ['wss://replacement.example.com/ws/mobile'],
      label: 'New label',
      pairedAt: 999,
    };
    const expected = { ...incoming, id: existing.id, pairedAt: existing.pairedAt };

    expect(await upsertGateway(incoming)).toEqual(expected);
    expect(await loadGateways()).toEqual([expected, gateway('second')]);
    expect(await loadActiveGateway()).toEqual(expected);
  });

  it('enriches a URL-only record with gateway identity without duplicating it', async () => {
    const existing = { id: 'local:first', url: gateway('first').url, pairedAt: 42 };
    seed([existing]);

    const updated = await upsertGateway(gateway('first'));

    expect(updated).toEqual({ ...gateway('first'), id: existing.id, pairedAt: 42 });
    expect(await loadGateways()).toEqual([updated]);
    expect(memory.get(ACTIVE_KEY)).toBe(existing.id);
  });

  it('switches to the first survivor when the active gateway is deleted and rejects a late patch', async () => {
    seed([gateway('first'), gateway('second'), gateway('third')]);
    const latePatch = jest.fn(() => ({ label: 'Late response' }));

    const deletion = removeGateway('gw:first');
    const patch = patchGatewayIfExists('gw:first', latePatch);

    await expect(deletion).resolves.toEqual([gateway('second'), gateway('third')]);
    await expect(patch).resolves.toBeNull();
    expect(latePatch).not.toHaveBeenCalled();
    expect(await loadGateways()).toEqual([gateway('second'), gateway('third')]);
    expect((await loadActiveGateway())?.id).toBe('gw:second');
  });

  it('preserves the active selection when deleting another gateway', async () => {
    seed([gateway('first'), gateway('second')], 'gw:second');

    await removeGateway('gw:first');

    expect((await loadActiveGateway())?.id).toBe('gw:second');
    expect(setMock).not.toHaveBeenCalledWith(ACTIVE_KEY, expect.anything());
  });

  it('clears the active selection when the final gateway is deleted', async () => {
    seed([gateway('first')]);

    expect(await removeGateway('gw:first')).toEqual([]);
    expect(await loadActiveGateway()).toBeNull();
    expect(memory.has(ACTIVE_KEY)).toBe(false);
    expect(JSON.parse(memory.get(GATEWAYS_KEY)!)).toEqual([]);
  });
});
