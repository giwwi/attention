import { normalizeScore } from '../analyzer/utility';
import type {
  AttentionScenario,
  MaterialEvaluation,
  UtilityPredictionProvenance,
} from '../shared/types';

/** Increment when the raw scoring policy changes; old policies do not train this one. */
export const RAW_UTILITY_SCORE_VERSION = 'scenario-utility-v2-task-evidence';
export const UTILITY_CALIBRATION_VERSION = 'utility-calibration-v2';

function score(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

export function createRawUtilityPrediction(
  rawUtility: number,
  scenario: AttentionScenario,
  analyzerVersion: string,
): UtilityPredictionProvenance {
  return {
    schemaVersion: 1,
    rawUtility: normalizeScore(rawUtility),
    displayedUtility: normalizeScore(rawUtility),
    scenario,
    analyzerVersion,
    rawScoreVersion: RAW_UTILITY_SCORE_VERSION,
    calibrationVersion: null,
    calibrationModelUpdatedAt: null,
    calibrationSampleSize: 0,
    provenance: 'captured',
  };
}

/** Never infer a raw value from an old displayed score. */
export function normalizeUtilityPrediction(
  value: unknown,
  displayedUtility: number,
  scenario: AttentionScenario,
  analyzerVersion: string | null = null,
): UtilityPredictionProvenance {
  const item = value as Partial<UtilityPredictionProvenance> | null;
  if (
    item?.schemaVersion === 1 &&
    item.provenance === 'captured' &&
    score(item.rawUtility) &&
    score(item.displayedUtility) &&
    item.displayedUtility === displayedUtility &&
    item.scenario === scenario &&
    typeof item.analyzerVersion === 'string' &&
    item.analyzerVersion.length > 0 &&
    (analyzerVersion === null || item.analyzerVersion === analyzerVersion) &&
    typeof item.rawScoreVersion === 'string' &&
    item.rawScoreVersion.length > 0 &&
    (item.calibrationVersion === null ||
      typeof item.calibrationVersion === 'string') &&
    (item.calibrationModelUpdatedAt === null ||
      typeof item.calibrationModelUpdatedAt === 'string') &&
    typeof item.calibrationSampleSize === 'number' &&
    Number.isFinite(item.calibrationSampleSize) &&
    item.calibrationSampleSize >= 0
  )
    return structuredClone(item as UtilityPredictionProvenance);
  return {
    schemaVersion: 1,
    rawUtility: null,
    displayedUtility: normalizeScore(displayedUtility),
    scenario,
    analyzerVersion:
      analyzerVersion ??
      (typeof item?.analyzerVersion === 'string' ? item.analyzerVersion : null),
    rawScoreVersion: null,
    calibrationVersion: null,
    calibrationModelUpdatedAt: null,
    calibrationSampleSize: 0,
    provenance: 'legacy-display-only',
  };
}

export function evaluationPrediction(
  evaluation: MaterialEvaluation,
): UtilityPredictionProvenance {
  return normalizeUtilityPrediction(
    evaluation.prediction,
    evaluation.utilityScore,
    evaluation.scenario,
    evaluation.analyzerId,
  );
}
