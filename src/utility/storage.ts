import type {
  AnalysisContext,
  AttentionScenario,
  AttentionSessionRecord,
  MaterialEvaluation,
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
  predictedUtility: number;
  actualUtility: number;
  components: MaterialEvaluation['components'];
  evaluatedAt: string;
  recordedAt: string;
  source: 'slider' | 'quick';
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
    typeof item.actualUtility === 'number' &&
    isComponents(item.components) &&
    typeof item.evaluatedAt === 'string' &&
    typeof item.recordedAt === 'string' &&
    (item.source === undefined ||
      item.source === 'slider' ||
      item.source === 'quick') &&
    (item.scenario === undefined ||
      ['work', 'learn', 'explore', 'relax'].includes(String(item.scenario)))
  );
}

export async function loadUtilityFeedback(
  storage: StorageArea = chrome.storage.local,
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
    source: record.source ?? 'slider',
    scenario: record.scenario ?? 'work',
    scenarioContext: record.scenarioContext ?? {
      intent: '',
      availableMinutes: 15,
      relaxIntent: null,
      desiredEffort: null,
    },
  }));
  const needsMigration = value.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return !record.scenario || !record.scenarioContext || !record.source;
  });
  if (needsMigration)
    await measuredStorageSet(storage, 'utility-feedback', {
      [UTILITY_FEEDBACK_KEY]: records,
    });
  return records;
}

export async function loadUtilityCalibration(
  storage: StorageArea = chrome.storage.local,
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
  await measuredStorageSet(storage, 'utility-calibration-migration', {
    [UTILITY_CALIBRATION_KEY]: model,
  });
  return model;
}

export async function recordActualUtility(
  session: AttentionSessionRecord,
  actualUtility: number,
  storage: StorageArea = chrome.storage.local,
  now = new Date(),
  source: UtilityFeedbackRecord['source'] = 'slider',
): Promise<UtilityFeedbackRecord> {
  if (
    session.expected.predictedUtility === null ||
    session.expected.components === null
  ) {
    throw new Error('Для этого чтения нет сохранённого прогноза Utility.');
  }
  const previous = await loadUtilityFeedback(storage);
  const record: UtilityFeedbackRecord = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    url: session.url,
    title: session.title,
    predictedUtility: normalizeScore(session.expected.predictedUtility),
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
  storage: StorageArea = chrome.storage.local,
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
