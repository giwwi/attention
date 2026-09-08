import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTestStorage, installDataLocks } from './helpers/data-locks';
import { deleteAllAttentionData } from '../src/privacy/data-erasure';
import {
  DataOperationCancelledError,
  DATA_GENERATION_KEY,
} from '../src/privacy/data-operations';
import { indexObsidianVault } from '../src/obsidian/indexer';
import { syncNotionWorkspace } from '../src/notion/indexer';
import type { PersistedDirectoryHandle } from '../src/obsidian/database';
import type { NotionApiClient } from '../src/notion/client';

const writes = vi.hoisted(() => ({
  obsidian: vi.fn(),
  notion: vi.fn(),
  handle: vi.fn(),
}));
vi.mock('../src/obsidian/database', () => ({
  loadObsidianNotes: async () => [],
  loadVaultHandle: async () => null,
  applyObsidianNoteChanges: writes.obsidian,
  saveVaultHandle: writes.handle,
  clearObsidianDatabase: async () => undefined,
}));
vi.mock('../src/notion/database', () => ({
  loadNotionPages: async () => [],
  applyNotionPageChanges: writes.notion,
  clearNotionDatabase: async () => undefined,
}));

let local: DataTestStorage;
beforeEach(() => {
  installDataLocks();
  local = new DataTestStorage();
  vi.stubGlobal('chrome', {
    storage: { local, session: new DataTestStorage() },
  });
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve: () => resolve(),
  };
}

describe('connector work completing after erasure', () => {
  it('cancels Obsidian after reading a file and cannot restore its vault handle', async () => {
    const reading = deferred();
    const finish = deferred();
    const handle = {
      name: 'Private vault',
      async *entries() {
        yield [
          'private.md',
          {
            kind: 'file',
            getFile: async () => ({
              size: 200,
              lastModified: 1,
              text: async () => {
                reading.resolve();
                await finish.promise;
                return 'A private note containing personal knowledge that must not be restored after the user has erased all Attention data.';
              },
            }),
          },
        ];
      },
    } as unknown as PersistedDirectoryHandle;
    const indexing = indexObsidianVault(handle);
    const result = expect(indexing).rejects.toBeInstanceOf(
      DataOperationCancelledError,
    );
    await reading.promise;
    await deleteAllAttentionData();
    finish.resolve();
    await result;
    expect(writes.obsidian).not.toHaveBeenCalled();
    expect(writes.handle).not.toHaveBeenCalled();
    expect(Object.keys(local.data)).toEqual([DATA_GENERATION_KEY]);
  });

  it('cancels Notion after an outstanding markdown response', async () => {
    const reading = deferred();
    const finish = deferred();
    const auth = {
      accessToken: 'test-only-notion-token',
      refreshToken: null,
      workspaceId: 'workspace',
      workspaceName: 'Private workspace',
      botId: 'bot',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const client = {
      currentAuth: auth,
      searchPages: async () => ({
        pages: [
          {
            id: 'page',
            url: 'https://notion.so/page',
            last_edited_time: auth.updatedAt,
          },
        ],
        paginationComplete: true,
      }),
      pageMarkdown: async () => {
        reading.resolve();
        await finish.promise;
        return {
          markdown:
            'A private Notion paragraph containing enough meaningful text to create an indexed fragment after this request completes.',
        };
      },
    } as unknown as NotionApiClient;
    const indexing = syncNotionWorkspace({ auth, sourceMode: 'mixed', client });
    const result = expect(indexing).rejects.toBeInstanceOf(
      DataOperationCancelledError,
    );
    await reading.promise;
    await deleteAllAttentionData();
    finish.resolve();
    await result;
    expect(writes.notion).not.toHaveBeenCalled();
    expect(Object.keys(local.data)).toEqual([DATA_GENERATION_KEY]);
  });
});
