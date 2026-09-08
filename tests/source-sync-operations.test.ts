import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  beginSyncOperation,
  cancelSyncOperation,
  commitDataOperation,
  DataOperationCancelledError,
  observeDataOperation,
  SYNC_REVISIONS_KEY,
  type SyncSource,
} from '../src/privacy/data-operations';
import { clearReadwiseConnection } from '../src/readwise/storage';
import { clearBrowserHistoryEvidence } from '../src/history/storage';
import { DataTestStorage, installDataLocks } from './helpers/data-locks';

let local: DataTestStorage;
beforeEach(() => {
  installDataLocks();
  local = new DataTestStorage();
  vi.stubGlobal('chrome', {
    storage: { local, session: new DataTestStorage() },
  });
});
afterEach(() => vi.unstubAllGlobals());

it.each<SyncSource>(['readwise', 'notion', 'obsidian', 'history'])(
  'supersedes %s imports across independent module contexts',
  async (source) => {
    const old = await beginSyncOperation(source);
    vi.resetModules();
    const other = await import('../src/privacy/data-operations');
    const replacement = await other.beginSyncOperation(source);
    await expect(
      commitDataOperation(old, () => local.set({ old: true })),
    ).rejects.toBeInstanceOf(DataOperationCancelledError);
    await other.commitDataOperation(replacement, () =>
      local.set({ current: true }),
    );
    expect(local.data.old).toBeUndefined();
    expect(local.data.current).toBe(true);
  },
);

it('keeps different source imports independent', async () => {
  const readwise = await beginSyncOperation('readwise');
  const notion = await beginSyncOperation('notion');
  await commitDataOperation(readwise, () => local.set({ readwise: true }));
  await commitDataOperation(notion, () => local.set({ notion: true }));
  expect(local.data).toMatchObject({ readwise: true, notion: true });
});

it.each([
  ['readwise', clearReadwiseConnection],
  ['history', clearBrowserHistoryEvidence],
] as const)(
  'source deletion cancels a pending %s import',
  async (source, clear) => {
    const operation = await beginSyncOperation(source);
    await local.set({
      readwiseToken: { token: 'test-only-token' },
      browserHistoryEvidence: { test: true },
    });
    await clear();
    await expect(
      commitDataOperation(operation, () => local.set({ restored: true })),
    ).rejects.toBeInstanceOf(DataOperationCancelledError);
    expect(local.data.restored).toBeUndefined();
  },
);

it('cannot resume an OAuth/picker operation cancelled by a different extension context', async () => {
  const authorization = await beginSyncOperation('notion');
  await cancelSyncOperation('notion', async () => undefined);
  await expect(
    beginSyncOperation('notion', authorization),
  ).rejects.toBeInstanceOf(DataOperationCancelledError);
});

it('aborts an observed operation when persisted source ownership changes', async () => {
  const listeners = new Set<
    (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => void
  >();
  vi.stubGlobal('chrome', {
    storage: {
      local,
      onChanged: {
        addListener: (listener: Parameters<typeof listeners.add>[0]) =>
          listeners.add(listener),
        removeListener: (listener: Parameters<typeof listeners.delete>[0]) =>
          listeners.delete(listener),
      },
    },
  });
  const operation = await beginSyncOperation('readwise');
  const observation = await observeDataOperation(operation);
  await beginSyncOperation('readwise');
  for (const listener of listeners)
    listener(
      { [SYNC_REVISIONS_KEY]: { newValue: local.data[SYNC_REVISIONS_KEY] } },
      'local',
    );
  await vi.waitFor(() => expect(observation.signal.aborted).toBe(true));
  observation.dispose();
  expect(listeners.size).toBe(0);
});
