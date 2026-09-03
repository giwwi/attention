import type {
  AnalysisContext,
  MaterialEvaluation,
  PageCapture,
  PersonalizationSignal,
  RelevantProfileContext,
} from '../shared/types';
import type { Analyzer } from './analyzer';
import { LOCAL_SIGNAL_KIND_WEIGHTS } from './config';
import {
  buildLocalInsights,
  calculateNoveltyScore,
  calculateQualityScore,
} from './assessment';
import { extractKeyClaims } from './claims';
import { finalizeMaterialEvaluation } from './evaluation';
import { calibrateLocalConfidence } from './reliability';
import { textTokens, tokenOverlap } from './text-match';
import { normalizeScore, type UtilityComponents } from './utility';
import { measureAsync } from '../performance/metrics';
import { scenarioSignalWeight } from '../scenario/signal-weights';

function rankSections(
  headings: string[],
  intent: string,
  signals: PersonalizationSignal[],
): string[] {
  const query = [
    intent,
    ...signals
      .filter((signal) => signal.effect === 'positive')
      .map((signal) => signal.label),
  ].join(' ');
  const queryTokens = textTokens(query);
  if (queryTokens.size === 0) return headings.slice(0, 3);

  return headings
    .map((heading, index) => ({
      heading,
      index,
      score: tokenOverlap(queryTokens, textTokens(heading)),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 3)
    .map(({ heading }) => heading);
}

function signalWeight(
  signal: PersonalizationSignal,
  scenario: AnalysisContext['scenario'],
): number {
  const kindWeight = LOCAL_SIGNAL_KIND_WEIGHTS[signal.kind];
  return (
    kindWeight *
    signal.confidence *
    signal.matchScore *
    scenarioSignalWeight(scenario, signal.kind)
  );
}

function utilityScores(
  signals: PersonalizationSignal[],
  scenario: AnalysisContext['scenario'],
): {
  positive: number;
  negative: number;
} {
  return signals.reduce(
    (scores, signal) => {
      if (signal.effect === 'positive')
        scores.positive += signalWeight(signal, scenario);
      if (signal.effect === 'negative')
        scores.negative += signalWeight(signal, scenario);
      return scores;
    },
    { positive: 0, negative: 0 },
  );
}

function strongestSignal(
  signals: PersonalizationSignal[],
  scenario: AnalysisContext['scenario'],
  effect?: PersonalizationSignal['effect'],
): PersonalizationSignal | undefined {
  return signals
    .filter(
      (signal) =>
        signal.effect !== 'neutral' && (!effect || signal.effect === effect),
    )
    .reduce<PersonalizationSignal | undefined>(
      (strongest, signal) =>
        !strongest ||
        signalWeight(signal, scenario) > signalWeight(strongest, scenario)
          ? signal
          : strongest,
      undefined,
    );
}

function shouldSkipMaterial(
  material: PageCapture,
  signals: PersonalizationSignal[],
  scenario: AnalysisContext['scenario'],
): boolean {
  if (!material.isArticle || material.wordCount < 80) return true;
  const utility = utilityScores(signals, scenario);
  if (utility.negative >= 1.25 && utility.negative > utility.positive * 1.2) {
    return true;
  }
  return false;
}

function expectedValue(
  material: PageCapture,
  context: AnalysisContext,
  signals: PersonalizationSignal[],
): string {
  const utility = utilityScores(signals, context.scenario);
  const negative = strongestSignal(signals, context.scenario, 'negative');
  if (
    utility.negative > utility.positive &&
    negative?.kind === 'lowValueTopic'
  ) {
    return 'Вероятна низкая предельная ценность: тема похожа на материалы, которые вы обычно считаете малоценными.';
  }
  if (utility.negative > utility.positive && negative?.kind === 'expertise') {
    return 'Материал может быстро освежить основы, но, вероятно, даст мало нового относительно указанного уровня экспертизы.';
  }
  const goal = signals.find((signal) => signal.kind === 'goal');
  if (goal) {
    return `Материал может помочь продвинуть активную цель «${goal.label}».`;
  }
  const interest = signals.find((signal) => signal.kind === 'interest');
  if (interest) {
    return `Материал развивает отмеченный интерес «${interest.label}», но локальная оценка пока не подтверждает новизну всех тезисов.`;
  }

  const intentTokens = textTokens(context.intent);
  const materialTokens = textTokens(
    [material.title, material.excerpt, ...material.headings].join(' '),
  );
  const overlap = tokenOverlap(intentTokens, materialTokens);
  if (context.intent && overlap === 0) {
    return `По заголовку и описанию нельзя подтвердить прямое совпадение с целью «${context.intent}». Нужен содержательный анализ текста.`;
  }
  if (context.intent && overlap > 0) {
    return `Заголовок и структура пересекаются с целью «${context.intent}». Предварительно материал выглядит релевантным.`;
  }
  return material.excerpt || `Материал посвящён теме «${material.title}».`;
}

function confidenceScore(
  material: PageCapture,
  context: AnalysisContext,
  signals: PersonalizationSignal[],
): number {
  let score = 0.42;
  if (material.isArticle) score += 0.08;
  if (material.extractionMethod === 'readability') score += 0.1;
  if (material.headings.length > 0) score += 0.05;
  if (material.readingTimeMinutes > 0) score += 0.05;

  if (context.intent) {
    const overlap = tokenOverlap(
      textTokens(context.intent),
      textTokens(
        [material.title, material.excerpt, ...material.headings].join(' '),
      ),
    );
    score += overlap > 0 ? 0.08 : -0.1;
  }
  const usefulSignals = signals.filter((signal) => signal.effect !== 'neutral');
  if (usefulSignals.length > 0) {
    score += Math.min(0.12, (usefulSignals[0]?.confidence ?? 0) * 0.12);
  }
  if (
    signals.some((signal) => signal.effect === 'positive') &&
    signals.some((signal) => signal.effect === 'negative')
  ) {
    score -= 0.08;
  }
  return Math.min(0.86, Math.max(0.35, Number(score.toFixed(2))));
}

function localComponents(
  material: PageCapture,
  context: AnalysisContext,
  signals: PersonalizationSignal[],
): UtilityComponents {
  const weighted = utilityScores(signals, context.scenario);
  const positiveSignals = signals.filter(
    (signal) => signal.effect === 'positive',
  );
  const negativeSignals = signals.filter(
    (signal) => signal.effect === 'negative',
  );
  const intentOverlap = context.intent
    ? tokenOverlap(
        textTokens(context.intent),
        textTokens(
          [material.title, material.excerpt, ...material.headings].join(' '),
        ),
      )
    : 0;
  const hasGoal = positiveSignals.some((signal) => signal.kind === 'goal');
  const hasInterest = positiveSignals.some(
    (signal) => signal.kind === 'interest',
  );
  const repetitionRisk = negativeSignals.some(
    (signal) => signal.kind === 'expertise' || signal.kind === 'lowValueTopic',
  );
  const preferenceRisk = negativeSignals.some(
    (signal) => signal.kind === 'contentPreference',
  );

  return {
    relevance: normalizeScore(
      42 +
        Math.min(48, weighted.positive * 15) -
        Math.min(42, weighted.negative * 14) +
        intentOverlap * 30 +
        (hasGoal ? 10 : hasInterest ? 5 : 0),
    ),
    novelty: normalizeScore(
      58 -
        (repetitionRisk ? 34 : 0) -
        (preferenceRisk ? 14 : 0) +
        (material.headings.length >= 4 ? 5 : 0),
    ),
    actionability: normalizeScore(
      43 +
        (hasGoal ? 30 : 0) +
        intentOverlap * 24 +
        (material.headings.length > 0 ? 8 : 0),
    ),
    quality: normalizeScore(
      42 +
        (material.extractionMethod === 'readability' ? 22 : 8) +
        (material.wordCount >= 700 ? 10 : 0) +
        (material.headings.length >= 3 ? 8 : 0) -
        (!material.isArticle ? 25 : 0),
    ),
  };
}

export class LocalAnalyzer implements Analyzer {
  readonly id = 'local-claim-assessment-v4';

  async analyze(
    material: PageCapture,
    context: AnalysisContext,
    profileContext: RelevantProfileContext | null = null,
  ): Promise<MaterialEvaluation> {
    return measureAsync('analysis.local', async () => {
      const signals = profileContext?.signals ?? [];
      const insights = buildLocalInsights(
        material,
        extractKeyClaims(material.content, material.title, material.language),
        profileContext,
      );
      const components = {
        ...localComponents(material, context, signals),
        novelty: calculateNoveltyScore(insights.keyClaims),
        quality: calculateQualityScore(insights.qualityBreakdown),
      };
      const baseConfidence = confidenceScore(material, context, signals);
      const confidence = insights.reliability
        ? calibrateLocalConfidence(baseConfidence, insights.reliability)
        : baseConfidence;
      const recommendedActionOverride =
        context.scenario === 'work' &&
        shouldSkipMaterial(material, signals, context.scenario)
          ? 'skip'
          : undefined;
      const reasonOverride =
        !material.isArticle || material.wordCount < 80
          ? 'Не удалось выделить достаточно содержательного материала для уверенной рекомендации.'
          : undefined;
      return Promise.resolve(
        finalizeMaterialEvaluation({
          analyzerId: this.id,
          material,
          context,
          profileContext,
          components,
          insights,
          expectedValue:
            context.scenario === 'work'
              ? expectedValue(material, context, signals)
              : undefined,
          recommendedSections: rankSections(
            material.headings,
            context.intent,
            signals,
          ),
          confidence,
          recommendedActionOverride,
          reasonOverride,
        }),
      );
    });
  }
}
