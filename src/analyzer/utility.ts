import type {
  MaterialDecision,
  MaterialEvaluationInsights,
} from '../shared/types';

export interface UtilityComponents {
  relevance: number;
  novelty: number;
  actionability: number;
  quality: number;
}

export const UTILITY_WEIGHTS = {
  relevance: 0.4,
  novelty: 0.3,
  actionability: 0.2,
  quality: 0.1,
} as const satisfies Record<keyof UtilityComponents, number>;

export function normalizeScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)));
}

export function normalizeUtilityComponents(
  components: UtilityComponents,
): UtilityComponents {
  return {
    relevance: normalizeScore(components.relevance),
    novelty: normalizeScore(components.novelty),
    actionability: normalizeScore(components.actionability),
    quality: normalizeScore(components.quality),
  };
}

export function calculateUtilityScore(components: UtilityComponents): number {
  const normalized = normalizeUtilityComponents(components);
  return normalizeScore(
    normalized.relevance * UTILITY_WEIGHTS.relevance +
      normalized.novelty * UTILITY_WEIGHTS.novelty +
      normalized.actionability * UTILITY_WEIGHTS.actionability +
      normalized.quality * UTILITY_WEIGHTS.quality,
  );
}

export function utilityRecommendation(score: number): MaterialDecision {
  const normalized = normalizeScore(score);
  if (normalized >= 70) return 'read';
  if (normalized >= 35) return 'skim';
  return 'skip';
}

export function estimateUsefulMinutes(
  utilityScore: number,
  readingTimeMinutes: number,
): number {
  const fullReadingTime = Math.max(0, readingTimeMinutes);
  if (fullReadingTime === 0) return 0;
  return Math.max(
    1,
    Math.round(fullReadingTime * (normalizeScore(utilityScore) / 100)),
  );
}

/** Missing context prevents a personal decision; incomplete coverage only qualifies it. */
export function assessmentNeedsContext(
  insights?: MaterialEvaluationInsights,
): boolean {
  return insights?.taskEvidence === 'no-context';
}

export function preliminaryAssessment(
  insights?: MaterialEvaluationInsights,
): boolean {
  return (
    insights?.analysisCoverage === 'partial' ||
    insights?.reliability?.weakExtraction === true ||
    (insights?.taskEvidence !== undefined && insights.taskEvidence !== 'body')
  );
}

/** Direction and confidence are separate: limited evidence must not erase every recommendation. */
export function assessmentRecommendation(
  score: number,
  insights?: MaterialEvaluationInsights,
): MaterialDecision {
  if (assessmentNeedsContext(insights)) return 'skim';
  if (
    insights?.taskEvidence === 'metadata-only' ||
    insights?.taskEvidence === 'no-match'
  ) {
    // A body-level profile/topic match justifies a selective look, not a claim
    // that the whole article solves the current task. No match is a weak skip.
    return insights.readingFocus || insights.readingPassages?.items.length
      ? 'skim'
      : 'skip';
  }
  return utilityRecommendation(score);
}
