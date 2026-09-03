import { textMatchScore } from '../analyzer/text-match';
import type {
  AnalysisContext,
  PersonalizationSignal,
  RelevantKnowledgeSignal,
  RelevantProfileContext,
  PageCapture,
} from '../shared/types';
import type { PersonalProfile } from './schema';
import type { MaterialFeatures } from '../analyzer/material-features';
import {
  scenarioKnowledgeWeight,
  scenarioSignalWeight,
} from '../scenario/signal-weights';
import {
  cefrLevelRank,
  extractCefrRange,
  extractCefrLevels,
  highestCefrLevel,
} from '../scenario/material-activity';

const BEGINNER_MARKERS = [
  'beginner',
  'beginners',
  'introduction',
  'introductory',
  'getting started',
  'explained simply',
  '101',
  'для начинающих',
  'введение',
  'вводный',
  'вводная',
  'основы',
  'простыми словами',
  'с нуля',
];

const ADVANCED_MARKERS = [
  'advanced',
  'proof',
  'theorem',
  'formalism',
  'graduate',
  'research paper',
  'продвинут',
  'доказательство',
  'теорема',
  'формализм',
  'исследовательская статья',
];

const preferenceLabels = {
  low: 'низкая',
  medium: 'средняя',
  high: 'высокая',
} as const;

function materialText(
  material: PageCapture,
  context: AnalysisContext,
  features?: MaterialFeatures,
): string {
  return [
    features?.matchingText ??
      [
        material.title,
        material.excerpt,
        ...material.headings,
        material.content.slice(0, 14_000),
      ].join(' '),
    context.intent,
  ].join(' ');
}

function isLikelyBeginnerMaterial(
  material: PageCapture,
  features?: MaterialFeatures,
): boolean {
  const summary = (
    features?.headingSummary ??
    [material.title, material.excerpt, ...material.headings].join(' ')
  ).toLocaleLowerCase();
  return BEGINNER_MARKERS.some((marker) => summary.includes(marker));
}

function isLikelyAdvancedMaterial(
  material: PageCapture,
  features?: MaterialFeatures,
): boolean {
  const summary = (
    features?.headingSummary ??
    [material.title, material.excerpt, ...material.headings].join(' ')
  ).toLocaleLowerCase();
  return (
    material.wordCount >= 3_500 ||
    ADVANCED_MARKERS.some((marker) => summary.includes(marker))
  );
}

function signalId(
  kind: PersonalizationSignal['kind'],
  profileEntryId: string,
): string {
  return `${kind}:${profileEntryId}`;
}

export function selectRelevantProfileContext(
  profile: PersonalProfile | null,
  material: PageCapture,
  context: AnalysisContext,
  features?: MaterialFeatures,
): RelevantProfileContext | null {
  if (!profile) return null;
  const target = materialText(material, context, features);
  const beginnerMaterial = isLikelyBeginnerMaterial(material, features);
  const advancedMaterial = isLikelyAdvancedMaterial(material, features);
  const materialHeadingSummary =
    features?.headingSummary ??
    [material.title, material.excerpt, ...material.headings].join(' ');
  const materialRange = extractCefrRange(materialHeadingSummary);
  const materialLevel = materialRange?.maximum ?? null;
  const requestedLevels = extractCefrLevels(context.intent);
  const ranked: Array<PersonalizationSignal & { rank: number }> = [];
  const knowledgeRanked: Array<RelevantKnowledgeSignal & { rank: number }> = [];

  for (const goal of profile.goals) {
    if (goal.status !== 'active') continue;
    const match = textMatchScore(goal.goal, target);
    if (match === 0) continue;
    const priority =
      goal.priority === 'high' ? 1 : goal.priority === 'medium' ? 0.8 : 0.6;
    ranked.push({
      id: signalId('goal', goal.id),
      profileEntryId: goal.id,
      kind: 'goal',
      effect: 'positive',
      label: goal.goal,
      explanation: `Материал пересекается с активной целью «${goal.goal}».`,
      confidence: goal.confidence,
      matchScore: match,
      rank:
        match *
        priority *
        goal.confidence *
        1.5 *
        scenarioSignalWeight(context.scenario, 'goal'),
    });
  }

  for (const interest of profile.interests) {
    const match = textMatchScore(interest.topic, target);
    if (match === 0) continue;
    ranked.push({
      id: signalId('interest', interest.id),
      profileEntryId: interest.id,
      kind: 'interest',
      effect: 'positive',
      label: interest.topic,
      explanation: `Тема совпадает с интересом «${interest.topic}».`,
      confidence: interest.confidence,
      matchScore: match,
      rank:
        match *
        interest.strength *
        interest.confidence *
        scenarioSignalWeight(context.scenario, 'interest'),
    });
  }

  for (const learning of profile.learningAreas ?? []) {
    const label = learning.focus
      ? `${learning.topic}: ${learning.focus}`
      : learning.topic;
    const match = textMatchScore(label, target);
    if (match === 0) continue;
    ranked.push({
      id: signalId('learningArea', learning.id),
      profileEntryId: learning.id,
      kind: 'learningArea',
      effect: 'positive',
      label,
      explanation: `Материал пересекается с областью изучения «${label}».`,
      confidence: learning.confidence,
      matchScore: match,
      rank:
        match *
        learning.confidence *
        1.25 *
        scenarioSignalWeight(context.scenario, 'learningArea'),
    });
  }

  for (const preference of profile.leisureProfile.preferences) {
    const match = textMatchScore(preference.category, target);
    if (match === 0) continue;
    const negative =
      preference.kind === 'dislike' || preference.preference === 'low';
    const positive =
      preference.preference === 'high' || preference.preference === 'medium';
    ranked.push({
      id: signalId('leisurePreference', preference.id),
      profileEntryId: preference.id,
      kind: 'leisurePreference',
      effect: negative ? 'negative' : positive ? 'positive' : 'neutral',
      label: preference.category,
      explanation: negative
        ? `Не совпадает с вашим вкусом: «${preference.category}».`
        : `Похоже на досуг, который вам нравится: «${preference.category}».`,
      confidence: preference.confidence,
      matchScore: match,
      rank:
        match *
        preference.confidence *
        1.5 *
        scenarioSignalWeight(context.scenario, 'leisurePreference'),
    });
  }

  for (const item of profile.lowValueTopics) {
    const match = textMatchScore(item.topic, target);
    if (match < 0.5) continue;
    ranked.push({
      id: signalId('lowValueTopic', item.id),
      profileEntryId: item.id,
      kind: 'lowValueTopic',
      effect: 'negative',
      label: item.topic,
      explanation: `Материал похож на отмеченную малоценную тему «${item.topic}».`,
      confidence: item.confidence,
      matchScore: match,
      rank:
        match *
        item.confidence *
        1.2 *
        scenarioSignalWeight(context.scenario, 'lowValueTopic'),
    });
  }

  for (const expertise of profile.expertise) {
    const match = textMatchScore(expertise.topic, target);
    if (match === 0) continue;
    const profileLevel = highestCefrLevel(
      [expertise.topic, ...expertise.basis].join(' '),
    );
    const explicitLevelRequest =
      materialLevel !== null && requestedLevels.includes(materialLevel);
    const cefrMismatch =
      materialRange !== null &&
      profileLevel !== null &&
      cefrLevelRank(materialRange.maximum) < cefrLevelRank(profileLevel) &&
      !explicitLevelRequest;
    const likelyRepetition =
      beginnerMaterial &&
      (expertise.level === 'advanced' || expertise.level === 'expert');
    const likelyTooAdvanced =
      advancedMaterial && expertise.level === 'beginner';
    ranked.push({
      id: signalId('expertise', expertise.id),
      profileEntryId: expertise.id,
      kind: 'expertise',
      effect:
        likelyRepetition || likelyTooAdvanced || cefrMismatch
          ? 'negative'
          : 'neutral',
      label: expertise.topic,
      explanation: cefrMismatch
        ? `Материал рассчитан примерно на ${materialLevel}, а профиль указывает уровень ${profileLevel} в теме «${expertise.topic}». Вероятно, он будет слишком базовым.`
        : likelyRepetition
          ? `Материал выглядит вводным, а профиль указывает широкую экспертизу в теме «${expertise.topic}». Это может быть повторением знакомого.`
          : likelyTooAdvanced
            ? `Материал выглядит продвинутым, а профиль указывает начальный уровень в теме «${expertise.topic}».`
            : `Тема связана с широкой экспертизой «${expertise.topic}». Это не означает знание каждого тезиса материала.`,
      confidence: expertise.confidence,
      matchScore: cefrMismatch ? Math.max(match, 0.85) : match,
      rank:
        (cefrMismatch ? Math.max(match, 0.85) : match) *
        expertise.confidence *
        (cefrMismatch
          ? 1.65
          : likelyRepetition || likelyTooAdvanced
            ? 1.15
            : 0.7) *
        scenarioSignalWeight(context.scenario, 'expertise'),
    });
  }

  ranked.sort((left, right) => right.rank - left.rank);
  const signals: PersonalizationSignal[] = ranked.slice(0, 5).map((item) => ({
    id: item.id,
    profileEntryId: item.profileEntryId,
    kind: item.kind,
    effect: item.effect,
    label: item.label,
    explanation: item.explanation,
    confidence: item.confidence,
    matchScore: item.matchScore,
  }));

  if (
    profile.contentPreferences &&
    scenarioSignalWeight(context.scenario, 'contentPreference') >= 0.3
  ) {
    const preferences = profile.contentPreferences;
    const depthMismatch =
      preferences.preferredDepth === 'high' && material.wordCount < 700;
    const noveltyMismatch =
      preferences.noveltyPreference === 'high' &&
      beginnerMaterial &&
      signals.some((signal) => signal.kind === 'expertise');
    const explanationParts = [
      `предпочитаемая глубина — ${preferenceLabels[preferences.preferredDepth]}`,
      `новизна — ${preferenceLabels[preferences.noveltyPreference]}`,
    ];
    if (preferences.avoidRepetition)
      explanationParts.push('повторы нежелательны');
    signals.push({
      id: 'contentPreference:global',
      profileEntryId: null,
      kind: 'contentPreference',
      effect: depthMismatch || noveltyMismatch ? 'negative' : 'neutral',
      label: 'Предпочтения по материалам',
      explanation: `Учитываются настройки: ${explanationParts.join(', ')}.${
        depthMismatch ? ' Материал короче предпочитаемой глубины.' : ''
      }`,
      confidence: preferences.confidence,
      matchScore: 1,
    });
  }

  const evidenceWeight = {
    demonstrated: 1,
    explicitly_stated: 0.82,
    inferred: 0.55,
  } as const;
  for (const knowledge of profile.demonstratedKnowledge ?? []) {
    const match = textMatchScore(
      `${knowledge.topic} ${knowledge.statement}`,
      target,
    );
    if (match === 0) continue;
    knowledgeRanked.push({
      id: `known:${knowledge.id}`,
      profileEntryId: knowledge.id,
      kind: 'known',
      topic: knowledge.topic,
      statement: knowledge.statement,
      evidenceType: knowledge.evidenceType,
      confidence: knowledge.confidence,
      matchScore: match,
      rank:
        match *
        knowledge.confidence *
        evidenceWeight[knowledge.evidenceType] *
        scenarioKnowledgeWeight(context.scenario, 'known'),
    });
  }
  for (const learning of profile.learningAreas ?? []) {
    const statement = learning.focus ?? learning.topic;
    const match = textMatchScore(`${learning.topic} ${statement}`, target);
    if (match === 0) continue;
    knowledgeRanked.push({
      id: `learning:${learning.id}`,
      profileEntryId: learning.id,
      kind: 'learning',
      topic: learning.topic,
      statement,
      evidenceType: null,
      confidence: learning.confidence,
      matchScore: match,
      rank:
        match *
        learning.confidence *
        0.9 *
        scenarioKnowledgeWeight(context.scenario, 'learning'),
    });
  }
  for (const uncertainty of profile.uncertainties ?? []) {
    const match = textMatchScore(
      `${uncertainty.topic} ${uncertainty.note}`,
      target,
    );
    if (match === 0) continue;
    knowledgeRanked.push({
      id: `uncertain:${uncertainty.id}`,
      profileEntryId: uncertainty.id,
      kind: 'uncertain',
      topic: uncertainty.topic,
      statement: uncertainty.note,
      evidenceType: null,
      confidence: uncertainty.confidence,
      matchScore: match,
      rank:
        match *
        uncertainty.confidence *
        0.7 *
        scenarioKnowledgeWeight(context.scenario, 'uncertain'),
    });
  }
  knowledgeRanked.sort((left, right) => right.rank - left.rank);

  return {
    profileUpdatedAt: profile.updatedAt,
    signals: signals.slice(0, 6),
    knowledgeSignals: knowledgeRanked.slice(0, 8).map((item) => ({
      id: item.id,
      profileEntryId: item.profileEntryId,
      kind: item.kind,
      topic: item.topic,
      statement: item.statement,
      evidenceType: item.evidenceType,
      confidence: item.confidence,
      matchScore: item.matchScore,
    })),
  };
}
