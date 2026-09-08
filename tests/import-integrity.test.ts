import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexObsidianVault } from '../src/obsidian/indexer';
import type { PersistedDirectoryHandle } from '../src/obsidian/database';
import type { ObsidianNoteRecord } from '../src/obsidian/types';
import { syncNotionWorkspace } from '../src/notion/indexer';
import type { NotionApiClient, NotionApiPage } from '../src/notion/client';
import {
  EMPTY_NOTION_SETTINGS,
  NOTION_SETTINGS_KEY,
  type NotionPageRecord,
} from '../src/notion/types';
import {
  beginSyncOperation,
  cancelSyncOperation,
  DataOperationCancelledError,
} from '../src/privacy/data-operations';
import { DataTestStorage, installDataLocks } from './helpers/data-locks';

const db = vi.hoisted(() => ({
  notes: [] as ObsidianNoteRecord[],
  handle: null as PersistedDirectoryHandle | null,
  pages: [] as NotionPageRecord[],
  obsidian: vi.fn(),
  notion: vi.fn(),
}));
vi.mock('../src/obsidian/database', () => ({
  loadVaultHandle: async () => db.handle,
  loadObsidianNotes: async () => db.notes,
  applyObsidianNoteChanges: async (input: {
    allNotes: ObsidianNoteRecord[];
    vaultHandle: PersistedDirectoryHandle;
  }) => {
    db.obsidian(input);
    db.notes = input.allNotes;
    db.handle = input.vaultHandle;
  },
}));
vi.mock('../src/notion/database', () => ({
  loadNotionPages: async () => db.pages,
  applyNotionPageChanges: async (input: { allPages: NotionPageRecord[] }) => {
    db.notion(input);
    db.pages = input.allPages;
  },
}));
let local: DataTestStorage;
beforeEach(() => {
  installDataLocks();
  local = new DataTestStorage();
  vi.stubGlobal('chrome', {
    storage: { local, session: new DataTestStorage() },
  });
  db.notes = [];
  db.pages = [];
  db.handle = null;
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

function vault(identity: string, text: string) {
  const read = vi.fn(async () => text);
  const handle = {
    name: 'Same vault name',
    identity,
    isSameEntry: async (other: { identity: string }) =>
      identity === other.identity,
    async *entries() {
      yield [
        'same.md',
        {
          kind: 'file',
          getFile: async () => ({ size: 200, lastModified: 7, text: read }),
        },
      ];
    },
  } as unknown as PersistedDirectoryHandle;
  return { handle, read };
}

describe('Obsidian vault identity', () => {
  it('rebuilds equal path, size and modification time when the selected directory changes', async () => {
    const a = vault(
      'a',
      'The first vault explains distributed cache consistency and contains a distinct first-vault-only conclusion.',
    );
    const b = vault(
      'b',
      'The other vault explains historical research methods and contains a distinct second-vault-only conclusion.',
    );
    await indexObsidianVault(a.handle);
    const result = await indexObsidianVault(b.handle);
    expect(result.reusedNoteCount).toBe(0);
    expect(b.read).toHaveBeenCalledOnce();
    expect(JSON.stringify(db.notes)).toContain('second-vault-only');
    expect(JSON.stringify(db.notes)).not.toContain('first-vault-only');
    expect(db.handle).toBe(b.handle);
  });
  it('still reuses metadata when isSameEntry confirms the directory identity', async () => {
    const first = vault(
      'a',
      'A substantial useful note describes database durability and isolation in sufficient detail to index its contents.',
    );
    const reopened = vault('a', 'This content is intentionally never read.');
    await indexObsidianVault(first.handle);
    const result = await indexObsidianVault(reopened.handle);
    expect(result.reusedNoteCount).toBe(1);
    expect(reopened.read).not.toHaveBeenCalled();
  });
  it('drops the old vault result when another context disconnects during file reading', async () => {
    let release!: () => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const source = vault('a', '');
    source.read.mockImplementation(async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return 'A meaningful note that must never be restored after disconnecting the pending vault operation.';
    });
    const pending = indexObsidianVault(source.handle);
    const rejected = expect(pending).rejects.toBeInstanceOf(
      DataOperationCancelledError,
    );
    await reading;
    await cancelSyncOperation('obsidian', async () => {
      db.notes = [];
      db.handle = null;
    });
    release();
    await rejected;
    expect(db.obsidian).not.toHaveBeenCalled();
    expect(db.handle).toBeNull();
  });
});

const auth = {
  accessToken: 'test-only-notion-access-token',
  refreshToken: null,
  botId: 'bot',
  workspaceId: 'workspace',
  workspaceName: 'Test workspace',
  updatedAt: '2026-09-01T00:00:00Z',
};
function savedPage(id: string): NotionPageRecord {
  return {
    id,
    title: id,
    notionUrl: `https://notion.so/${id}`,
    sourceUrlFingerprint: null,
    editedAt: Date.parse(auth.updatedAt),
    sourceMode: 'mixed',
    fragments: [
      {
        id: `${id}:0`,
        pageId: id,
        pageTitle: id,
        heading: null,
        text: `Existing page ${id} explains a meaningful statement worth keeping in the knowledge index.`,
        kind: 'own-note',
        attentionStrength: 0.88,
        editedAt: Date.parse(auth.updatedAt),
      },
    ],
  };
}
function remotePage(id: string): NotionApiPage {
  return {
    id,
    url: `https://notion.so/${id}`,
    last_edited_time: auth.updatedAt,
  };
}
async function seedNotion(pages: NotionPageRecord[]): Promise<void> {
  db.pages = pages;
  await local.set({
    [NOTION_SETTINGS_KEY]: {
      ...EMPTY_NOTION_SETTINGS,
      connected: true,
      workspaceId: auth.workspaceId,
      workspaceName: auth.workspaceName,
      lastSyncedAt: auth.updatedAt,
      pageCount: pages.length,
    },
  });
}
function client(
  pages: NotionApiPage[],
  paginationComplete = true,
  overrides: Record<string, unknown> = {},
): NotionApiClient {
  return {
    currentAuth: auth,
    searchPages: async () => ({ pages, paginationComplete }),
    retrievePage: async (id: string) => remotePage(id),
    pageMarkdown: async () => ({
      markdown:
        'A newly indexed Notion page contains a substantive explanation of a distinct and useful research finding.',
    }),
    ...overrides,
  } as unknown as NotionApiClient;
}

describe('Notion partial synchronization', () => {
  it('retains the 301st cached page when search reaches its 300-page cap', async () => {
    await seedNotion(
      Array.from({ length: 301 }, (_, index) => savedPage(`page-${index}`)),
    );
    const result = await syncNotionWorkspace({
      auth,
      sourceMode: 'mixed',
      client: client(
        Array.from({ length: 300 }, (_, index) => remotePage(`page-${index}`)),
        false,
      ),
    });
    expect(result.settings.pageCount).toBe(301);
    expect(result.settings.syncComplete).toBe(false);
    expect(db.notion.mock.calls[0]![0].removedPageIds).toEqual([]);
    expect(db.pages.some((page) => page.id === 'page-300')).toBe(true);
  });
  it('verifies absent search results and deletes only confirmed inaccessible pages', async () => {
    await seedNotion([savedPage('keep'), savedPage('gone')]);
    const retrievePage = vi.fn(async (id: string) => {
      if (id === 'gone')
        throw Object.assign(new Error('object_not_found'), {
          code: 'object_not_found',
        });
      return remotePage(id);
    });
    await syncNotionWorkspace({
      auth,
      sourceMode: 'mixed',
      client: client([], true, { retrievePage }),
    });
    expect(retrievePage).toHaveBeenCalledTimes(2);
    expect(db.pages.map((page) => page.id)).toEqual(['keep']);
    expect(db.notion.mock.calls[0]![0].removedPageIds).toEqual(['gone']);
  });
  it('preserves the previous page when its changed markdown is truncated', async () => {
    await seedNotion([savedPage('page')]);
    const remote = {
      ...remotePage('page'),
      last_edited_time: '2026-09-02T00:00:00Z',
    };
    const result = await syncNotionWorkspace({
      auth,
      sourceMode: 'mixed',
      client: client([remote], true, {
        pageMarkdown: async () => ({
          markdown: 'Only a partial replacement.',
          truncated: true,
        }),
      }),
    });
    expect(db.pages[0]!.fragments[0]!.text).toContain('Existing page');
    expect(result.settings.syncComplete).toBe(false);
    expect(result.settings.excludedPageCount).toBe(1);
  });
  it('does not merge a former workspace into a partial replacement workspace', async () => {
    await seedNotion([savedPage('former-page')]);
    const different = { ...auth, workspaceId: 'new-workspace' };
    await syncNotionWorkspace({
      auth: different,
      sourceMode: 'mixed',
      client: client([remotePage('new-page')], false, {
        currentAuth: different,
      }),
    });
    expect(db.pages.map((page) => page.id)).toEqual(['new-page']);
  });
  it('rejects a delayed Notion sync after a replacement sync owns the source', async () => {
    await seedNotion([]);
    let release!: () => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = syncNotionWorkspace({
      auth,
      sourceMode: 'mixed',
      client: client([remotePage('old')], true, {
        pageMarkdown: async () => {
          started();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return {
            markdown:
              'An older pending page contains a meaningful statement but must not overwrite the replacement sync.',
          };
        },
      }),
    });
    const rejected = expect(pending).rejects.toBeInstanceOf(
      DataOperationCancelledError,
    );
    await reading;
    const replacement = await beginSyncOperation('notion');
    await syncNotionWorkspace({
      auth,
      sourceMode: 'mixed',
      client: client([remotePage('new')]),
      operation: replacement,
    });
    release();
    await rejected;
    expect(db.pages.map((page) => page.id)).toEqual(['new']);
  });
});
