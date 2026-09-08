import {
  estimateUsefulMinutes,
  normalizeScore,
  utilityRecommendation,
} from '../analyzer/utility';
import type { AttentionScenario, MaterialEvaluation } from '../shared/types';
import type { UtilityFeedbackRecord } from './storage';
import {
  evaluationPrediction,
  normalizeUtilityPrediction,
  RAW_UTILITY_SCORE_VERSION,
  UTILITY_CALIBRATION_VERSION,
} from './prediction';

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
  schemaVersion: 2;
  version: typeof UTILITY_CALIBRATION_VERSION;
  rawScoreVersion: typeof RAW_UTILITY_SCORE_VERSION;
  updatedAt: string;
  sampleSize: number;
  global: UtilityCalibrationCurve | null;
  byScenario: Partial<Record<AttentionScenario, UtilityCalibrationCurve>>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

interface TrainingSample {
  rawUtility: number;
  actualUtility: number;
  scenario: AttentionScenario;
  recordedAt: string;
}

function curve(
  records: TrainingSample[],
  minimumSamples: number,
): UtilityCalibrationCurve | null {
  if (records.length < minimumSamples) return null;
  const sample = records.slice(0, 80);
  const meanPredicted =
    sample.reduce((sum, item) => sum + item.rawUtility, 0) / sample.length;
  const meanActual =
    sample.reduce((sum, item) => sum + item.actualUtility, 0) / sample.length;
  const variance = sample.reduce(
    (sum, item) => sum + (item.rawUtility - meanPredicted) ** 2,
    0,
  );
  const covariance = sample.reduce(
    (sum, item) =>
      sum +
      (item.rawUtility - meanPredicted) * (item.actualUtility - meanActual),
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
          (sum, item) => sum + Math.abs(item.rawUtility - item.actualUtility),
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
  // Compatible raw predictions only. A missing provenance field is not proof
  // that a historical score was uncalibrated; keep those outcomes out of training.
  const samples: TrainingSample[] = records.flatMap((record) => {
    const prediction = normalizeUtilityPrediction(
      record.prediction,
      record.predictedUtility,
      record.scenario,
    );
    if (
      (record.source !== 'quick' && record.source !== 'slider') ||
      prediction.provenance !== 'captured' ||
      prediction.rawUtility === null ||
      prediction.rawScoreVersion !== RAW_UTILITY_SCORE_VERSION ||
      !Number.isFinite(record.actualUtility) ||
      record.actualUtility < 0 ||
      record.actualUtility > 100
    )
      return [];
    return [
      {
        rawUtility: prediction.rawUtility,
        actualUtility: record.actualUtility,
        scenario: record.scenario,
        recordedAt: record.recordedAt,
      },
    ];
  });
  const byScenario: UtilityCalibrationModel['byScenario'] = {};
  for (const scenario of ['work', 'learn', 'explore', 'relax'] as const) {
    const scenarioCurve = curve(
      samples.filter((record) => record.scenario === scenario),
      MIN_SCENARIO_SAMPLES,
    );
    if (scenarioCurve) byScenario[scenario] = scenarioCurve;
  }
  return {
    schemaVersion: 2,
    version: UTILITY_CALIBRATION_VERSION,
    rawScoreVersion: RAW_UTILITY_SCORE_VERSION,
    updatedAt:
      samples
        .map((record) => record.recordedAt)
        .sort()
        .at(-1) ?? now.toISOString(),
    sampleSize: samples.length,
    global: curve(samples, MIN_GLOBAL_SAMPLES),
    byScenario,
  };
}

function isCurve(value: unknown): value is UtilityCalibrationCurve {
  if (!value || typeof value !== 'object') return false;
  const item = value as UtilityCalibrationCurve;
  return (
    [
      'sampleSize',
      'meanPredicted',
      'meanActual',
      'slope',
      'strength',
      'meanAbsoluteError',
    ].every(
      (key) =>
        typeof item[key as keyof UtilityCalibrationCurve] === 'number' &&
        Number.isFinite(item[key as keyof UtilityCalibrationCurve]),
    ) &&
    item.sampleSize >= MIN_SCENARIO_SAMPLES &&
    item.strength >= 0 &&
    item.strength <= 0.8 &&
    item.slope >= 0.65 &&
    item.slope <= 1.35
  );
}

export function isUtilityCalibrationModel(
  value: unknown,
): value is UtilityCalibrationModel {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<UtilityCalibrationModel>;
  return (
    item.schemaVersion === 2 &&
    item.version === UTILITY_CALIBRATION_VERSION &&
    item.rawScoreVersion === RAW_UTILITY_SCORE_VERSION &&
    typeof item.updatedAt === 'string' &&
    typeof item.sampleSize === 'number' &&
    Number.isFinite(item.sampleSize) &&
    item.sampleSize >= 0 &&
    Boolean(item.byScenario) &&
    typeof item.byScenario === 'object' &&
    Object.entries(item.byScenario!).every(
      ([scenario, value]) =>
        ['work', 'learn', 'explore', 'relax'].includes(scenario) &&
        isCurve(value),
    ) &&
    (item.global === null || isCurve(item.global))
  );
}

export function calibrateUtilityScore(
  score: number,
  scenario: AttentionScenario,
  model: UtilityCalibrationModel | null,
): number {
  // A Work outcome is never evidence for the reader's Relax utility curve.
  const selected =
    model && isUtilityCalibrationModel(model)
      ? model.byScenario[scenario]
      : undefined;
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
  const prediction = evaluationPrediction(evaluation);
  // Cached legacy evaluations may already be calibrated. Display them as saved,
  // but never apply another correction to a score whose raw value is unknown.
  if (
    prediction.rawUtility === null ||
    prediction.rawScoreVersion !== RAW_UTILITY_SCORE_VERSION
  )
    return { ...evaluation, prediction };
  const utilityScore = calibrateUtilityScore(
    prediction.rawUtility,
    evaluation.scenario,
    model,
  );
  const selected =
    model && isUtilityCalibrationModel(model)
      ? model.byScenario[evaluation.scenario]
      : undefined;
  return {
    ...evaluation,
    utilityScore,
    prediction: {
      ...prediction,
      displayedUtility: utilityScore,
      calibrationVersion: UTILITY_CALIBRATION_VERSION,
      calibrationModelUpdatedAt: selected ? model!.updatedAt : null,
      calibrationSampleSize: selected?.sampleSize ?? 0,
    },
    recommendedAction:
      evaluation.recommendationConstraint === 'skip'
        ? 'skip'
        : utilityRecommendation(utilityScore),
    estimatedUsefulMinutes: estimateUsefulMinutes(
      utilityScore,
      readingTimeMinutes,
    ),
  };
}
