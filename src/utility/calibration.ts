import {
  estimateUsefulMinutes,
  normalizeScore,
  utilityRecommendation,
} from '../analyzer/utility';
import type { AttentionScenario, MaterialEvaluation } from '../shared/types';
import type { UtilityFeedbackRecord } from './storage';

export const UTILITY_CALIBRATION_KEY = 'utilityCalibration';
const MIN_SCENARIO_SAMPLES = 5;
const MIN_GLOBAL_SAMPLES = 8;
const MAX_CORRECTION = 15;

export interface UtilityCalibrationCurve {
  sampleSize: number;
  meanPredicted: number;
  meanActual: number;
  slope: number;
  strength: number;
  meanAbsoluteError: number;
}

export interface UtilityCalibrationModel {
  schemaVersion: 1;
  updatedAt: string;
  sampleSize: number;
  global: UtilityCalibrationCurve | null;
  byScenario: Partial<Record<AttentionScenario, UtilityCalibrationCurve>>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function curve(
  records: UtilityFeedbackRecord[],
  minimumSamples: number,
): UtilityCalibrationCurve | null {
  if (records.length < minimumSamples) return null;
  const sample = records.slice(0, 80);
  const meanPredicted =
    sample.reduce((sum, item) => sum + item.predictedUtility, 0) /
    sample.length;
  const meanActual =
    sample.reduce((sum, item) => sum + item.actualUtility, 0) / sample.length;
  const variance = sample.reduce(
    (sum, item) => sum + (item.predictedUtility - meanPredicted) ** 2,
    0,
  );
  const covariance = sample.reduce(
    (sum, item) =>
      sum +
      (item.predictedUtility - meanPredicted) *
        (item.actualUtility - meanActual),
    0,
  );
  const rawSlope = variance >= 25 ? covariance / variance : 1;
  return {
    sampleSize: sample.length,
    meanPredicted: Number(meanPredicted.toFixed(2)),
    meanActual: Number(meanActual.toFixed(2)),
    slope: Number(clamp(rawSlope, 0.65, 1.35).toFixed(3)),
    strength: Number(
      Math.min(0.8, sample.length / (sample.length + 12)).toFixed(3),
    ),
    meanAbsoluteError: Number(
      (
        sample.reduce(
          (sum, item) =>
            sum + Math.abs(item.predictedUtility - item.actualUtility),
          0,
        ) / sample.length
      ).toFixed(2),
    ),
  };
}

export function buildUtilityCalibration(
  records: UtilityFeedbackRecord[],
  now = new Date(),
): UtilityCalibrationModel {
  const byScenario: UtilityCalibrationModel['byScenario'] = {};
  for (const scenario of ['work', 'learn', 'explore', 'relax'] as const) {
    const scenarioCurve = curve(
      records.filter((record) => record.scenario === scenario),
      MIN_SCENARIO_SAMPLES,
    );
    if (scenarioCurve) byScenario[scenario] = scenarioCurve;
  }
  return {
    schemaVersion: 1,
    updatedAt:
      records
        .map((record) => record.recordedAt)
        .sort()
        .at(-1) ?? now.toISOString(),
    sampleSize: records.length,
    global: curve(records, MIN_GLOBAL_SAMPLES),
    byScenario,
  };
}

export function isUtilityCalibrationModel(
  value: unknown,
): value is UtilityCalibrationModel {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<UtilityCalibrationModel>;
  return (
    item.schemaVersion === 1 &&
    typeof item.updatedAt === 'string' &&
    typeof item.sampleSize === 'number' &&
    Boolean(item.byScenario) &&
    typeof item.byScenario === 'object'
  );
}

export function calibrateUtilityScore(
  score: number,
  scenario: AttentionScenario,
  model: UtilityCalibrationModel | null,
): number {
  const selected = model?.byScenario[scenario] ?? model?.global;
  if (!selected) return normalizeScore(score);
  const fitted =
    selected.meanActual + selected.slope * (score - selected.meanPredicted);
  const correction = clamp(
    (fitted - score) * selected.strength,
    -MAX_CORRECTION,
    MAX_CORRECTION,
  );
  return normalizeScore(score + correction);
}

export function calibrateMaterialEvaluation(
  evaluation: MaterialEvaluation,
  readingTimeMinutes: number,
  model: UtilityCalibrationModel | null,
): MaterialEvaluation {
  const utilityScore = calibrateUtilityScore(
    evaluation.utilityScore,
    evaluation.scenario,
    model,
  );
  if (utilityScore === evaluation.utilityScore) return evaluation;
  return {
    ...evaluation,
    utilityScore,
    recommendedAction: utilityRecommendation(utilityScore),
    estimatedUsefulMinutes: estimateUsefulMinutes(
      utilityScore,
      readingTimeMinutes,
    ),
  };
}
