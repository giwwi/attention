import type {
  AttentionScenario,
  AvailableMinutes,
  CognitiveEffort,
  MaterialDecision,
  MaterialEvaluationInsights,
  RelevantProfileContext,
  RelaxIntent,
  ScenarioUtilitySignals,
} from '../shared/types';
import type { UtilityComponents } from './utility';

export interface AnalyzeRequestBody {
  /**
   * A small, locally-selected subset of the personal model. The complete
   * profile is deliberately not part of the network contract.
   */
  profileContext: RelevantProfileContext | null;
  title: string;
  url: string;
  articleText: string;
  intent?: string;
  availableMinutes?: AvailableMinutes;
  scenario?: AttentionScenario;
  relaxIntent?: RelaxIntent | null;
  desiredEffort?: CognitiveEffort | null;
  leisureFormats?: string[];
}

const REQUEST_KEYS = new Set([
  'profileContext',
  'title',
  'url',
  'articleText',
  'intent',
  'availableMinutes',
  'scenario',
  'relaxIntent',
  'desiredEffort',
  'leisureFormats',
]);

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function probability(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isRelevantProfileContext(
  value: unknown,
): value is RelevantProfileContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Record<string, unknown>;
  // Connector evidence and Claim Memory stay local-only. Reject unknown
  // additions so they cannot silently cross the network boundary.
  if (
    !Object.keys(context).every((key) =>
      [
        'profileUpdatedAt',
        'signals',
        'knowledgeSignals',
        'historyEvidence',
      ].includes(key),
    )
  ) {
    return false;
  }
  if (
    !boundedString(context.profileUpdatedAt, 64) ||
    !Array.isArray(context.signals) ||
    context.signals.length > 6 ||
    !context.signals.every((value) => {
      if (!value || typeof value !== 'object') return false;
      const signal = value as Record<string, unknown>;
      return (
        boundedString(signal.id, 180) &&
        (signal.profileEntryId === null ||
          boundedString(signal.profileEntryId, 180)) &&
        [
          'interest',
          'goal',
          'expertise',
          'learningArea',
          'leisurePreference',
          'lowValueTopic',
          'contentPreference',
          'historyTopic',
          'historySource',
        ].includes(String(signal.kind)) &&
        ['positive', 'negative', 'neutral'].includes(String(signal.effect)) &&
        boundedString(signal.label, 240) &&
        boundedString(signal.explanation, 420) &&
        probability(signal.confidence) &&
        probability(signal.matchScore)
      );
    })
  ) {
    return false;
  }
  const knowledge = context.knowledgeSignals;
  const knowledgeIsValid =
    knowledge === undefined ||
    (Array.isArray(knowledge) &&
      knowledge.length <= 8 &&
      knowledge.every((value) => {
        if (!value || typeof value !== 'object') return false;
        const signal = value as Record<string, unknown>;
        return (
          boundedString(signal.id, 180) &&
          boundedString(signal.profileEntryId, 180) &&
          ['known', 'learning', 'uncertain'].includes(String(signal.kind)) &&
          boundedString(signal.topic, 240) &&
          boundedString(signal.statement, 500) &&
          (signal.evidenceType === null ||
            ['demonstrated', 'explicitly_stated', 'inferred'].includes(
              String(signal.evidenceType),
            )) &&
          probability(signal.confidence) &&
          probability(signal.matchScore)
        );
      }));
  if (!knowledgeIsValid) return false;
  const history = context.historyEvidence;
  if (history === undefined) return true;
  if (!history || typeof history !== 'object') return false;
  const item = history as Record<string, unknown>;
  return (
    typeof item.exactPageEncountered === 'boolean' &&
    probability(item.encounteredProbability) &&
    probability(item.topicFamiliarity) &&
    probability(item.interestConfidence) &&
    Array.isArray(item.matchingTopics) &&
    item.matchingTopics.length <= 3 &&
    item.matchingTopics.every((topic) => boundedString(topic, 80)) &&
    Array.isArray(item.matchingSources) &&
    item.matchingSources.length <= 2 &&
    item.matchingSources.every((source) => boundedString(source, 180)) &&
    boundedString(item.evidenceUpdatedAt, 64)
  );
}

export interface AnalyzeResponseBody extends UtilityComponents {
  utility: number;
  reason: string;
  recommendation: MaterialDecision;
  estimatedUsefulMinutes: number;
  analyzerVersion: string;
  scenario: AttentionScenario;
  scenarioSignals: ScenarioUtilitySignals;
  insights?: MaterialEvaluationInsights;
}

export function isAnalyzeRequestBody(
  value: unknown,
): value is AnalyzeRequestBody {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).every((key) => REQUEST_KEYS.has(key)) &&
    !('userProfile' in item) &&
    (item.profileContext === null ||
      isRelevantProfileContext(item.profileContext)) &&
    typeof item.title === 'string' &&
    item.title.trim().length > 0 &&
    item.title.length <= 500 &&
    typeof item.url === 'string' &&
    /^https?:\/\//i.test(item.url) &&
    typeof item.articleText === 'string' &&
    item.articleText.trim().length >= 80 &&
    item.articleText.length <= 100_000 &&
    (item.intent === undefined || boundedString(item.intent, 180)) &&
    (item.availableMinutes === undefined ||
      [5, 15, 30].includes(Number(item.availableMinutes))) &&
    (item.scenario === undefined ||
      ['work', 'learn', 'explore', 'relax'].includes(String(item.scenario))) &&
    (item.relaxIntent === undefined ||
      item.relaxIntent === null ||
      [
        'chill',
        'funny',
        'interesting',
        'exciting',
        'familiar',
        'surprise',
      ].includes(String(item.relaxIntent))) &&
    (item.desiredEffort === undefined ||
      item.desiredEffort === null ||
      ['low', 'medium', 'high'].includes(String(item.desiredEffort))) &&
    (item.leisureFormats === undefined ||
      (Array.isArray(item.leisureFormats) &&
        item.leisureFormats.length <= 8 &&
        item.leisureFormats.every((format) => boundedString(format, 80))))
  );
}
