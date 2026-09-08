import {
  privateStorage,
  privateStorageChanges,
  getVaultEpoch,
  onVaultStateChanged,
} from '../vault/storage';
/** A non-personal tombstone prevents work started before erasure from restoring data. */
export const DATA_GENERATION_KEY = 'attentionDataGeneration';
const DATA_LOCK_NAME = 'attention-personal-data';
export const SYNC_REVISIONS_KEY = 'attentionSyncRevisions';
export type SyncSource = 'readwise' | 'notion' | 'obsidian' | 'history';

export interface DataOperation {
  generation: string;
  /** A lock/unlock cycle invalidates work even when the stored data is unchanged. */
  vaultEpoch?: string;
  sync?: { source: SyncSource; revision: string };
}

export class DataOperationCancelledError extends Error {
  constructor() {
    super('Attention data changed while this operation was running.');
    this.name = 'DataOperationCancelledError';
  }
}

export async function withAttentionDataLock<T>(
  work: () => Promise<T>,
): Promise<T> {
  // Web Locks coordinate extension documents and the service worker, including
  // storage writes that have started but have not completed yet.
  if (!globalThis.navigator?.locks) {
    return Promise.reject(
      new Error('Attention data coordination unavailable.'),
    );
  }
  return await navigator.locks.request(DATA_LOCK_NAME, work);
}

async function generation(
  storage: chrome.storage.StorageArea,
): Promise<string> {
  const stored = await storage.get(DATA_GENERATION_KEY);
  return typeof stored[DATA_GENERATION_KEY] === 'string'
    ? stored[DATA_GENERATION_KEY]
    : 'initial';
}

async function assertCurrent(
  operation: DataOperation,
  storage: chrome.storage.StorageArea,
): Promise<void> {
  if (storage === privateStorage && operation.vaultEpoch === undefined)
    throw new DataOperationCancelledError();
  if (operation.vaultEpoch !== undefined) {
    let epoch: string;
    try {
      epoch = await getVaultEpoch();
    } catch {
      throw new DataOperationCancelledError();
    }
    if (operation.vaultEpoch !== epoch) throw new DataOperationCancelledError();
  }
  if ((await generation(storage)) !== operation.generation) {
    throw new DataOperationCancelledError();
  }
  if (operation.sync) {
    const stored = await storage.get(SYNC_REVISIONS_KEY);
    const revisions = stored[SYNC_REVISIONS_KEY] as
      Record<string, unknown> | undefined;
    if (revisions?.[operation.sync.source] !== operation.sync.revision) {
      throw new DataOperationCancelledError();
    }
  }
}

async function advanceSync(
  source: SyncSource,
  storage: chrome.storage.StorageArea,
): Promise<DataOperation> {
  const stored = await storage.get(SYNC_REVISIONS_KEY);
  const previous = stored[SYNC_REVISIONS_KEY];
  const revisions = previous && typeof previous === 'object' ? previous : {};
  const revision = crypto.randomUUID();
  await storage.set({
    [SYNC_REVISIONS_KEY]: { ...revisions, [source]: revision },
  });
  return {
    generation: await generation(storage),
    ...(storage === privateStorage
      ? { vaultEpoch: await getVaultEpoch() }
      : {}),
    sync: { source, revision },
  };
}

/** The latest accepted sync for one source supersedes earlier work in every context. */
export function beginSyncOperation(
  source: SyncSource,
  startedOperation?: DataOperation,
  storage: chrome.storage.StorageArea = privateStorage,
): Promise<DataOperation> {
  return withAttentionDataLock(async () => {
    if (startedOperation) {
      await assertCurrent(startedOperation, storage);
      if (startedOperation.sync) {
        if (startedOperation.sync.source !== source)
          throw new DataOperationCancelledError();
        return startedOperation;
      }
    }
    return advanceSync(source, storage);
  });
}

/** Invalidate pending imports and disconnect their source in one critical section. */
export function cancelSyncOperation<T>(
  source: SyncSource,
  clear: () => Promise<T>,
  storage: chrome.storage.StorageArea = privateStorage,
): Promise<T> {
  return withAttentionDataLock(async () => {
    await advanceSync(source, storage);
    return clear();
  });
}

export function beginDataOperation(
  storage: chrome.storage.StorageArea = privateStorage,
): Promise<DataOperation> {
  return withAttentionDataLock(async () => ({
    generation: await generation(storage),
    ...(storage === privateStorage
      ? { vaultEpoch: await getVaultEpoch() }
      : {}),
  }));
}

export function commitDataOperation<T>(
  operation: DataOperation,
  work: () => Promise<T>,
  storage: chrome.storage.StorageArea = privateStorage,
): Promise<T> {
  return withAttentionDataLock(async () => {
    await assertCurrent(operation, storage);
    return work();
  });
}

/** Abort ongoing network IO when another extension context replaces/erases its operation. */
export async function observeDataOperation(operation: DataOperation): Promise<{
  signal: AbortSignal;
  dispose: () => void;
}> {
  const controller = new AbortController();
  const changes = privateStorageChanges;
  const listener = (
    items: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== 'local') return;
    if (!items[DATA_GENERATION_KEY] && !items[SYNC_REVISIONS_KEY]) return;
    // Events can arrive after a newer revision was accepted. Read current
    // metadata instead of treating a delayed event payload as current state.
    // This read does not wait on the erase lock, so blocked IDB cleanup cannot
    // keep an obsolete network request alive.
    void assertCurrent(operation, privateStorage).catch(() =>
      controller.abort(),
    );
  };
  changes?.addListener(listener);
  const stopWatchingVault = onVaultStateChanged(() => {
    // Lifecycle events invalidate this operation immediately. Waiting on the
    // vault lock would let network IO continue throughout blocked IDB cleanup.
    if (operation.vaultEpoch !== undefined) controller.abort();
  });
  const dispose = (): void => {
    changes?.removeListener(listener);
    stopWatchingVault();
    controller.abort();
  };
  try {
    await assertDataOperationCurrent(operation);
    return { signal: controller.signal, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

export function assertDataOperationCurrent(
  operation: DataOperation,
): Promise<void> {
  return commitDataOperation(operation, async () => undefined);
}
