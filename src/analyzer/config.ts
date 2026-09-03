import type {
  PersonalizationSignalKind,
  QualityBreakdown,
} from '../shared/types';

/** Tunable boundaries used by both local and cloud claim assessment. */
export const NOVELTY_CLASSIFICATION = {
  minimumConfidence: 0.45,
  knownProbability: 0.72,
  partiallyKnownProbability: 0.42,
  likelyNewProbability: 0.3,
} as const;

/** Tunable weights for the deterministic quality score. */
export const QUALITY_WEIGHTS = {
  evidence: 0.35,
  reasoning: 0.3,
  specificity: 0.2,
  calibration: 0.15,
} as const satisfies Record<keyof QualityBreakdown, number>;

/** Limits that control the size and latency of a cloud analysis request. */
export const AI_ANALYSIS_LIMITS = {
  contentCharacters: 24_000,
  retainedEndingCharacters: 6_000,
  outputReasonCharacters: 700,
  requestTimeoutMs: 25_000,
  claims: 8,
  recommendedSections: 3,
} as const;

/** Limits for the deterministic claim extractor. */
export const CLAIM_EXTRACTION_LIMITS = {
  claims: 8,
  minimumClaimCharacters: 55,
  maximumClaimCharacters: 420,
} as const;

/** Relative importance of profile signals in the local analyzer. */
export const LOCAL_SIGNAL_KIND_WEIGHTS: Readonly<
  Record<PersonalizationSignalKind, number>
> = {
  goal: 2.6,
  lowValueTopic: 3,
  expertise: 2.1,
  interest: 1.7,
  learningArea: 1,
  leisurePreference: 1,
  contentPreference: 1,
  historyTopic: 0.65,
  historySource: 0.45,
};
