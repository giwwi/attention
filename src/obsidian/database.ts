import type { ObsidianIndex, ObsidianNoteRecord } from './types';
import {
  buildLocalSearchIndex,
  isLocalSearchIndex,
  updateLocalSearchIndex,
  type LocalSearchDocument,
  type LocalSearchIndex,
} from '../evidence/local-search-index';

const DATABASE_NAME = 'attention-obsidian-v1';
const DATABASE_VERSION = 2;
const CONNECTION_STORE = 'connection';
const NOTES_STORE = 'notes';
const INDEX_STORE = 'search-index';
const VAULT_HANDLE_KEY = 'vault';
const SEARCH_INDEX_KEY = 'fragments';

interface PermissionDescriptor {
  mode: 'read';
}

export interface PersistedDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(descriptor?: PermissionDescriptor): Promise<PermissionState>;
  requestPermission(
    descriptor?: PermissionDescriptor,
  ): Promise<PermissionState>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed.')),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB aborted.')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB failed.')),
      { once: true },
    );
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener('upgradeneeded', () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(CONNECTION_STORE)) {
      database.createObjectStore(CONNECTION_STORE);
    }
    if (!database.objectStoreNames.contains(NOTES_STORE)) {
      database.createObjectStore(NOTES_STORE, { keyPath: 'path' });
    }
    if (!database.objectStoreNames.contains(INDEX_STORE)) {
      database.createObjectStore(INDEX_STORE);
    }
  });
  return requestResult(request);
}

export async function saveVaultHandle(
  handle: PersistedDirectoryHandle,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CONNECTION_STORE, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(CONNECTION_STORE).put(handle, VAULT_HANDLE_KEY);
    await done;
  } finally {
    database.close();
  }
}

export async function loadVaultHandle(): Promise<PersistedDirectoryHandle | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CONNECTION_STORE, 'readonly');
    const done = transactionDone(transaction);
    const value = await requestResult(
      transaction.objectStore(CONNECTION_STORE).get(VAULT_HANDLE_KEY),
    );
    await done;
    return value && typeof value === 'object'
      ? (value as PersistedDirectoryHandle)
      : null;
  } finally {
    database.close();
  }
}

export async function loadObsidianNotes(): Promise<ObsidianNoteRecord[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(NOTES_STORE, 'readonly');
    const done = transactionDone(transaction);
    const notes = await requestResult(
      transaction.objectStore(NOTES_STORE).getAll(),
    );
    await done;
    return notes as ObsidianNoteRecord[];
  } finally {
    database.close();
  }
}

export async function replaceObsidianNotes(
  notes: ObsidianNoteRecord[],
  generatedAt: string,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [NOTES_STORE, INDEX_STORE],
      'readwrite',
    );
    const done = transactionDone(transaction);
    const store = transaction.objectStore(NOTES_STORE);
    store.clear();
    for (const note of notes) store.put(note);
    transaction
      .objectStore(INDEX_STORE)
      .put(buildObsidianSearchIndex(notes, generatedAt), SEARCH_INDEX_KEY);
    await done;
  } finally {
    database.close();
  }
}

function buildObsidianSearchIndex(
  notes: ObsidianNoteRecord[],
  generatedAt: string,
): LocalSearchIndex {
  return buildLocalSearchIndex(obsidianSearchDocuments(notes), generatedAt);
}

function obsidianSearchDocuments(
  notes: ObsidianNoteRecord[],
): LocalSearchDocument[] {
  return notes.flatMap((note) =>
    note.fragments.map((fragment) => ({
      id: fragment.id,
      text: [
        note.title,
        fragment.heading ?? '',
        fragment.text,
        ...fragment.tags,
        ...fragment.links,
      ].join(' '),
    })),
  );
}

async function loadStoredObsidianSearchIndex(): Promise<unknown> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(INDEX_STORE, 'readonly');
    const done = transactionDone(transaction);
    const value = await requestResult(
      transaction.objectStore(INDEX_STORE).get(SEARCH_INDEX_KEY),
    );
    await done;
    return value;
  } finally {
    database.close();
  }
}

export async function applyObsidianNoteChanges(input: {
  upserts: ObsidianNoteRecord[];
  removedPaths: string[];
  removedFragmentIds: string[];
  allNotes: ObsidianNoteRecord[];
  generatedAt: string;
}): Promise<void> {
  if (input.upserts.length === 0 && input.removedPaths.length === 0) return;
  const storedIndex = await loadStoredObsidianSearchIndex();
  const nextIndex = isLocalSearchIndex(storedIndex)
    ? updateLocalSearchIndex(
        storedIndex,
        input.removedFragmentIds,
        obsidianSearchDocuments(input.upserts),
        input.generatedAt,
      )
    : buildObsidianSearchIndex(input.allNotes, input.generatedAt);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [NOTES_STORE, INDEX_STORE],
      'readwrite',
    );
    const done = transactionDone(transaction);
    const notesStore = transaction.objectStore(NOTES_STORE);
    for (const path of input.removedPaths) notesStore.delete(path);
    for (const note of input.upserts) notesStore.put(note);
    transaction.objectStore(INDEX_STORE).put(nextIndex, SEARCH_INDEX_KEY);
    await done;
  } finally {
    database.close();
  }
}

async function saveObsidianSearchIndex(index: LocalSearchIndex): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(INDEX_STORE, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(INDEX_STORE).put(index, SEARCH_INDEX_KEY);
    await done;
  } finally {
    database.close();
  }
}

export async function loadObsidianIndex(
  vaultName: string,
  generatedAt: string,
): Promise<ObsidianIndex | null> {
  const database = await openDatabase();
  let notes: ObsidianNoteRecord[];
  let storedIndex: unknown;
  try {
    const transaction = database.transaction(
      [NOTES_STORE, INDEX_STORE],
      'readonly',
    );
    const done = transactionDone(transaction);
    [notes, storedIndex] = await Promise.all([
      requestResult(transaction.objectStore(NOTES_STORE).getAll()) as Promise<
        ObsidianNoteRecord[]
      >,
      requestResult(transaction.objectStore(INDEX_STORE).get(SEARCH_INDEX_KEY)),
    ]);
    await done;
  } finally {
    database.close();
  }
  if (notes.length === 0) return null;
  const searchIndex = isLocalSearchIndex(storedIndex, generatedAt)
    ? storedIndex
    : buildObsidianSearchIndex(notes, generatedAt);
  if (searchIndex !== storedIndex) {
    await saveObsidianSearchIndex(searchIndex);
  }
  return {
    schemaVersion: 1,
    generatedAt,
    vaultName,
    notes,
    searchIndex,
  };
}

export async function clearObsidianDatabase(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [CONNECTION_STORE, NOTES_STORE, INDEX_STORE],
      'readwrite',
    );
    const done = transactionDone(transaction);
    transaction.objectStore(CONNECTION_STORE).clear();
    transaction.objectStore(NOTES_STORE).clear();
    transaction.objectStore(INDEX_STORE).clear();
    await done;
  } finally {
    database.close();
  }
}
