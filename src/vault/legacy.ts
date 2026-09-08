import type { ObsidianNoteRecord } from '../obsidian/types';
import type { NotionPageRecord } from '../notion/types';

export const OBSIDIAN_DATA_KEY = 'vaultObsidianData';
export const NOTION_DATA_KEY = 'vaultNotionData';

export interface ObsidianVaultData {
  notes: ObsidianNoteRecord[];
  searchIndex?: unknown;
}

export interface NotionVaultData {
  pages: NotionPageRecord[];
  searchIndex?: unknown;
}

const LEGACY_DATABASES = [
  {
    name: 'attention-obsidian-v1',
    recordsStore: 'notes',
    recordsField: 'notes',
    key: OBSIDIAN_DATA_KEY,
  },
  {
    name: 'attention-notion-v1',
    recordsStore: 'pages',
    recordsField: 'pages',
    key: NOTION_DATA_KEY,
  },
] as const;

async function existingDatabaseNames(): Promise<Set<string>> {
  // Listing first avoids creating an empty plaintext database during startup.
  // Do not guess that an unavailable/failed database API means no legacy data.
  if (!globalThis.indexedDB?.databases)
    throw new Error('Legacy database discovery is unavailable.');
  const databases = await indexedDB.databases();
  return new Set(databases.flatMap(({ name }) => (name ? [name] : [])));
}

function openExistingDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Omitting a version opens the actual legacy version without upgrading it.
    const request = indexedDB.open(name);
    let rejected = false;
    const fail = (error: Error): void => {
      rejected = true;
      reject(error);
    };
    request.addEventListener('upgradeneeded', () => {
      // The database was deleted after discovery. Abort its recreation.
      request.transaction?.abort();
      fail(new Error('Legacy database changed during migration.'));
    });
    request.addEventListener('blocked', () =>
      fail(new Error('Close other Attention pages to migrate legacy data.')),
    );
    request.addEventListener('error', () =>
      fail(request.error ?? new Error('Legacy database could not be opened.')),
    );
    request.addEventListener('success', () => {
      const database = request.result;
      if (rejected) {
        database.close();
        return;
      }
      if (database.version < 1 || database.version > 2) {
        database.close();
        fail(new Error('Unsupported legacy database version.'));
        return;
      }
      database.addEventListener('versionchange', () => database.close());
      resolve(database);
    });
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      'error',
      () =>
        reject(request.error ?? new Error('Legacy data could not be read.')),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('Legacy data read aborted.')),
      { once: true },
    );
  });
}

/** Read the old plaintext stores only; encryption and verification happen in storage.ts. */
export async function readLegacyDatabases(): Promise<Record<string, unknown>> {
  const existing = await existingDatabaseNames();
  const result: Record<string, unknown> = {};
  for (const source of LEGACY_DATABASES) {
    if (!existing.has(source.name)) continue;
    const database = await openExistingDatabase(source.name);
    try {
      if (!database.objectStoreNames.contains(source.recordsStore))
        throw new Error('Legacy database is missing its records store.');
      const hasIndex = database.objectStoreNames.contains('search-index');
      const transaction = database.transaction(
        hasIndex
          ? [source.recordsStore, 'search-index']
          : [source.recordsStore],
        'readonly',
      );
      const done = transactionDone(transaction);
      const records = requestResult(
        transaction.objectStore(source.recordsStore).getAll(),
      );
      const searchIndex = hasIndex
        ? requestResult(
            transaction.objectStore('search-index').get('fragments'),
          )
        : Promise.resolve(undefined);
      const [read, completed] = await Promise.allSettled([
        Promise.all([records, searchIndex]),
        done,
      ]);
      if (read.status === 'rejected') throw read.reason;
      if (completed.status === 'rejected') throw completed.reason;
      const [recordValues, indexValue] = read.value;
      result[source.key] = {
        [source.recordsField]: recordValues,
        ...(indexValue === undefined ? {} : { searchIndex: indexValue }),
      };
      // The connection store is deliberately never read: directory handles
      // cannot be encrypted and belong only to the active page's memory.
    } finally {
      database.close();
    }
  }
  return result;
}

/** Call only after a verified encrypted copy, or as part of an explicit reset. */
export async function clearLegacyDatabases(): Promise<void> {
  const existing = await existingDatabaseNames();
  for (const { name } of LEGACY_DATABASES) {
    if (!existing.has(name)) continue;
    await new Promise<void>((resolve, reject) => {
      // Removing the complete database also removes all persisted handles.
      const request = indexedDB.deleteDatabase(name);
      request.addEventListener('success', () => resolve(), { once: true });
      request.addEventListener(
        'blocked',
        () =>
          reject(
            new Error('Close other Attention pages to remove legacy data.'),
          ),
        { once: true },
      );
      request.addEventListener(
        'error',
        () =>
          reject(
            request.error ?? new Error('Legacy data could not be removed.'),
          ),
        { once: true },
      );
    });
  }
}
