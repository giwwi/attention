import { afterEach, expect, it, vi } from 'vitest';
import {
  buildReadwiseEvidence,
  READWISE_EVIDENCE_KEY,
} from '../src/readwise/evidence';
import { loadReadwiseEvidence } from '../src/readwise/storage';
import { deleteAllAttentionData } from '../src/privacy/data-erasure';
import { DATA_GENERATION_KEY } from '../src/privacy/data-operations';
import { DataTestStorage, installDataLocks } from './helpers/data-locks';

afterEach(() => vi.unstubAllGlobals());

it('does not restore a legacy Readwise library when a migration read finishes after deletion', async () => {
  installDataLocks();
  const local = new DataTestStorage();
  const evidence: Record<string, unknown> = {
    ...(await buildReadwiseEvidence([
      {
        user_book_id: 1,
        title: 'Private source',
        highlights: [
          {
            id: 1,
            text: 'A private highlighted statement from the user library.',
          },
        ],
      },
    ])),
  };
  delete evidence.searchIndex;
  await local.set({ [READWISE_EVIDENCE_KEY]: evidence });
  const originalGet = local.get.bind(local);
  let started!: () => void;
  let finish!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  local.get = async (keys) => {
    const snapshot = await originalGet(keys);
    if (keys === READWISE_EVIDENCE_KEY) {
      started();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }
    return snapshot;
  };
  vi.stubGlobal('chrome', {
    storage: { local, session: new DataTestStorage() },
  });
  const load = loadReadwiseEvidence();
  await reading;
  await deleteAllAttentionData(
    local.area,
    new DataTestStorage().area,
    async () => undefined,
  );
  finish();
  expect((await load)?.searchIndex).toBeDefined();
  expect(Object.keys(local.data)).toEqual([DATA_GENERATION_KEY]);
});
