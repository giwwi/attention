import { privateStorage, getVaultEpoch } from '../vault/storage';
import {
  DATA_GENERATION_KEY,
  commitDataOperation,
  withAttentionDataLock,
  type DataOperation,
} from '../privacy/data-operations';
import {
  PILOT_PROTOCOL_VERSION,
  PILOT_STORAGE_KEY,
  PILOT_TRIAL_LIMIT,
  type PilotState,
  type PilotTrial,
} from './model';

export async function loadPilot(
  storage: chrome.storage.StorageArea = privateStorage,
): Promise<PilotState | null> {
  const value = (await storage.get(PILOT_STORAGE_KEY))[PILOT_STORAGE_KEY] as
    PilotState | undefined;
  return value?.schemaVersion === 1 &&
    value.protocolVersion === PILOT_PROTOCOL_VERSION &&
    Array.isArray(value.trials)
    ? value
    : null;
}

/** Explicit consent is required even if an earlier local pilot exists. */
export async function enrollPilot(
  consent: boolean,
  storage: chrome.storage.StorageArea = privateStorage,
): Promise<{ state: PilotState; operation: DataOperation }> {
  if (!consent) throw new Error('Consent required');
  return withAttentionDataLock(async () => {
    const generation = (await storage.get(DATA_GENERATION_KEY))[
      DATA_GENERATION_KEY
    ];
    const operation: DataOperation = {
      generation: typeof generation === 'string' ? generation : 'initial',
      ...(storage === privateStorage
        ? { vaultEpoch: await getVaultEpoch() }
        : {}),
    };
    const existing = await loadPilot(storage);
    if (existing) return { state: existing, operation };
    const next: PilotState = {
      schemaVersion: 1,
      protocolVersion: PILOT_PROTOCOL_VERSION,
      participantId: crypto.randomUUID(),
      enrolledAt: Date.now(),
      trials: [],
    };
    await storage.set({ [PILOT_STORAGE_KEY]: next });
    return { state: next, operation };
  });
}

export async function savePilotTrial(
  participantId: string,
  operation: DataOperation,
  trial: PilotTrial,
  storage: chrome.storage.StorageArea = privateStorage,
): Promise<PilotState> {
  return commitDataOperation(
    operation,
    async () => {
      const state = await loadPilot(storage);
      if (!state || state.participantId !== participantId)
        throw new Error('Pilot participation ended');
      const index = state.trials.findIndex((item) => item.id === trial.id);
      if (index === -1) {
        if (state.trials.length >= PILOT_TRIAL_LIMIT)
          throw new Error('Pilot trial limit reached');
        if (
          state.trials.some(
            (item) => item.materialFingerprint === trial.materialFingerprint,
          )
        )
          throw new Error('This article has already been included');
        state.trials.push(trial);
      } else state.trials[index] = trial;
      await storage.set({ [PILOT_STORAGE_KEY]: state });
      return state;
    },
    storage,
  );
}

export async function erasePilot(
  storage: chrome.storage.StorageArea = privateStorage,
): Promise<void> {
  // The participant ID also invalidates pending writes after a new enrollment.
  await withAttentionDataLock(async () => {
    await storage.remove(PILOT_STORAGE_KEY);
  });
}
