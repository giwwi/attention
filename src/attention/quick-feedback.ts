import { privateStorage } from '../vault/storage';
import { recordMaterialActualUtility } from '../memory/material-memory';
import { applyScenarioOutcomeToProfileSignals } from '../profile/storage';
import {
  QUICK_UTILITY_BY_OUTCOME,
  type AttentionSessionRecord,
  type MaterialOutcome,
} from '../shared/types';
import { recordActualUtility } from '../utility/storage';
import { recordMaterialOutcome } from './storage';

interface StorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export async function recordQuickOutcome(
  session: AttentionSessionRecord,
  outcome: MaterialOutcome,
  storage: StorageArea = privateStorage,
  now = new Date(),
): Promise<number> {
  const actualUtility = QUICK_UTILITY_BY_OUTCOME[outcome];
  const record = await recordActualUtility(
    session,
    actualUtility,
    storage,
    now,
    'quick',
  );
  await recordMaterialActualUtility(
    session.url,
    session.title,
    actualUtility,
    record.recordedAt,
    storage,
    session.scenario,
    { source: record.source, prediction: record.prediction, outcome },
  );
  await applyScenarioOutcomeToProfileSignals(
    session.scenario,
    session.expected.profileSignalIds,
    outcome,
    storage,
    now,
  );
  await recordMaterialOutcome(session.id, outcome, storage, now, 'quick');
  return actualUtility;
}
