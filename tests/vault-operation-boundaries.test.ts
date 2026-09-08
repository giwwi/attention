import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  epoch: 'epoch-a' as string | null,
  items: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
}));
vi.mock('../src/vault/storage', () => ({
  privateStorage: {
    async get(key: string) {
      if (!state.epoch) throw new Error('locked');
      return { [key]: state.items[key] };
    },
    async set(items: Record<string, unknown>) {
      Object.assign(state.items, items);
    },
  },
  privateStorageChanges: { addListener: vi.fn(), removeListener: vi.fn() },
  getVaultEpoch: async () => {
    if (!state.epoch) throw new Error('locked');
    return state.epoch;
  },
  onVaultStateChanged: (listener: () => void) => {
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  },
}));
import {
  beginDataOperation,
  commitDataOperation,
  observeDataOperation,
  DataOperationCancelledError,
} from '../src/privacy/data-operations';
import { assertExtensionCloudAiAllowed } from '../src/privacy/settings';

describe('vault operation boundaries', () => {
  beforeEach(() => {
    state.epoch = 'epoch-a';
    state.items = {};
    state.listeners.clear();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (_name: string, work: () => Promise<unknown>) => work(),
      },
    });
  });

  it('rejects old work after lock and unlock even if the data generation stayed unchanged', async () => {
    const operation = await beginDataOperation();
    state.epoch = 'epoch-b';
    const write = vi.fn();
    await expect(commitDataOperation(operation, write)).rejects.toBeInstanceOf(
      DataOperationCancelledError,
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('reports cancellation after reset and rejects production operations missing their epoch', async () => {
    const operation = await beginDataOperation();
    state.epoch = null;
    await expect(
      commitDataOperation(operation, vi.fn()),
    ).rejects.toBeInstanceOf(DataOperationCancelledError);
    state.epoch = 'epoch-b';
    await expect(
      commitDataOperation({ generation: 'initial' }, vi.fn()),
    ).rejects.toBeInstanceOf(DataOperationCancelledError);
  });

  it('aborts network IO synchronously on lifecycle notification before reset cleanup can finish', async () => {
    const operation = await beginDataOperation();
    const observation = await observeDataOperation(operation);
    state.epoch = null;
    for (const listener of state.listeners) listener();
    expect(observation.signal.aborted).toBe(true);
    observation.dispose();
    expect(state.listeners.size).toBe(0);
  });

  it('reads the encrypted privacy setting instead of a raw Chrome-storage alias', async () => {
    const rawRead = vi.fn(() => {
      throw new Error('raw private read');
    });
    vi.stubGlobal('chrome', { storage: { local: { get: rawRead } } });
    state.items.privacySettings = { localOnly: false, updatedAt: '' };
    await expect(assertExtensionCloudAiAllowed()).resolves.toBeUndefined();
    expect(rawRead).not.toHaveBeenCalled();
    state.epoch = null;
    await expect(assertExtensionCloudAiAllowed()).rejects.toThrow('locked');
    vi.unstubAllGlobals();
  });
});
