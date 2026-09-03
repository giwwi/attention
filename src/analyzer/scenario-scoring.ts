import type {
  AnalysisContext,
  AttentionScenario,
  MaterialEvaluation,
  PageCapture,
  RelevantProfileContext,
  ScenarioUtilitySignals,
} from '../shared/types';
import { normalizeScore } from './utility';
import { relaxHistoryTasteFit } from '../scenario/relax-history';
import { assessMaterialScenarioFit } from '../scenario/material-activity';

export type ScenarioSignalName = keyof ScenarioUtilitySignals;

export interface ScenarioScoringConfig {
  scenario: AttentionScenario;
  weights: Readonly<Record<ScenarioSignalName, number>>;
  objective: string;
}

const zeroWeights = (): Record<ScenarioSignalName, number> => ({
  relevance: 0,
  novelty: 0,
  quality: 0,
  actionability: 0,
  knowledgeFit: 0,
  timeFit: 0,
  effortFit: 0,
  tasteFit: 0,
  serendipity: 0,
  enjoymentFit: 0,
});

/**
 * MVP assumptions to calibrate through scenario-specific user feedback.
 * Keep the weights here rather than distributing them across analyzers and UI.
 */
export const SCENARIO_SCORING_CONFIGS: Record<
  AttentionScenario,
  ScenarioScoringConfig
> = {
  work: {
    scenario: 'work',
    objective: 'Помочь с текущей задачей или решением',
    weights: {
      ...zeroWeights(),
      relevance: 0.34,
      actionability: 0.25,
      quality: 0.16,
      novelty: 0.11,
      knowledgeFit: 0.09,
      effortFit: 0.05,
    },
  },
  learn: {
    scenario: 'learn',
    objective: 'Закрыть пробел в знаниях на подходящем уровне',
    weights: {
      ...zeroWeights(),
      relevance: 0.11,
      novelty: 0.22,
      quality: 0.2,
      actionability: 0.06,
      knowledgeFit: 0.27,
      effortFit: 0.14,
    },
  },
  explore: {
    scenario: 'explore',
    objective: 'Найти неожиданную, но содержательную связь',
    weights: {
      ...zeroWeights(),
      relevance: 0.13,
      novelty: 0.22,
      quality: 0.13,
      knowledgeFit: 0.05,
      effortFit: 0.04,
      tasteFit: 0.09,
      serendipity: 0.27,
      enjoymentFit: 0.07,
    },
  },
  relax: {
    scenario: 'relax',
    objective: 'Подойти к желаемому отдыху прямо сейчас',
    weights: {
      ...zeroWeights(),
      novelty: 0.1,
      quality: 0.12,
      effortFit: 0.22,
      tasteFit: 0.29,
      enjoymentFit: 0.27,
    },
  },
};

function clamp(value: number): number {
  return normalizeScore(value);
}

export type EstimatedEffort = 'low' | 'medium' | 'high';

export function estimateMaterialEffort(material: PageCapture): EstimatedEffort {
  const text = `${material.title} ${material.excerpt}`.toLocaleLowerCase();
  const demandingMarkers = [
    'proof',
    'theorem',
    'architecture',
    'framework',
    'technical',
    'research',
    'lecture',
    'математ',
    'исследован',
    'архитектур',
    'доказательств',
    'лекци',
  ];
  if (
    material.wordCount >= 3_500 ||
    material.readingTimeMinutes >= 22 ||
    demandingMarkers.some((marker) => text.includes(marker))
  ) {
    return 'high';
  }
  if (material.wordCount >= 1_000 || material.readingTimeMinutes >= 8) {
    return 'medium';
  }
  return 'low';
}

function effortFit(material: PageCapture, context: AnalysisContext): number {
  const actual = estimateMaterialEffort(material);
  const desired =
    context.desiredEffort ??
    (context.scenario === 'learn'
      ? 'medium'
      : context.scenario === 'relax'
        ? 'low'
        : null);
  if (!desired) return 72;
  if (actual === desired) return 100;
  if (
    (actual === 'low' && desired === 'medium') ||
    (actual === 'medium' && desired === 'high')
  ) {
    return 82;
  }
  if (actual === 'high' && desired === 'low') return 18;
  if (actual === 'low' && desired === 'high') return 52;
  return 45;
}

function knowledgeFit(
  novelty: number,
  profileContext: RelevantProfileContext | null,
): number {
  const knowledge = profileContext?.knowledgeSignals ?? [];
  const learning = knowledge.filter((signal) => signal.kind === 'learning');
  const known = knowledge.filter((signal) => signal.kind === 'known');
  const learningStrength = Math.max(
    0,
    ...learning.map((signal) => signal.matchScore * signal.confidence),
  );
  const knownStrength = Math.max(
    0,
    ...known.map((signal) => signal.matchScore * signal.confidence),
  );
  const difficultyMismatch = Math.max(
    0,
    ...(profileContext?.signals ?? [])
      .filter(
        (signal) => signal.kind === 'expertise' && signal.effect === 'negative',
      )
      .map((signal) => signal.matchScore * signal.confidence),
  );
  if (
    learningStrength === 0 &&
    knownStrength === 0 &&
    difficultyMismatch === 0
  ) {
    return clamp(48 + novelty * 0.18);
  }
  return clamp(
    48 +
      learningStrength * 48 +
      novelty * 0.2 -
      knownStrength * (38 - novelty * 0.18) -
      difficultyMismatch * 52,
  );
}

function tasteFit(
  profileContext: RelevantProfileContext | null,
  scenario: AttentionScenario,
): number {
  const signals = profileContext?.signals ?? [];
  const leisure = signals.filter(
    (signal) => signal.kind === 'leisurePreference',
  );
  if (leisure.length === 0) {
    return scenario === 'relax' ? (relaxHistoryTasteFit(signals) ?? 50) : 50;
  }
  const positive = Math.max(
    0,
    ...leisure
      .filter((signal) => signal.effect === 'positive')
      .map((signal) => signal.matchScore * signal.confidence),
  );
  const negative = Math.max(
    0,
    ...leisure
      .filter((signal) => signal.effect === 'negative')
      .map((signal) => signal.matchScore * signal.confidence),
  );
  return clamp(50 + positive * 50 - negative * 58);
}

function serendipity(
  relevance: number,
  novelty: number,
  profileContext: RelevantProfileContext | null,
): number {
  const adjacentInterest = Math.max(
    0,
    ...(profileContext?.signals ?? [])
      .filter(
        (signal) =>
          signal.effect === 'positive' &&
          (signal.kind === 'interest' || signal.kind === 'learningArea'),
      )
      .map((signal) => signal.matchScore * signal.confidence),
  );
  const notTooObvious = 100 - Math.abs(relevance - 58) * 0.7;
  return clamp(novelty * 0.48 + adjacentInterest * 38 + notTooObvious * 0.22);
}

const RELAX_MARKERS: Record<
  NonNullable<AnalysisContext['relaxIntent']>,
  string[]
> = {
  chill: [
    'calm',
    'cozy',
    'slow',
    'relax',
    'ambient',
    'спокой',
    'уют',
    'медлен',
  ],
  funny: ['funny', 'comedy', 'humor', 'joke', 'смеш', 'комед', 'юмор', 'шут'],
  interesting: [
    'interesting',
    'story',
    'essay',
    'history',
    'интерес',
    'истори',
    'эссе',
  ],
  exciting: [
    'exciting',
    'thriller',
    'adventure',
    'dramatic',
    'захваты',
    'приключ',
    'драм',
  ],
  familiar: [
    'classic',
    'favorite',
    'again',
    'recap',
    'классик',
    'любим',
    'снова',
  ],
  surprise: [
    'unexpected',
    'strange',
    'unknown',
    'surprising',
    'неожидан',
    'странн',
    'неизвест',
  ],
};

function enjoymentFit(
  material: PageCapture,
  context: AnalysisContext,
  taste: number,
): number {
  const intent = context.relaxIntent;
  if (!intent) return clamp(50 + (taste - 50) * 0.45);
  const text =
    `${material.title} ${material.excerpt} ${material.headings.join(' ')}`.toLocaleLowerCase();
  const markerMatch = RELAX_MARKERS[intent].some((marker) =>
    text.includes(marker),
  );
  return clamp(45 + (markerMatch ? 38 : 0) + (taste - 50) * 0.38);
}

function relaxExecutionQuality(material: PageCapture): number {
  let score = 52;
  if (material.title.trim()) score += 8;
  if (material.excerpt.trim()) score += 8;
  if (material.wordCount >= 80) score += 6;
  if (material.isArticle) score += 4;
  if (material.extractionMethod !== 'visible-text') score += 4;
  return clamp(score);
}

export function buildScenarioSignals(
  components: MaterialEvaluation['components'],
  material: PageCapture,
  context: AnalysisContext,
  profileContext: RelevantProfileContext | null,
): ScenarioUtilitySignals {
  const taste = tasteFit(profileContext, context.scenario);
  const scenarioFit = assessMaterialScenarioFit(material, context);
  return {
    relevance: scenarioFit.mismatch
      ? Math.min(44, clamp(components.relevance))
      : clamp(components.relevance),
    novelty: clamp(components.novelty),
    quality:
      context.scenario === 'relax'
        ? relaxExecutionQuality(material)
        : clamp(components.quality),
    actionability: scenarioFit.mismatch
      ? Math.min(45, clamp(components.actionability))
      : clamp(components.actionability),
    knowledgeFit: knowledgeFit(components.novelty, profileContext),
    // Reading time affects presentation advice, never the material's value.
    timeFit: 100,
    effortFit: effortFit(material, context),
    tasteFit: taste,
    serendipity: serendipity(
      components.relevance,
      components.novelty,
      profileContext,
    ),
    enjoymentFit: enjoymentFit(material, context, taste),
  };
}

function scenarioNoveltyValue(
  signals: ScenarioUtilitySignals,
  context: AnalysisContext,
): number {
  if (context.scenario !== 'relax') return signals.novelty;
  if (context.relaxIntent === 'familiar') return 100 - signals.novelty;
  if (context.relaxIntent === 'surprise') return signals.novelty;
  return 62;
}

export function calculateScenarioUtility(
  signals: ScenarioUtilitySignals,
  context: AnalysisContext,
): number {
  const config = SCENARIO_SCORING_CONFIGS[context.scenario];
  return clamp(
    (Object.keys(config.weights) as ScenarioSignalName[]).reduce(
      (total, signal) =>
        total +
        (signal === 'novelty'
          ? scenarioNoveltyValue(signals, context)
          : signals[signal]) *
          config.weights[signal],
      0,
    ),
  );
}

export function scenarioExplanation(
  signals: ScenarioUtilitySignals,
  context: AnalysisContext,
  likelyNewClaims = 0,
): string {
  if (context.scenario === 'work') {
    if (signals.relevance >= 72 && signals.actionability >= 65) {
      return 'Подходит к текущей задаче и содержит применимые детали.';
    }
    if (signals.relevance < 45) return 'Слабо связано с текущей задачей.';
    return 'Связь с задачей есть, но практическая отдача пока неочевидна.';
  }
  if (context.scenario === 'learn') {
    if (signals.knowledgeFit >= 70 && likelyNewClaims > 0) {
      return `Подходит по уровню; вероятно, ${likelyNewClaims} новых ${likelyNewClaims === 1 ? 'тезис' : 'тезиса'}.`;
    }
    if (signals.knowledgeFit < 42)
      return 'Уровень материала, вероятно, вам не подходит.';
    return likelyNewClaims > 0
      ? `Возможно, здесь ${likelyNewClaims} новых ${likelyNewClaims === 1 ? 'тезис' : 'тезиса'}, но совпадение по уровню неясно.`
      : 'Новых для вас идей пока не обнаружено.';
  }
  if (context.scenario === 'explore') {
    if (signals.serendipity >= 68)
      return 'Неочевидная, но содержательная связь с вашими интересами.';
    if (signals.novelty >= 68)
      return 'Тема новая, но её ценность для вас пока неясна.';
    return 'Мало признаков неожиданного открытия.';
  }
  if (signals.tasteFit >= 70 && signals.effortFit >= 65) {
    return 'Похоже на подходящий отдых по вкусу и уровню усилий.';
  }
  if (signals.effortFit < 40)
    return 'Вероятно, требует больше усилий, чем хочется сейчас.';
  if (signals.tasteFit === 50)
    return 'О ваших развлекательных предпочтениях пока мало данных.';
  return 'Совпадение с вашим текущим настроением пока неясно.';
}
