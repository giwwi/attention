/** Only authenticated ciphertext and public, opaque identifiers enter this database. */
export interface EncryptedRecord {
  version: 1;
  id: string;
  nonce: string;
  ciphertext: string;
}

const DATABASE = 'attention-encrypted-vault';
const RECORDS = 'records';
const EVENTS = 'events';

function open(create = false): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!create) {
        // Missing ciphertext storage is not an empty vault. Only explicit
        // creation/reset may initialize a new encrypted database.
        request.transaction?.abort();
        return;
      }
      request.result.createObjectStore(RECORDS, { keyPath: 'id' });
      // The sequence is only for bounding the encrypted notification journal.
      const events = request.result.createObjectStore(EVENTS, {
        autoIncrement: true,
      });
      events.createIndex('id', 'id', { unique: true });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(new Error('Encrypted storage unavailable.'));
    request.onblocked = () => reject(new Error('Encrypted storage is busy.'));
  });
}

async function read<T>(
  store: string,
  query: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(store, 'readonly');
      const request = query(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () =>
        reject(new Error('Encrypted storage could not be read.'));
    });
  } finally {
    db.close();
  }
}

export function readRecords(): Promise<EncryptedRecord[]> {
  return read(RECORDS, (store) => store.getAll());
}

export function readRecord(id: string): Promise<EncryptedRecord | undefined> {
  return read(RECORDS, (store) => store.get(id));
}

export function readEvent(id: string): Promise<EncryptedRecord | undefined> {
  return read(EVENTS, (store) => store.index('id').get(id));
}

/** Auto-increment primary keys preserve commit order independently of Chrome's
 * best-effort cross-context notification pointer. The journal is bounded to 32. */
export function readLatestEvent(): Promise<EncryptedRecord | undefined> {
  return read<EncryptedRecord[]>(EVENTS, (store) => store.getAll()).then(
    (events) => events.at(-1),
  );
}

/** The records and their encrypted change notification commit atomically. */
export async function writeRecords(
  put: EncryptedRecord[],
  remove: string[] = [],
  event?: EncryptedRecord,
  clear = false,
): Promise<void> {
  const db = await open(clear);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([RECORDS, EVENTS], 'readwrite');
      const records = transaction.objectStore(RECORDS);
      const events = transaction.objectStore(EVENTS);
      if (clear) {
        records.clear();
        events.clear();
      }
      for (const id of remove) records.delete(id);
      for (const record of put) records.put(record);
      if (event) events.add(event);
      const keys = events.getAllKeys();
      keys.onsuccess = () => {
        for (const key of keys.result.slice(0, -32)) events.delete(key);
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(new Error('Encrypted storage could not be updated.'));
    });
  } finally {
    db.close();
  }
}

export function clearRecords(): Promise<void> {
  return writeRecords([], [], undefined, true);
}

/** Erasure must also recover from an unreadable schema or unsupported version. */
export function deleteVaultDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(new Error('Encrypted storage could not be erased.'));
    request.onblocked = () =>
      reject(
        new Error(
          'Close other Attention pages to finish erasing encrypted storage.',
        ),
      );
  });
}
