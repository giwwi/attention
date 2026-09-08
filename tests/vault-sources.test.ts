import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDataLocks } from './helpers/data-locks';
import { OBSIDIAN_DATA_KEY, NOTION_DATA_KEY } from '../src/vault/legacy';
import type { ObsidianNoteRecord } from '../src/obsidian/types';
import type { NotionPageRecord } from '../src/notion/types';
import { searchLocalIndex } from '../src/evidence/local-search-index';
import { textTokens } from '../src/analyzer/text-match';

const vault = vi.hoisted(() => ({
  records: {} as Record<string, unknown>,
  locked: false,
  epoch: 'unlock-1',
  listeners: new Set<() => void>(),
  writes: [] as Record<string, unknown>[],
}));

vi.mock('../src/vault/storage', () => {
  class VaultLockedError extends Error {}
  const assertUnlocked = (): void => {
    if (vault.locked) throw new VaultLockedError();
  };
  return {
    VaultLockedError,
    getVaultEpoch: async () => {
      assertUnlocked();
      return vault.epoch;
    },
    onVaultStateChanged: (listener: () => void) => {
      vault.listeners.add(listener);
      return () => vault.listeners.delete(listener);
    },
    privateStorage: {
      get: async (key: string) => {
        assertUnlocked();
        return structuredClone({ [key]: vault.records[key] });
      },
      set: async (records: Record<string, unknown>) => {
        assertUnlocked();
        vault.writes.push(structuredClone(records));
        Object.assign(vault.records, structuredClone(records));
      },
      remove: async (key: string) => {
        assertUnlocked();
        delete vault.records[key];
      },
    },
  };
});

function note(
  path: string,
  text = 'Private research on orbital satellites',
): ObsidianNoteRecord {
  return {
    path,
    title: `Private title ${path}`,
    modifiedAt: 123,
    size: 100,
    fragments: [
      {
        id: `${path}#fragment`,
        notePath: path,
        noteTitle: `Private title ${path}`,
        heading: 'Private heading',
        text,
        tags: ['secret-tag'],
        links: ['secret-link'],
        kind: 'own-note',
        attentionStrength: 1,
        modifiedAt: 123,
      },
    ],
  };
}

function page(
  id: string,
  text = 'Private research on marine biology',
): NotionPageRecord {
  return {
    id,
    title: `Private title ${id}`,
    notionUrl: `https://notion.so/${id}`,
    sourceUrlFingerprint: null,
    editedAt: 123,
    sourceMode: 'own-notes',
    fragments: [
      {
        id: `${id}#fragment`,
        pageId: id,
        pageTitle: `Private title ${id}`,
        heading: 'Private heading',
        text,
        kind: 'own-note',
        attentionStrength: 1,
        editedAt: 123,
      },
    ],
  };
}

beforeEach(() => {
  vi.resetModules();
  vault.records = {};
  vault.locked = false;
  vault.epoch = 'unlock-1';
  vault.listeners.clear();
  vault.writes = [];
  installDataLocks();
  // Source modules must never write their own plaintext storage or IndexedDB.
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(() => {
          throw new Error('Plaintext storage access');
        }),
        set: vi.fn(() => {
          throw new Error('Plaintext storage access');
        }),
      },
    },
  });
  vi.stubGlobal('indexedDB', {
    open: vi.fn(() => {
      throw new Error('Plaintext database access');
    }),
    deleteDatabase: vi.fn(() => {
      throw new Error('Plaintext database access');
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('encrypted source records', () => {
  it('stores complete notes and pages with their search index behind the vault boundary', async () => {
    const obsidian = await import('../src/obsidian/database');
    const notion = await import('../src/notion/database');
    const notes = [note('private/note.md')];
    const pages = [page('private-page')];
    await obsidian.replaceObsidianNotes(notes, 'sync-1');
    await notion.replaceNotionPages(pages, 'sync-1');
    expect(Object.keys(vault.records).sort()).toEqual(
      [NOTION_DATA_KEY, OBSIDIAN_DATA_KEY].sort(),
    );
    expect(await obsidian.loadObsidianNotes()).toEqual(notes);
    expect(await notion.loadNotionPages()).toEqual(pages);
    const obsidianIndex = await obsidian.loadObsidianIndex(
      'Private vault',
      'sync-1',
    );
    const notionIndex = await notion.loadNotionIndex(
      'Private workspace',
      'sync-1',
    );
    expect([
      ...searchLocalIndex(
        obsidianIndex!.searchIndex!,
        textTokens('orbital satellites'),
      ),
    ]).toEqual(['private/note.md#fragment']);
    expect([
      ...searchLocalIndex(
        notionIndex!.searchIndex!,
        textTokens('marine biology'),
      ),
    ]).toEqual(['private-page#fragment']);
    expect(indexedDB.open).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('preserves concurrent note updates from independent extension contexts', async () => {
    const first = await import('../src/obsidian/database');
    await first.replaceObsidianNotes(
      [note('keep.md'), note('delete.md')],
      'sync-1',
    );
    vi.resetModules();
    const second = await import('../src/obsidian/database');
    await Promise.all([
      first.applyObsidianNoteChanges({
        upserts: [note('a.md', 'Astronomical telescopes')],
        removedPaths: ['delete.md'],
        removedFragmentIds: ['delete.md#fragment'],
        allNotes: [],
        generatedAt: 'sync-2',
      }),
      second.applyObsidianNoteChanges({
        upserts: [note('b.md', 'Experimental chemistry')],
        removedPaths: [],
        removedFragmentIds: [],
        allNotes: [],
        generatedAt: 'sync-3',
      }),
    ]);
    expect((await first.loadObsidianNotes()).map(({ path }) => path)).toEqual([
      'a.md',
      'b.md',
      'keep.md',
    ]);
    const index = await first.loadObsidianIndex('Vault', 'sync-3');
    expect(index!.searchIndex!.documentIds.sort()).toEqual([
      'a.md#fragment',
      'b.md#fragment',
      'keep.md#fragment',
    ]);
  });

  it('preserves concurrent page updates and rebuilds an absent legacy index', async () => {
    vault.records[NOTION_DATA_KEY] = { pages: [page('keep'), page('delete')] };
    const first = await import('../src/notion/database');
    vi.resetModules();
    const second = await import('../src/notion/database');
    await Promise.all([
      first.applyNotionPageChanges({
        upserts: [page('a')],
        removedPageIds: ['delete'],
        removedFragmentIds: ['delete#fragment'],
        allPages: [],
        generatedAt: 'sync-2',
      }),
      second.applyNotionPageChanges({
        upserts: [page('b')],
        removedPageIds: [],
        removedFragmentIds: [],
        allPages: [],
        generatedAt: 'sync-3',
      }),
    ]);
    expect((await first.loadNotionPages()).map(({ id }) => id)).toEqual([
      'a',
      'b',
      'keep',
    ]);
    const index = await first.loadNotionIndex('Workspace', 'sync-3');
    expect(index!.searchIndex!.documentIds.sort()).toEqual([
      'a#fragment',
      'b#fragment',
      'keep#fragment',
    ]);
  });

  it('fails closed for reads, changes, and deletion while locked', async () => {
    const obsidian = await import('../src/obsidian/database');
    const notion = await import('../src/notion/database');
    const { VaultLockedError } = await import('../src/vault/storage');
    vault.locked = true;
    for (const action of [
      () => obsidian.loadObsidianNotes(),
      () => notion.loadNotionPages(),
      () => obsidian.replaceObsidianNotes([note('secret.md')], 'sync'),
      () => notion.replaceNotionPages([page('secret')], 'sync'),
      () => obsidian.clearObsidianDatabase(),
      () => notion.clearNotionDatabase(),
      () =>
        obsidian.applyObsidianNoteChanges({
          upserts: [],
          removedPaths: [],
          removedFragmentIds: [],
          allNotes: [],
          generatedAt: 'sync',
        }),
      () =>
        notion.applyNotionPageChanges({
          upserts: [],
          removedPageIds: [],
          removedFragmentIds: [],
          allPages: [],
          generatedAt: 'sync',
        }),
    ])
      await expect(action()).rejects.toBeInstanceOf(VaultLockedError);
    expect(vault.records).toEqual({});
    expect(indexedDB.open).not.toHaveBeenCalled();
  });

  it('removes fragment ids from the current record even when a caller has an older snapshot', async () => {
    const obsidian = await import('../src/obsidian/database');
    const notion = await import('../src/notion/database');
    const oldNote = note('same.md');
    const oldPage = page('same');
    oldNote.fragments[0]!.id = 'intermediate-note-fragment';
    oldPage.fragments[0]!.id = 'intermediate-page-fragment';
    await obsidian.replaceObsidianNotes([oldNote], 'sync-1');
    await notion.replaceNotionPages([oldPage], 'sync-1');
    await obsidian.applyObsidianNoteChanges({
      upserts: [note('same.md')],
      removedPaths: [],
      removedFragmentIds: ['older-note-fragment'],
      allNotes: [],
      generatedAt: 'sync-2',
    });
    await notion.applyNotionPageChanges({
      upserts: [page('same')],
      removedPageIds: [],
      removedFragmentIds: ['older-page-fragment'],
      allPages: [],
      generatedAt: 'sync-2',
    });
    expect(
      (await obsidian.loadObsidianIndex('Vault', 'sync-2'))!.searchIndex!
        .documentIds,
    ).toEqual(['same.md#fragment']);
    expect(
      (await notion.loadNotionIndex('Workspace', 'sync-2'))!.searchIndex!
        .documentIds,
    ).toEqual(['same#fragment']);
  });

  it('keeps directory handles only in memory and clears them on lock, reset, and a new session', async () => {
    const obsidian = await import('../src/obsidian/database');
    const handle = {
      name: 'Private vault',
      kind: 'directory',
    } as import('../src/obsidian/database').PersistedDirectoryHandle;
    await obsidian.saveVaultHandle(handle);
    expect(await obsidian.loadVaultHandle()).toBe(handle);
    expect(vault.writes).toEqual([]);
    for (const listener of vault.listeners) listener();
    expect(await obsidian.loadVaultHandle()).toBeNull();
    await obsidian.saveVaultHandle(handle);
    vault.epoch = 'unlock-2';
    expect(await obsidian.loadVaultHandle()).toBeNull();
    await obsidian.saveVaultHandle(handle);
    vi.resetModules();
    expect(
      await (await import('../src/obsidian/database')).loadVaultHandle(),
    ).toBeNull();
    await obsidian.clearObsidianDatabase();
    expect(await obsidian.loadVaultHandle()).toBeNull();
  });
});
