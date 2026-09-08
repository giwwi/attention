import { afterEach, expect, it, vi } from 'vitest';
import {
  loadUtilityCalibration,
  loadUtilityFeedback,
  UTILITY_FEEDBACK_KEY,
} from '../src/utility/storage';
import { deleteAllAttentionData } from '../src/privacy/data-erasure';
import { DATA_GENERATION_KEY } from '../src/privacy/data-operations';
import { DataTestStorage, installDataLocks } from './helpers/data-locks';

afterEach(() => vi.unstubAllGlobals());

it.each([loadUtilityFeedback, loadUtilityCalibration])(
  'does not restore legacy utility data after an outstanding read completes',
  async (load) => {
    installDataLocks();
    const local = new DataTestStorage();
    await local.set({
      [UTILITY_FEEDBACK_KEY]: [
        {
          id: 'feedback',
          sessionId: 'session',
          url: 'https://private.example/article',
          title: 'Private article',
          predictedUtility: 60,
          actualUtility: 80,
          components: {
            relevance: 60,
            novelty: 60,
            actionability: 60,
            quality: 60,
          },
          evaluatedAt: '2026-08-27T08:00:00.000Z',
          recordedAt: '2026-08-27T08:05:00.000Z',
        },
      ],
    });
    const get = local.get.bind(local);
    let started!: () => void;
    let finish!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    local.get = async (keys) => {
      const snapshot = await get(keys);
      if (keys === UTILITY_FEEDBACK_KEY) {
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
    const result = load(local.area);
    await reading;
    await deleteAllAttentionData(
      local.area,
      new DataTestStorage().area,
      async () => undefined,
    );
    finish();
    const loaded = await result;
    if (load === loadUtilityCalibration) expect(loaded).toBeNull();
    else expect(loaded).toBeTruthy();
    expect(Object.keys(local.data)).toEqual([DATA_GENERATION_KEY]);
  },
);
