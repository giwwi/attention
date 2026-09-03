import type {
  AnalysisContext,
  ClaimNovelty,
  MaterialDecision,
  MaterialEvaluation,
  MaterialEvaluationInsights,
  PageCapture,
  RelevantProfileContext,
} from '../shared/types';
import { NOVELTY_CLASSIFICATION } from './config';
import {
  buildScenarioSignals,
  calculateScenarioUtility,
  scenarioExplanation,
} from './scenario-scoring';
import {
  estimateUsefulMinutes,
  normalizeUtilityComponents,
  utilityRecommendation,
  type UtilityComponents,
} from './utility';
import {
  hasRelevantLeisurePreference,
  hasUsefulRelaxHistory,
  RELAX_HISTORY_FALLBACK,
} from '../scenario/relax-history';
import { assessMaterialScenarioFit } from '../scenario/material-activity';

export function classifyClaimNovelty(
  knownProbability: number,
  confidence: number,
): ClaimNovelty {
  if (confidence < NOVELTY_CLASSIFICATION.minimumConfidence) {
    return 'uncertain';
  }
  if (knownProbability >= NOVELTY_CLASSIFICATION.knownProbability) {
    return 'known';
  }
  if (knownProbability >= NOVELTY_CLASSIFICATION.partiallyKnownProbability) {
    return 'partially-known';
  }
  if (knownProbability <= NOVELTY_CLASSIFICATION.likelyNewProbability) {
    return 'likely-new';
  }
  return 'uncertain';
}

export interface FinalizeMaterialEvaluationInput {
  analyzerId: string;
  material: PageCapture;
  context: AnalysisContext;
  profileContext: RelevantProfileContext | null;
  components: UtilityComponents;
  insights: MaterialEvaluationInsights;
  expectedValue?: string;
  recommendedSections: string[];
  confidence: number;
  recommendedActionOverride?: MaterialDecision;
  reasonOverride?: string;
  analyzedAt?: string;
}

/**
 * Deterministic final assembly shared by local and cloud analyzers.
 * The model supplies component evidence; product policy remains in code.
 */
export function finalizeMaterialEvaluation({
  analyzerId,
  material,
  context,
  profileContext,
  components: rawComponents,
  insights,
  expectedValue,
  recommendedSections,
  confidence: rawConfidence,
  recommendedActionOverride,
  reasonOverride,
  analyzedAt,
}: FinalizeMaterialEvaluationInput): MaterialEvaluation {
  const components = normalizeUtilityComponents(rawComponents);
  const scenarioSignals = buildScenarioSignals(
    components,
    material,
    context,
    profileContext,
  );
  const utilityScore = calculateScenarioUtility(scenarioSignals, context);
  const scenarioFit = assessMaterialScenarioFit(material, context);
  const profileSignals = profileContext?.signals ?? [];
  const hasLeisureEvidence = hasRelevantLeisurePreference(profileSignals);
  const hasHistoryTasteFallback = hasUsefulRelaxHistory(profileSignals);
  const confidence =
    context.scenario === 'relax' && !hasLeisureEvidence
      ? Math.min(
          hasHistoryTasteFallback ? RELAX_HISTORY_FALLBACK.confidenceCap : 0.48,
          rawConfidence,
        )
      : rawConfidence;

  return {
    scenario: context.scenario,
    ...(scenarioFit.suggestedScenario
      ? { suggestedScenario: scenarioFit.suggestedScenario }
      : {}),
    recommendedAction:
      recommendedActionOverride ?? utilityRecommendation(utilityScore),
    utilityScore,
    components,
    scenarioSignals,
    estimatedUsefulMinutes: estimateUsefulMinutes(
      utilityScore,
      material.readingTimeMinutes,
    ),
    reason:
      reasonOverride ??
      scenarioFit.reason ??
      scenarioExplanation(
        scenarioSignals,
        context,
        insights.likelyNewClaims.length,
      ),
    expectedValue:
      scenarioFit.reason ??
      expectedValue ??
      scenarioExplanation(
        scenarioSignals,
        context,
        insights.likelyNewClaims.length,
      ),
    recommendedSections,
    profileSignals,
    insights,
    confidence,
    analyzerId,
    analyzedAt: analyzedAt ?? new Date().toISOString(),
  };
}
