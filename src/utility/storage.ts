import { privateStorage } from '../vault/storage';
import type {
  AnalysisContext,
  AttentionScenario,
  AttentionSessionRecord,
  MaterialEvaluation,
  MaterialOutcome,
  UtilityOutcomeSource,
  UtilityPredictionProvenance,
} from '../shared/types';
import { normalizeScore } from '../analyzer/utility';
import { STORAGE_RETENTION_LIMITS } from '../storage/limits';
import {
  measuredStorageGet,
  measuredStorageSet,
} from '../storage/measured-storage';
import {
  buildUtilityCalibration,
  isUtilityCalibrationModel,
  UTILITY_CALIBRATION_KEY,
  type UtilityCalibrationModel,
} from './calibration';

import { normalizeUtilityPrediction } from './prediction';

export const UTILITY_FEEDBACK_KEY = 'utilityFeedback';

interface StorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface UtilityFeedbackRecord {
  id: string;
  sessionId: string;
  url: string;
  title: string;
  /** Historical alias for the displayed score, never an assumed raw score. */
  predictedUtility: number;
  prediction?: UtilityPredictionProvenance;
  outcome?: MaterialOutcome | null;
  actualUtility: number;
  components: MaterialEvaluation['components'];
  evaluatedAt: string;
  recordedAt: string;
  source: UtilityOutcomeSource;
  scenario: AttentionScenario;
  scenarioContext: Pick<
    AnalysisContext,
    'intent' | 'availableMinutes' | 'relaxIntent' | 'desiredEffort'
  >;
}

function isComponents(
  value: unknown,
): value is MaterialEvaluation['components'] {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['relevance', 'novelty', 'actionability', 'quality'].every(
    (key) => typeof item[key] === 'number' && Number.isFinite(item[key]),
  );
}

function isUtilityFeedbackRecord(
  value: unknown,
): value is UtilityFeedbackRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.sessionId === 'string' &&
    typeof item.url === 'string' &&
    typeof item.title === 'string' &&
    typeof item.predictedUtility === 'number' &&
    Number.isFinite(item.predictedUtility) &&
    typeof item.actualUtility === 'number' &&
    Number.isFinite(item.actualUtility) &&
    isComponents(item.components) &&
    typeof item.evaluatedAt === 'string' &&
    typeof item.recordedAt === 'string' &&
    (item.source === undefined ||
      item.source === 'slider' ||
      item.source === 'quick' ||
      item.source === 'legacy-unknown') &&
    (item.scenario === undefined ||
      ['work', 'learn', 'explore', 'relax'].includes(String(item.scenario)))
  );
}

export async function loadUtilityFeedback(
  storage: StorageArea = privateStorage,
): Promise<UtilityFeedbackRecord[]> {
  const stored = await measuredStorageGet(
    storage,
    'utility-feedback',
    UTILITY_FEEDBACK_KEY,
  );
  const value: unknown = stored[UTILITY_FEEDBACK_KEY];
  if (!Array.isArray(value)) return [];
  const records = value.filter(isUtilityFeedbackRecord).map((record) => ({
    ...record,
    source: record.source ?? 'legacy-unknown',
    outcome: record.outcome ?? null,
    prediction: normalizeUtilityPrediction(
      record.prediction,
      record.predictedUtility,
      record.scenario ?? 'work',
    ),
    scenario: record.scenario ?? 'work',
    scenarioContext: record.scenarioContext ?? {
      intent: '',
      availableMinutes: 15,
      relaxIntent: null,
      desiredEffort: null,
    },
  }));
  // Reads normalize legacy records in memory. A delayed read must never write
  // an old snapshot back after another extension context erased its data.
  return records;
}

export async function loadUtilityCalibration(
  storage: StorageArea = privateStorage,
): Promise<UtilityCalibrationModel | null> {
  const stored = await measuredStorageGet(
    storage,
    'utility-calibration',
    UTILITY_CALIBRATION_KEY,
  );
  const value = stored[UTILITY_CALIBRATION_KEY];
  if (isUtilityCalibrationModel(value)) return value;
  const feedback = await loadUtilityFeedback(storage);
  if (feedback.length === 0) return null;
  const model = buildUtilityCalibration(feedback);
  return model.sampleSize > 0 ? model : null;
}

export async function recordActualUtility(
  session: AttentionSessionRecord,
  actualUtility: number,
  storage: StorageArea = privateStorage,
  now = new Date(),
  source: Exclude<UtilityOutcomeSource, 'legacy-unknown'> = 'slider',
): Promise<UtilityFeedbackRecord> {
  if (
    typeof session.expected.predictedUtility !== 'number' ||
    !Number.isFinite(session.expected.predictedUtility) ||
    session.expected.components === null
  ) {
    throw new Error('Для этого чтения нет сохранённого прогноза Utility.');
  }
  if (!Number.isFinite(actualUtility))
    throw new Error('Utility outcome must be finite.');
  const previous = await loadUtilityFeedback(storage);
  const record: UtilityFeedbackRecord = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    url: session.url,
    title: session.title,
    predictedUtility: normalizeScore(session.expected.predictedUtility),
    prediction: normalizeUtilityPrediction(
      session.expected.prediction,
      session.expected.predictedUtility,
      session.scenario,
      session.expected.analyzerId,
    ),
    outcome:
      actualUtility >= 70 ? 'yes' : actualUtility >= 40 ? 'partial' : 'no',
    actualUtility: normalizeScore(actualUtility),
    components: session.expected.components,
    evaluatedAt: session.startedAt,
    recordedAt: now.toISOString(),
    source,
    scenario: session.scenario,
    scenarioContext: session.scenarioContext,
  };
  const next = [
    record,
    ...previous.filter((item) => item.sessionId !== session.id),
  ].slice(0, STORAGE_RETENTION_LIMITS.utilityFeedback);
  const calibration = buildUtilityCalibration(next, now);
  await measuredStorageSet(storage, 'utility-feedback', {
    [UTILITY_FEEDBACK_KEY]: next,
    [UTILITY_CALIBRATION_KEY]: calibration,
  });
  return record;
}

export interface UtilityFeedbackStats {
  total: number;
  averageError: number | null;
  byScenario: Record<
    AttentionScenario,
    { total: number; averageError: number | null }
  >;
}

export async function getUtilityFeedbackStats(
  storage: StorageArea = privateStorage,
): Promise<UtilityFeedbackStats> {
  const records = await loadUtilityFeedback(storage);
  const emptyByScenario = (): UtilityFeedbackStats['byScenario'] => ({
    work: { total: 0, averageError: null },
    learn: { total: 0, averageError: null },
    explore: { total: 0, averageError: null },
    relax: { total: 0, averageError: null },
  });
  if (records.length === 0)
    return { total: 0, averageError: null, byScenario: emptyByScenario() };
  const totalError = records.reduce(
    (sum, item) => sum + Math.abs(item.predictedUtility - item.actualUtility),
    0,
  );
  const byScenario = emptyByScenario();
  for (const scenario of ['work', 'learn', 'explore', 'relax'] as const) {
    const scenarioRecords = records.filter(
      (record) => record.scenario === scenario,
    );
    byScenario[scenario] = {
      total: scenarioRecords.length,
      averageError:
        scenarioRecords.length === 0
          ? null
          : Math.round(
              scenarioRecords.reduce(
                (sum, item) =>
                  sum + Math.abs(item.predictedUtility - item.actualUtility),
                0,
              ) / scenarioRecords.length,
            ),
    };
  }
  return {
    total: records.length,
    averageError: Math.round(totalError / records.length),
    byScenario,
  };
}
