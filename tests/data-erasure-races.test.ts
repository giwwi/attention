import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginDataOperation,
  commitDataOperation,
  DATA_GENERATION_KEY,
  DataOperationCancelledError,
} from '../src/privacy/data-operations';
import { deleteAllAttentionData } from '../src/privacy/data-erasure';
import { DataTestStorage, installDataLocks } from './helpers/data-locks';

beforeEach(installDataLocks);
afterEach(() => vi.unstubAllGlobals());

describe('erasure across asynchronous extension contexts', () => {
  it.each([
    'readwiseToken',
    'readwiseEvidence',
    'notionAuth',
    'obsidianSettings',
    'browserHistoryEvidence',
    'personalProfile',
  ])('rejects a pending %s commit after erasure', async (key) => {
    const local = new DataTestStorage();
    const session = new DataTestStorage();
    const operation = await beginDataOperation(local.area);
    await deleteAllAttentionData(
      local.area,
      session.area,
      async () => undefined,
    );
    await expect(
      commitDataOperation(
        operation,
        () => local.set({ [key]: 'private' }),
        local.area,
      ),
    ).rejects.toBeInstanceOf(DataOperationCancelledError);
    expect(Object.keys(local.data)).toEqual([DATA_GENERATION_KEY]);
    const fresh = await beginDataOperation(local.area);
    await commitDataOperation(
      fresh,
      () => local.set({ freshImport: true }),
      local.area,
    );
    expect(local.data.freshImport).toBe(true);
  });

  it('waits for an already started storage write and then erases it', async () => {
    const local = new DataTestStorage();
    const operation = await beginDataOperation(local.area);
    let finish!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const write = commitDataOperation(
      operation,
      async () => {
        entered();
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        await local.set({ readwiseToken: 'secret' });
      },
      local.area,
    );
    await started;
    const erase = deleteAllAttentionData(
      local.area,
      new DataTestStorage().area,
      async () => undefined,
    );
    finish();
    await Promise.all([write, erase]);
    expect(Object.keys(local.data)).toEqual([DATA_GENERATION_KEY]);
  });

  it('invalidates work even if a database clear fails', async () => {
    const local = new DataTestStorage();
    const operation = await beginDataOperation(local.area);
    await expect(
      deleteAllAttentionData(
        local.area,
        new DataTestStorage().area,
        async () => {
          throw new Error('database unavailable');
        },
      ),
    ).rejects.toThrow('database unavailable');
    await expect(
      commitDataOperation(
        operation,
        () => local.set({ private: true }),
        local.area,
      ),
    ).rejects.toBeInstanceOf(DataOperationCancelledError);
  });

  it('keeps the generation invalidated while database erasure is waiting', async () => {
    const local = new DataTestStorage();
    const operation = await beginDataOperation(local.area);
    let release!: () => void;
    const erase = deleteAllAttentionData(
      local.area,
      new DataTestStorage().area,
      async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await vi.waitFor(() => {
      expect(release).toBeTypeOf('function');
      expect(local.data[DATA_GENERATION_KEY]).toBeTypeOf('string');
      expect(local.data[DATA_GENERATION_KEY]).not.toBe(operation.generation);
    });
    release();
    await erase;
    await expect(
      commitDataOperation(
        operation,
        () => local.set({ private: true }),
        local.area,
      ),
    ).rejects.toBeInstanceOf(DataOperationCancelledError);
  });
});
