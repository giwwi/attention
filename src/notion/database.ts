import type { NotionIndex, NotionPageRecord } from './types';
import {
  buildLocalSearchIndex,
  isLocalSearchIndex,
  updateLocalSearchIndex,
  type LocalSearchDocument,
  type LocalSearchIndex,
} from '../evidence/local-search-index';

const DATABASE_NAME = 'attention-notion-v1';
const DATABASE_VERSION = 2;
const PAGES_STORE = 'pages';
const INDEX_STORE = 'search-index';
const SEARCH_INDEX_KEY = 'fragments';

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
    if (!database.objectStoreNames.contains(PAGES_STORE)) {
      database.createObjectStore(PAGES_STORE, { keyPath: 'id' });
    }
    if (!database.objectStoreNames.contains(INDEX_STORE)) {
      database.createObjectStore(INDEX_STORE);
    }
  });
  return requestResult(request);
}

export async function loadNotionPages(): Promise<NotionPageRecord[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PAGES_STORE, 'readonly');
    const done = transactionDone(transaction);
    const pages = await requestResult(
      transaction.objectStore(PAGES_STORE).getAll(),
    );
    await done;
    return pages as NotionPageRecord[];
  } finally {
    database.close();
  }
}

export async function replaceNotionPages(
  pages: NotionPageRecord[],
  generatedAt: string,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [PAGES_STORE, INDEX_STORE],
      'readwrite',
    );
    const done = transactionDone(transaction);
    const store = transaction.objectStore(PAGES_STORE);
    store.clear();
    for (const page of pages) store.put(page);
    transaction
      .objectStore(INDEX_STORE)
      .put(buildNotionSearchIndex(pages, generatedAt), SEARCH_INDEX_KEY);
    await done;
  } finally {
    database.close();
  }
}

function buildNotionSearchIndex(
  pages: NotionPageRecord[],
  generatedAt: string,
): LocalSearchIndex {
  return buildLocalSearchIndex(notionSearchDocuments(pages), generatedAt);
}

function notionSearchDocuments(
  pages: NotionPageRecord[],
): LocalSearchDocument[] {
  return pages.flatMap((page) =>
    page.fragments.map((fragment) => ({
      id: fragment.id,
      text: [page.title, fragment.heading ?? '', fragment.text].join(' '),
    })),
  );
}

async function loadStoredNotionSearchIndex(): Promise<unknown> {
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

export async function applyNotionPageChanges(input: {
  upserts: NotionPageRecord[];
  removedPageIds: string[];
  removedFragmentIds: string[];
  allPages: NotionPageRecord[];
  generatedAt: string;
}): Promise<void> {
  if (input.upserts.length === 0 && input.removedPageIds.length === 0) return;
  const storedIndex = await loadStoredNotionSearchIndex();
  const nextIndex = isLocalSearchIndex(storedIndex)
    ? updateLocalSearchIndex(
        storedIndex,
        input.removedFragmentIds,
        notionSearchDocuments(input.upserts),
        input.generatedAt,
      )
    : buildNotionSearchIndex(input.allPages, input.generatedAt);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [PAGES_STORE, INDEX_STORE],
      'readwrite',
    );
    const done = transactionDone(transaction);
    const pagesStore = transaction.objectStore(PAGES_STORE);
    for (const id of input.removedPageIds) pagesStore.delete(id);
    for (const page of input.upserts) pagesStore.put(page);
    transaction.objectStore(INDEX_STORE).put(nextIndex, SEARCH_INDEX_KEY);
    await done;
  } finally {
    database.close();
  }
}

async function saveNotionSearchIndex(index: LocalSearchIndex): Promise<void> {
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

export async function loadNotionIndex(
  workspaceName: string,
  generatedAt: string,
): Promise<NotionIndex | null> {
  const database = await openDatabase();
  let pages: NotionPageRecord[];
  let storedIndex: unknown;
  try {
    const transaction = database.transaction(
      [PAGES_STORE, INDEX_STORE],
      'readonly',
    );
    const done = transactionDone(transaction);
    [pages, storedIndex] = await Promise.all([
      requestResult(transaction.objectStore(PAGES_STORE).getAll()) as Promise<
        NotionPageRecord[]
      >,
      requestResult(transaction.objectStore(INDEX_STORE).get(SEARCH_INDEX_KEY)),
    ]);
    await done;
  } finally {
    database.close();
  }
  if (pages.length === 0) return null;
  const searchIndex = isLocalSearchIndex(storedIndex, generatedAt)
    ? storedIndex
    : buildNotionSearchIndex(pages, generatedAt);
  if (searchIndex !== storedIndex) await saveNotionSearchIndex(searchIndex);
  return {
    schemaVersion: 1,
    generatedAt,
    workspaceName,
    pages,
    searchIndex,
  };
}

export async function clearNotionDatabase(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [PAGES_STORE, INDEX_STORE],
      'readwrite',
    );
    const done = transactionDone(transaction);
    transaction.objectStore(PAGES_STORE).clear();
    transaction.objectStore(INDEX_STORE).clear();
    await done;
  } finally {
    database.close();
  }
}
