import { selectRelevantPersonalContext } from '../history/relevance';
import type { BrowserHistoryEvidence } from '../history/evidence';
import type { ReadwiseEvidence } from '../readwise/evidence';
import type { PersonalProfile } from '../profile/schema';
import {
  DEFAULT_HOVER_CALIBRATION,
  type HoverCalibration,
} from '../memory/material-memory';
import type {
  AnalysisContext,
  HoverPreview,
  HoverPreviewRequest,
  MaterialEvaluation,
  PageCapture,
  PersonalizationSignal,
} from '../shared/types';
import { scenarioSignalWeight } from '../scenario/signal-weights';
import {
  hasRelevantLeisurePreference,
  hasUsefulRelaxHistory,
  relaxHistoryPreviewStrength,
} from '../scenario/relax-history';
import {
  assessLearningMaterialFit,
  assessMaterialScenarioFit,
} from '../scenario/material-activity';

const PREVIEW_CONTEXT: AnalysisContext = {
  intent: '',
  availableMinutes: 15,
  scenario: 'work',
};

function previewCapture(request: HoverPreviewRequest): PageCapture {
  const content = `${request.title}\n${request.snippet}`.trim();
  const wordCount = content.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  let siteName = '';
  try {
    siteName = new URL(request.url).hostname.replace(/^www\./, '');
  } catch {
    siteName = '';
  }
  return {
    title: request.title.trim(),
    url: request.url,
    content,
    excerpt: request.snippet.trim(),
    byline: null,
    siteName,
    publishedTime: null,
    language: null,
    wordCount,
    readingTimeMinutes: Math.max(1, Math.ceil(wordCount / 220)),
    headings: [],
    isArticle: true,
    extractionMethod: 'visible-text',
    capturedAt: new Date().toISOString(),
  };
}

export async function createHoverPreview(
  request: HoverPreviewRequest,
  profile: PersonalProfile | null,
  calibration: HoverCalibration = DEFAULT_HOVER_CALIBRATION,
  context: AnalysisContext = PREVIEW_CONTEXT,
  historyEvidence: BrowserHistoryEvidence | null = null,
  readwiseEvidence: ReadwiseEvidence | null = null,
): Promise<HoverPreview> {
  const capture = previewCapture(request);
  const scenarioFit = assessMaterialScenarioFit(capture, context);
  const relevantProfile = await selectRelevantPersonalContext(
    profile,
    historyEvidence,
    readwiseEvidence,
    null,
    null,
    capture,
    context,
  );
  const signals = relevantProfile?.signals ?? [];
  const preferRelaxHistory =
    context.scenario === 'relax' && hasUsefulRelaxHistory(signals);
  const strongestPositive = strongestSignal(
    signals,
    (signal) =>
      signal.effect === 'positive' &&
      (!preferRelaxHistory ||
        signal.kind === 'historyTopic' ||
        signal.kind === 'historySource'),
    context.scenario,
    signals,
  );
  const strongestNegative = strongestSignal(
    signals,
    (signal) =>
      signal.effect === 'negative' && signal.kind !== 'contentPreference',
    context.scenario,
    signals,
  );
  const positiveStrength = signalStrength(
    strongestPositive,
    context.scenario,
    signals,
  );
  const negativeStrength = signalStrength(
    strongestNegative,
    context.scenario,
    signals,
  );
  const learningFit =
    context.scenario === 'learn'
      ? assessLearningMaterialFit(capture, profile, signals)
      : null;

  let recommendedAction: HoverPreview['recommendedAction'] = 'maybe';
  if (
    negativeStrength >= calibration.negativeThreshold &&
    negativeStrength > positiveStrength + 0.1
  ) {
    recommendedAction = 'skip';
  } else if (
    positiveStrength >= calibration.positiveThreshold &&
    negativeStrength < calibration.negativeThreshold + 0.05
  ) {
    recommendedAction = 'open';
  }
  if (scenarioFit.mismatch) recommendedAction = 'maybe';
  if (learningFit) recommendedAction = learningFit.recommendation;

  const strongestEvidence = Math.max(positiveStrength, negativeStrength);
  const readwise = relevantProfile?.readwiseEvidence;
  return {
    scenario: context.scenario,
    ...(scenarioFit.suggestedScenario
      ? { suggestedScenario: scenarioFit.suggestedScenario }
      : {}),
    utilityScore: null,
    recommendedAction,
    reason:
      scenarioFit.reason ??
      learningFit?.reason ??
      (recommendedAction === 'skip'
        ? strongestNegative?.explanation
        : strongestPositive?.explanation) ??
      (context.scenario === 'relax'
        ? 'По заголовку недостаточно данных о совпадении с вашим вкусом.'
        : context.scenario === 'explore'
          ? 'По заголовку не видно достаточно сильной неожиданной связи.'
          : context.scenario === 'learn'
            ? 'По заголовку неясно, подходит ли материал вашему уровню.'
            : 'По заголовку не видно явной связи с текущей задачей.'),
    expectedValue: scenarioFit.mismatch
      ? 'Подходит скорее для сценария «Учёба»'
      : learningFit
        ? learningFit.expectedValue
        : recommendedAction === 'skip'
          ? 'Новая персональная ценность маловероятна'
          : strongestPositive
            ? context.scenario === 'relax'
              ? 'Похоже на подходящий вам досуг'
              : context.scenario === 'explore'
                ? 'Возможна интересная неожиданная связь'
                : context.scenario === 'learn'
                  ? 'Связь с областью изучения'
                  : strongestPositive.kind === 'goal'
                    ? 'Связь с активной целью'
                    : 'Тема из ваших интересов'
            : 'Персональная ценность пока неясна',
    risk:
      strongestNegative?.explanation ??
      (readwise?.exactSourceMatched
        ? 'Этот источник уже есть в Readwise; конкретная новизна станет ясна после полного анализа.'
        : null) ??
      (strongestPositive
        ? 'Новизна и качество неизвестны до открытия.'
        : 'Данных для уверенного решения пока недостаточно.'),
    confidence: strongestEvidence >= 0.45 ? 'medium' : 'low',
    source: 'title-preview',
    signalIds: signals
      .filter(
        (signal) =>
          signal.effect !== 'neutral' && signal.kind !== 'contentPreference',
      )
      .map((signal) => signal.id)
      .slice(0, 6),
    calibrationSampleSize: calibration.sampleSize,
  };
}

function signalStrength(
  signal: PersonalizationSignal | undefined,
  scenario: AnalysisContext['scenario'],
  signals: PersonalizationSignal[] = [],
): number {
  if (!signal) return 0;
  if (scenario === 'relax' && !hasRelevantLeisurePreference(signals)) {
    const historyStrength = relaxHistoryPreviewStrength(signal, signals);
    if (historyStrength !== null) return historyStrength;
  }
  const baseStrength =
    signal.matchScore *
    signal.confidence *
    scenarioSignalWeight(scenario, signal.kind);

  // A direct overlap with an active goal is stronger evidence than a broad
  // interest match. Calibration can raise the threshold again if the user's
  // subsequent ratings show that these previews are too optimistic.
  if (signal.effect === 'positive' && signal.kind === 'goal') {
    return Math.min(1, baseStrength * 1.6);
  }
  if (signal.effect === 'positive' && signal.kind === 'interest') {
    return Math.min(1, baseStrength * 1.15);
  }
  return baseStrength;
}

function strongestSignal(
  signals: PersonalizationSignal[],
  predicate: (signal: PersonalizationSignal) => boolean,
  scenario: AnalysisContext['scenario'],
  allSignals: PersonalizationSignal[] = signals,
): PersonalizationSignal | undefined {
  return signals
    .filter(predicate)
    .sort(
      (left, right) =>
        signalStrength(right, scenario, allSignals) -
        signalStrength(left, scenario, allSignals),
    )[0];
}

function confidenceLabel(confidence: number): HoverPreview['confidence'] {
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.45) return 'medium';
  return 'low';
}

function fullAnalysisRisk(evaluation: MaterialEvaluation): string {
  const signals = evaluation.scenarioSignals;
  const risksByScenario: Record<
    MaterialEvaluation['scenario'],
    Array<{ score: number; label: string }>
  > = {
    work: [
      { score: signals.relevance, label: 'Слабая связь с текущей задачей.' },
      { score: signals.actionability, label: 'Мало применимых деталей.' },
      {
        score: signals.quality,
        label: 'Качество обоснования вызывает сомнения.',
      },
    ],
    learn: [
      { score: signals.knowledgeFit, label: 'Уровень может вам не подойти.' },
      { score: signals.novelty, label: 'Вероятно мало нового.' },
      {
        score: signals.quality,
        label: 'Объяснение выглядит недостаточно ясным.',
      },
    ],
    explore: [
      {
        score: signals.serendipity,
        label: 'Мало признаков неожиданного открытия.',
      },
      { score: signals.novelty, label: 'Тема может оказаться знакомой.' },
      { score: signals.quality, label: 'Содержание может быть поверхностным.' },
    ],
    relax: [
      { score: signals.tasteFit, label: 'Совпадение с вашим вкусом неясно.' },
      {
        score: signals.enjoymentFit,
        label: 'Может не дать желаемого впечатления.',
      },
      {
        score: signals.effortFit,
        label: 'Может потребовать больше усилий, чем хочется.',
      },
    ],
  };
  const risks = risksByScenario[evaluation.scenario].sort(
    (left, right) => left.score - right.score,
  );
  const lowest = risks[0];
  return lowest && lowest.score < 50
    ? lowest.label
    : 'Существенных рисков полный анализ не обнаружил.';
}

export function createFullAnalysisHoverPreview(
  evaluation: MaterialEvaluation,
): HoverPreview {
  const actionMap: Record<
    MaterialEvaluation['recommendedAction'],
    HoverPreview['recommendedAction']
  > = {
    read: 'open',
    skim: 'maybe',
    save: 'save',
    skip: 'skip',
  };
  return {
    scenario: evaluation.scenario,
    ...(evaluation.suggestedScenario
      ? { suggestedScenario: evaluation.suggestedScenario }
      : {}),
    utilityScore: evaluation.utilityScore,
    recommendedAction: actionMap[evaluation.recommendedAction],
    reason: evaluation.reason,
    expectedValue: evaluation.expectedValue,
    risk: fullAnalysisRisk(evaluation),
    confidence: confidenceLabel(evaluation.confidence),
    source: 'full-analysis',
    signalIds: evaluation.profileSignals.map((signal) => signal.id).slice(0, 6),
    calibrationSampleSize: 0,
    components: evaluation.components,
    scenarioSignals: evaluation.scenarioSignals,
    estimatedUsefulMinutes: evaluation.estimatedUsefulMinutes,
    recommendedSections: evaluation.recommendedSections,
    ...(evaluation.insights ? { insights: evaluation.insights } : {}),
  };
}

export { previewCapture };
