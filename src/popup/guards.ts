import type {
  AnalysisContext,
  AttentionSessionProgressResponse,
  DecisionRecord,
  MaterialEvaluation,
  PageCapture,
  PersonalizationSignal,
  SavedMaterial,
  ScrollToHeadingResponse,
  StoredEvaluation,
} from '../shared/types';

export function isPageCapture(value: unknown): value is PageCapture {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.url === 'string' &&
    typeof candidate.content === 'string' &&
    typeof candidate.excerpt === 'string' &&
    (typeof candidate.byline === 'string' || candidate.byline === null) &&
    typeof candidate.siteName === 'string' &&
    (typeof candidate.publishedTime === 'string' ||
      candidate.publishedTime === null) &&
    (typeof candidate.language === 'string' || candidate.language === null) &&
    typeof candidate.wordCount === 'number' &&
    typeof candidate.readingTimeMinutes === 'number' &&
    Array.isArray(candidate.headings) &&
    candidate.headings.every((heading) => typeof heading === 'string') &&
    typeof candidate.isArticle === 'boolean' &&
    (candidate.extractionMethod === 'readability' ||
      candidate.extractionMethod === 'semantic' ||
      candidate.extractionMethod === 'visible-text') &&
    typeof candidate.capturedAt === 'string'
  );
}

export function isDecisionRecord(value: unknown): value is DecisionRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.url === 'string' &&
    typeof candidate.title === 'string' &&
    ['read', 'skim', 'save', 'skip'].includes(String(candidate.decision)) &&
    typeof candidate.decidedAt === 'string'
  );
}

export function isSavedMaterial(value: unknown): value is SavedMaterial {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { capture?: unknown; savedAt?: unknown };
  return (
    isPageCapture(candidate.capture) && typeof candidate.savedAt === 'string'
  );
}

export function isAnalysisContext(value: unknown): value is AnalysisContext {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.intent === 'string' &&
    [5, 15, 30].includes(Number(candidate.availableMinutes)) &&
    (candidate.scenario === undefined ||
      ['work', 'learn', 'explore', 'relax'].includes(
        String(candidate.scenario),
      ))
  );
}

function isScenarioSignals(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const signals = value as Record<string, unknown>;
  return [
    'relevance',
    'novelty',
    'quality',
    'actionability',
    'knowledgeFit',
    'timeFit',
    'effortFit',
    'tasteFit',
    'serendipity',
    'enjoymentFit',
  ].every(
    (key) =>
      typeof signals[key] === 'number' &&
      Number.isFinite(signals[key]) &&
      Number(signals[key]) >= 0 &&
      Number(signals[key]) <= 100,
  );
}

function isUtilityComponents(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const components = value as Record<string, unknown>;
  return ['relevance', 'novelty', 'actionability', 'quality'].every(
    (key) =>
      typeof components[key] === 'number' &&
      Number.isFinite(components[key]) &&
      Number(components[key]) >= 0 &&
      Number(components[key]) <= 100,
  );
}

export function isPersonalizationSignal(
  value: unknown,
): value is PersonalizationSignal {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    (typeof candidate.profileEntryId === 'string' ||
      candidate.profileEntryId === null) &&
    [
      'interest',
      'goal',
      'expertise',
      'learningArea',
      'leisurePreference',
      'lowValueTopic',
      'contentPreference',
    ].includes(String(candidate.kind)) &&
    ['positive', 'negative', 'neutral'].includes(String(candidate.effect)) &&
    typeof candidate.label === 'string' &&
    typeof candidate.explanation === 'string' &&
    typeof candidate.confidence === 'number' &&
    typeof candidate.matchScore === 'number'
  );
}

export function isMaterialEvaluation(
  value: unknown,
): value is MaterialEvaluation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    ['read', 'skim', 'save', 'skip'].includes(
      String(candidate.recommendedAction),
    ) &&
    typeof candidate.utilityScore === 'number' &&
    candidate.utilityScore >= 0 &&
    candidate.utilityScore <= 100 &&
    isUtilityComponents(candidate.components) &&
    ['work', 'learn', 'explore', 'relax'].includes(
      String(candidate.scenario),
    ) &&
    isScenarioSignals(candidate.scenarioSignals) &&
    typeof candidate.estimatedUsefulMinutes === 'number' &&
    typeof candidate.reason === 'string' &&
    typeof candidate.expectedValue === 'string' &&
    Array.isArray(candidate.recommendedSections) &&
    candidate.recommendedSections.every(
      (section) => typeof section === 'string',
    ) &&
    (candidate.profileSignals === undefined ||
      (Array.isArray(candidate.profileSignals) &&
        candidate.profileSignals.every(isPersonalizationSignal))) &&
    typeof candidate.confidence === 'number' &&
    candidate.confidence >= 0 &&
    candidate.confidence <= 1 &&
    typeof candidate.analyzerId === 'string' &&
    typeof candidate.analyzedAt === 'string'
  );
}

export function isStoredEvaluation(value: unknown): value is StoredEvaluation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.url === 'string' &&
    isAnalysisContext(candidate.context) &&
    isMaterialEvaluation(candidate.evaluation)
  );
}

export function isAttentionProgressResponse(
  value: unknown,
): value is AttentionSessionProgressResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Record<string, unknown>;
  if (response.ok !== true) return false;
  if (response.progress === null) return true;
  if (!response.progress || typeof response.progress !== 'object') return false;
  const progress = response.progress as Record<string, unknown>;
  return (
    typeof progress.sessionId === 'string' &&
    typeof progress.url === 'string' &&
    typeof progress.visibleSeconds === 'number' &&
    [0, 25, 50, 75, 100].includes(Number(progress.maxScrollDepth)) &&
    typeof progress.ended === 'boolean' &&
    typeof progress.recordedAt === 'string'
  );
}

export function isScrollToHeadingResponse(
  value: unknown,
): value is ScrollToHeadingResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Record<string, unknown>;
  return response.ok === true && typeof response.found === 'boolean';
}
