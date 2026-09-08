import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLegacyDatabases,
  readLegacyDatabases,
  OBSIDIAN_DATA_KEY,
  NOTION_DATA_KEY,
} from '../src/vault/legacy';

class LegacyRequest<T> extends EventTarget {
  result!: T;
  error: DOMException | null = null;
  transaction?: { abort: () => void };
}

class LegacyTransaction extends EventTarget {
  complete = false;
  error: DOMException | null = null;
  readonly accessed: string[] = [];

  constructor(private readonly database: LegacyDatabase) {
    super();
    setTimeout(() => {
      this.complete = true;
      if (database.abortRead) {
        this.error = new DOMException('Read aborted', 'AbortError');
        this.dispatchEvent(new Event('abort'));
      } else this.dispatchEvent(new Event('complete'));
    }, 0);
  }

  objectStore(name: string): {
    getAll: () => LegacyRequest<unknown[]>;
    get: (key: string) => LegacyRequest<unknown>;
  } {
    this.accessed.push(name);
    if (name === 'connection')
      throw new Error('Directory handles must never be read.');
    const store = this.database.stores[name];
    if (!store) throw new Error('Unknown object store');
    const read = <T>(value: T): LegacyRequest<T> => {
      const request = new LegacyRequest<T>();
      queueMicrotask(() => {
        request.result = structuredClone(value);
        request.dispatchEvent(new Event('success'));
      });
      return request;
    };
    return {
      getAll: () => read([...store.values()]),
      get: (key) => read(store.get(key)),
    };
  }
}

class LegacyDatabase extends EventTarget {
  closed = false;
  closedBeforeTransactionCompleted = false;
  abortRead = false;
  readonly transactions: LegacyTransaction[] = [];
  readonly transactionModes: string[] = [];
  readonly objectStoreNames = {
    contains: (name: string) => name in this.stores,
  };

  constructor(
    readonly stores: Record<string, Map<string, unknown>>,
    readonly version = 2,
  ) {
    super();
  }

  transaction(_names: string[], mode: string): LegacyTransaction {
    this.transactionModes.push(mode);
    const transaction = new LegacyTransaction(this);
    this.transactions.push(transaction);
    return transaction;
  }

  close(): void {
    this.closed = true;
    this.closedBeforeTransactionCompleted = this.transactions.some(
      (transaction) => !transaction.complete,
    );
  }
}

const OBSIDIAN_DB = 'attention-obsidian-v1';
const NOTION_DB = 'attention-notion-v1';

let databases: Map<string, LegacyDatabase>;
let discoveryError: Error | undefined;
let blockedOpen: string | undefined;
let blockedDelete: string | undefined;
let failedOpen: string | undefined;
let missingAfterDiscovery: string | undefined;
let recreationAbort: ReturnType<typeof vi.fn>;
let factory: {
  databases: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  deleteDatabase: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  databases = new Map();
  discoveryError = undefined;
  blockedOpen = undefined;
  blockedDelete = undefined;
  failedOpen = undefined;
  missingAfterDiscovery = undefined;
  recreationAbort = vi.fn();
  factory = {
    databases: vi.fn(async () => {
      if (discoveryError) throw discoveryError;
      return [
        ...databases.keys(),
        ...(missingAfterDiscovery ? [missingAfterDiscovery] : []),
      ].map((name) => ({ name }));
    }),
    open: vi.fn((name: string) => {
      const request = new LegacyRequest<LegacyDatabase>();
      queueMicrotask(() => {
        if (name === blockedOpen) {
          request.dispatchEvent(new Event('blocked'));
          return;
        }
        if (name === failedOpen) {
          request.error = new DOMException(
            'Cannot open legacy database',
            'UnknownError',
          );
          request.dispatchEvent(new Event('error'));
          return;
        }
        const database = databases.get(name);
        if (!database) {
          request.transaction = { abort: recreationAbort };
          request.dispatchEvent(new Event('upgradeneeded'));
          return;
        }
        request.result = database;
        request.dispatchEvent(new Event('success'));
      });
      return request;
    }),
    deleteDatabase: vi.fn((name: string) => {
      const request = new LegacyRequest<undefined>();
      queueMicrotask(() => {
        if (name === blockedDelete) {
          request.dispatchEvent(new Event('blocked'));
          return;
        }
        databases.delete(name);
        request.dispatchEvent(new Event('success'));
      });
      return request;
    }),
  };
  vi.stubGlobal('indexedDB', factory);
});
afterEach(() => vi.unstubAllGlobals());

describe('legacy source migration', () => {
  it('reads all note/page fields and indices without reading handles or deleting plaintext', async () => {
    const note = {
      path: 'Private folder/Research.md',
      title: 'Private note title',
      modifiedAt: 123,
      size: 456,
      fragments: [
        {
          id: 'note-fragment',
          text: 'Confidential note text',
          heading: 'Personal heading',
          tags: ['private-tag'],
          links: ['private-link'],
        },
      ],
    };
    const page = {
      id: 'private-page-id',
      title: 'Private page title',
      notionUrl: 'https://notion.so/private-page-id',
      fragments: [{ id: 'page-fragment', text: 'Confidential page text' }],
    };
    const noteIndex = {
      schemaVersion: 2,
      postings: { confidential: ['note-fragment'] },
    };
    const pageIndex = {
      schemaVersion: 2,
      postings: { confidential: ['page-fragment'] },
    };
    const obsidian = new LegacyDatabase({
      notes: new Map([[note.path, note]]),
      'search-index': new Map([['fragments', noteIndex]]),
      connection: new Map([['vault', { secretDirectoryHandle: true }]]),
    });
    const notion = new LegacyDatabase({
      pages: new Map([[page.id, page]]),
      'search-index': new Map([['fragments', pageIndex]]),
    });
    databases.set(OBSIDIAN_DB, obsidian);
    databases.set(NOTION_DB, notion);

    expect(await readLegacyDatabases()).toEqual({
      [OBSIDIAN_DATA_KEY]: { notes: [note], searchIndex: noteIndex },
      [NOTION_DATA_KEY]: { pages: [page], searchIndex: pageIndex },
    });
    expect(factory.open.mock.calls).toEqual([[OBSIDIAN_DB], [NOTION_DB]]);
    for (const database of [obsidian, notion]) {
      expect(database.closed).toBe(true);
      expect(database.closedBeforeTransactionCompleted).toBe(false);
      expect(database.transactionModes).toEqual(['readonly']);
    }
    expect(factory.deleteDatabase).not.toHaveBeenCalled();
    expect(obsidian.stores.connection!.get('vault')).toEqual({
      secretDirectoryHandle: true,
    });
  });

  it('supports version-one records without upgrading or inventing an index', async () => {
    databases.set(
      OBSIDIAN_DB,
      new LegacyDatabase(
        {
          notes: new Map([
            ['old.md', { path: 'old.md', title: 'Legacy private title' }],
          ]),
        },
        1,
      ),
    );
    expect(await readLegacyDatabases()).toEqual({
      [OBSIDIAN_DATA_KEY]: {
        notes: [{ path: 'old.md', title: 'Legacy private title' }],
      },
    });
    expect(factory.open).toHaveBeenCalledWith(OBSIDIAN_DB);
  });

  it('does not create databases when no legacy data exists', async () => {
    expect(await readLegacyDatabases()).toEqual({});
    await clearLegacyDatabases();
    expect(factory.open).not.toHaveBeenCalled();
    expect(factory.deleteDatabase).not.toHaveBeenCalled();
  });

  it('rejects failed discovery rather than interpreting it as no data', async () => {
    discoveryError = new Error('Discovery denied');
    await expect(readLegacyDatabases()).rejects.toThrow('Discovery denied');
    await expect(clearLegacyDatabases()).rejects.toThrow('Discovery denied');
    expect(factory.open).not.toHaveBeenCalled();
    expect(factory.deleteDatabase).not.toHaveBeenCalled();
  });

  it('aborts accidental recreation when a discovered database disappears', async () => {
    missingAfterDiscovery = OBSIDIAN_DB;
    await expect(readLegacyDatabases()).rejects.toThrow(
      'changed during migration',
    );
    expect(recreationAbort).toHaveBeenCalledOnce();
    expect(databases.size).toBe(0);
  });

  it('rejects unknown database versions and closes the connection', async () => {
    const database = new LegacyDatabase({ notes: new Map() }, 3);
    databases.set(OBSIDIAN_DB, database);
    await expect(readLegacyDatabases()).rejects.toThrow(
      'Unsupported legacy database version',
    );
    expect(database.closed).toBe(true);
    expect(factory.deleteDatabase).not.toHaveBeenCalled();
  });

  it('rejects missing source stores instead of dropping their data during migration', async () => {
    const database = new LegacyDatabase({ connection: new Map() });
    databases.set(OBSIDIAN_DB, database);
    await expect(readLegacyDatabases()).rejects.toThrow(
      'missing its records store',
    );
    expect(database.closed).toBe(true);
    expect(factory.deleteDatabase).not.toHaveBeenCalled();
  });

  it('propagates blocked and failed database opens', async () => {
    databases.set(NOTION_DB, new LegacyDatabase({ pages: new Map() }));
    blockedOpen = NOTION_DB;
    await expect(readLegacyDatabases()).rejects.toThrow(
      'Close other Attention pages',
    );
    blockedOpen = undefined;
    failedOpen = NOTION_DB;
    await expect(readLegacyDatabases()).rejects.toThrow(
      'Cannot open legacy database',
    );
    expect(factory.deleteDatabase).not.toHaveBeenCalled();
  });

  it('requires transaction completion before returning a migration snapshot', async () => {
    const database = new LegacyDatabase({
      pages: new Map([['page', { title: 'Private' }]]),
    });
    database.abortRead = true;
    databases.set(NOTION_DB, database);
    await expect(readLegacyDatabases()).rejects.toThrow('Read aborted');
    expect(database.closed).toBe(true);
    expect(database.closedBeforeTransactionCompleted).toBe(false);
    expect(factory.deleteDatabase).not.toHaveBeenCalled();
  });

  it('deletes source databases including handles only when cleanup is explicitly called, and can retry', async () => {
    databases.set(
      OBSIDIAN_DB,
      new LegacyDatabase({
        notes: new Map(),
        connection: new Map([['vault', 'handle']]),
      }),
    );
    databases.set(NOTION_DB, new LegacyDatabase({ pages: new Map() }));
    blockedDelete = NOTION_DB;
    await expect(clearLegacyDatabases()).rejects.toThrow(
      'Close other Attention pages',
    );
    expect(databases.has(OBSIDIAN_DB)).toBe(false);
    expect(databases.has(NOTION_DB)).toBe(true);
    blockedDelete = undefined;
    await clearLegacyDatabases();
    await clearLegacyDatabases();
    expect(databases.size).toBe(0);
    expect(factory.open).not.toHaveBeenCalled();
  });
});
