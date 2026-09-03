import type {
  AttentionScenario,
  PersonalizationSignalKind,
  RelevantKnowledgeKind,
} from '../shared/types';

/**
 * Scenario is a relevance prior, not an on/off switch. A low value keeps a
 * strong cross-context match available without letting it dominate the
 * signals that normally matter in the current scenario.
 */
export const SCENARIO_SIGNAL_WEIGHTS: Readonly<
  Record<PersonalizationSignalKind, Readonly<Record<AttentionScenario, number>>>
> = {
  goal: { work: 1, learn: 0.4, explore: 0.45, relax: 0.12 },
  interest: { work: 0.85, learn: 0.85, explore: 1, relax: 0.35 },
  expertise: { work: 0.85, learn: 1, explore: 0.65, relax: 0.18 },
  learningArea: { work: 0.4, learn: 1, explore: 0.9, relax: 0.14 },
  leisurePreference: { work: 0.12, learn: 0.18, explore: 0.6, relax: 1 },
  lowValueTopic: { work: 1, learn: 0.85, explore: 0.65, relax: 0.3 },
  contentPreference: { work: 1, learn: 1, explore: 0.8, relax: 0.35 },
  historyTopic: { work: 0.7, learn: 0.75, explore: 1, relax: 0.55 },
  historySource: { work: 0.6, learn: 0.65, explore: 0.8, relax: 0.65 },
};

export const SCENARIO_KNOWLEDGE_WEIGHTS: Readonly<
  Record<RelevantKnowledgeKind, Readonly<Record<AttentionScenario, number>>>
> = {
  known: { work: 0.9, learn: 1, explore: 0.75, relax: 0.18 },
  learning: { work: 0.45, learn: 1, explore: 0.9, relax: 0.14 },
  uncertain: { work: 0.45, learn: 1, explore: 0.9, relax: 0.14 },
};

export function scenarioSignalWeight(
  scenario: AttentionScenario,
  kind: PersonalizationSignalKind,
): number {
  return SCENARIO_SIGNAL_WEIGHTS[kind][scenario];
}

export function scenarioKnowledgeWeight(
  scenario: AttentionScenario,
  kind: RelevantKnowledgeKind,
): number {
  return SCENARIO_KNOWLEDGE_WEIGHTS[kind][scenario];
}
