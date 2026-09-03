import { createAnalyzer } from '../../analyzer';
import type { AiAnalyzerSettings } from '../../analyzer/settings';
import { recordDiagnostic } from '../../diagnostics/diagnostics';
import {
  findMaterialMemory,
  recordMaterialEvaluation,
} from '../../memory/material-memory';
import {
  applyAndStoreSignalFeedback,
  recordProfileFeedback,
} from '../../profile/feedback';
import { selectRelevantPersonalContext } from '../../history/relevance';
import { loadBrowserHistoryEvidence } from '../../history/storage';
import { loadReadwiseEvidence } from '../../readwise/storage';
import { loadObsidianEvidence } from '../../obsidian/evidence';
import { loadNotionEvidence } from '../../notion/evidence';
import { loadProfile } from '../../profile/storage';
import {
  createEvaluationCacheVersion,
  isEvaluationCacheCurrent,
  loadEvaluationSourceVersions,
} from '../../analyzer/evaluation-cache';
import { buildMaterialFeatures } from '../../analyzer/material-features';
import { loadNovelPassageFeedback } from '../../novelty/feedback';
import { calibrateMaterialEvaluation } from '../../utility/calibration';
import { loadUtilityCalibration } from '../../utility/storage';
import type {
  AnalysisContext,
  AttentionScenario,
  MaterialDecision,
  MaterialEvaluation,
  PageCapture,
  PersonalizationSignal,
  ProfileFeedbackType,
  StoredEvaluation,
} from '../../shared/types';
import { getElement, setPopupStatus } from '../dom';
import { isStoredEvaluation } from '../guards';
import {
  ANALYSIS_CONTEXT_KEY,
  EVALUATION_VERDICTS_KEY,
  LATEST_EVALUATION_KEY,
} from '../storage-keys';

export interface EvaluationControllerOptions {
  status: HTMLParagraphElement;
  decisionButtons: HTMLButtonElement[];
  getCapture: () => PageCapture | null;
  getContext: () => AnalysisContext;
  getScenario: () => AttentionScenario;
  getAiSettings: () => AiAnalyzerSettings | null;
  refreshAiSettings: () => Promise<AiAnalyzerSettings | null>;
  applyContext: (context: AnalysisContext) => void;
  refreshProfile: () => Promise<void> | void;
}

const recommendationLabels: Record<MaterialDecision, string> = {
  read: 'READ',
  skim: 'SKIM',
  save: 'SAVE',
  skip: 'SKIP',
};

const signalKindLabels: Record<PersonalizationSignal['kind'], string> = {
  interest: 'Интерес',
  goal: 'Активная цель',
  expertise: 'Широкая экспертиза',
  learningArea: 'Что изучаете',
  leisurePreference: 'Предпочтение для отдыха',
  lowValueTopic: 'Малоценная тема',
  contentPreference: 'Предпочтение',
  historyTopic: 'Недавняя тема',
  historySource: 'Знакомый источник',
};

function confidenceLabel(value: number): string {
  if (value < 0.55) return 'Низкая уверенность';
  if (value < 0.7) return 'Средняя уверенность';
  return 'Уверенность выше средней';
}

function isAiEvaluation(evaluation: MaterialEvaluation): boolean {
  return evaluation.analyzerId.startsWith('ai-gateway-');
}

export class EvaluationController {
  private readonly analyzeButton = getElement<HTMLButtonElement>('analyze');
  private readonly panel = getElement<HTMLElement>('evaluation');
  private readonly recommendation =
    getElement<HTMLHeadingElement>('recommendation');
  private readonly utilityScore = getElement<HTMLElement>('utility-score');
  private readonly usefulMinutes =
    getElement<HTMLParagraphElement>('useful-minutes');
  private readonly metricValues = [
    getElement<HTMLElement>('score-relevance'),
    getElement<HTMLElement>('score-novelty'),
    getElement<HTMLElement>('score-actionability'),
    getElement<HTMLElement>('score-quality'),
  ];
  private readonly metricLabels = [
    getElement<HTMLElement>('label-relevance'),
    getElement<HTMLElement>('label-novelty'),
    getElement<HTMLElement>('label-actionability'),
    getElement<HTMLElement>('label-quality'),
  ];
  private readonly assessmentInsights = getElement<HTMLElement>(
    'assessment-insights',
  );
  private readonly noveltyConfidence =
    getElement<HTMLElement>('novelty-confidence');
  private readonly noveltySummary =
    getElement<HTMLParagraphElement>('novelty-summary');
  private readonly likelyNewBlock = getElement<HTMLElement>('likely-new-block');
  private readonly likelyNewClaims =
    getElement<HTMLUListElement>('likely-new-claims');
  private readonly qualityConfidence =
    getElement<HTMLElement>('quality-confidence');
  private readonly qualitySummary =
    getElement<HTMLParagraphElement>('quality-summary');
  private readonly qualityEvidence =
    getElement<HTMLElement>('quality-evidence');
  private readonly qualityReasoning =
    getElement<HTMLElement>('quality-reasoning');
  private readonly qualitySpecificity = getElement<HTMLElement>(
    'quality-specificity',
  );
  private readonly qualityCalibration = getElement<HTMLElement>(
    'quality-calibration',
  );
  private readonly qualityLimitation =
    getElement<HTMLParagraphElement>('quality-limitation');
  private readonly confidence = getElement<HTMLSpanElement>('confidence');
  private readonly reason = getElement<HTMLParagraphElement>('reason');
  private readonly expectedValue =
    getElement<HTMLParagraphElement>('expected-value');
  private readonly recommendedSectionsBlock = getElement<HTMLElement>(
    'recommended-sections-block',
  );
  private readonly recommendedSections = getElement<HTMLUListElement>(
    'recommended-sections',
  );
  private readonly profileSignalsBlock = getElement<HTMLElement>(
    'profile-signals-block',
  );
  private readonly profileSignals = getElement<HTMLElement>('profile-signals');
  private readonly wrongButton = getElement<HTMLButtonElement>(
    'wrong-recommendation',
  );
  private readonly analyzerLabel =
    getElement<HTMLParagraphElement>('analyzer-label');
  private readonly usefulButton =
    getElement<HTMLButtonElement>('evaluation-useful');
  private readonly notUsefulButton = getElement<HTMLButtonElement>(
    'evaluation-not-useful',
  );
  private activeEvaluation: MaterialEvaluation | null = null;

  constructor(private readonly options: EvaluationControllerOptions) {
    this.analyzeButton.addEventListener('click', () => void this.analyze());
    this.wrongButton.addEventListener(
      'click',
      () => void this.markRecommendationWrong(),
    );
    this.usefulButton.addEventListener(
      'click',
      () => void this.recordVerdict(true),
    );
    this.notUsefulButton.addEventListener(
      'click',
      () => void this.recordVerdict(false),
    );
  }

  get current(): MaterialEvaluation | null {
    return this.activeEvaluation;
  }

  clear(): void {
    this.activeEvaluation = null;
    this.panel.hidden = true;
    this.assessmentInsights.hidden = true;
    this.wrongButton.disabled = false;
    this.wrongButton.textContent = 'Рекомендация была неверной';
    this.usefulButton.removeAttribute('data-selected');
    this.notUsefulButton.removeAttribute('data-selected');
    for (const button of this.options.decisionButtons) {
      button.removeAttribute('data-recommended');
    }
  }

  async restore(pageUrl: string): Promise<void> {
    const capture = this.options.getCapture();
    if (!capture || capture.url !== pageUrl) return;
    const context = this.options.getContext();
    const [profile, features] = await Promise.all([
      loadProfile(),
      buildMaterialFeatures(capture),
    ]);
    const sourceVersions = await loadEvaluationSourceVersions(profile);
    const remembered = await findMaterialMemory(pageUrl);
    if (
      remembered?.storedEvaluation &&
      isEvaluationCacheCurrent(
        remembered.storedEvaluation,
        sourceVersions,
        context,
        features,
      )
    ) {
      this.options.applyContext(remembered.storedEvaluation.context);
      this.render(remembered.storedEvaluation.evaluation);
      return;
    }
    const stored = await chrome.storage.local.get(LATEST_EVALUATION_KEY);
    const value: unknown = stored[LATEST_EVALUATION_KEY];
    if (!isStoredEvaluation(value) || value.url !== pageUrl) return;
    if (!isEvaluationCacheCurrent(value, sourceVersions, context, features)) {
      return;
    }

    this.options.applyContext(value.context);
    this.render(value.evaluation);
  }

  private render(evaluation: MaterialEvaluation): void {
    this.activeEvaluation = evaluation;
    this.utilityScore.textContent = `${evaluation.utilityScore}%`;
    this.recommendation.textContent =
      recommendationLabels[evaluation.recommendedAction];
    this.recommendation.dataset.action = evaluation.recommendedAction;
    this.confidence.textContent = confidenceLabel(evaluation.confidence);
    this.usefulMinutes.textContent = evaluation.estimatedUsefulMinutes
      ? `~${evaluation.estimatedUsefulMinutes} потенциально полезных мин`
      : 'Полезное время пока нельзя оценить';

    const signals = evaluation.scenarioSignals;
    const metrics: Record<AttentionScenario, Array<[string, number]>> = {
      work: [
        ['Релевантность', signals.relevance],
        ['Практичность', signals.actionability],
        ['Качество', signals.quality],
        ['Новизна', signals.novelty],
      ],
      learn: [
        ['Уровень', signals.knowledgeFit],
        ['Новизна', signals.novelty],
        ['Качество', signals.quality],
        ['Усилие', signals.effortFit],
      ],
      explore: [
        ['Открытие', signals.serendipity],
        ['Новизна', signals.novelty],
        ['Качество', signals.quality],
        ['Связь', signals.relevance],
      ],
      relax: [
        ['По вкусу', signals.tasteFit],
        ['Удовольствие', signals.enjoymentFit],
        ['Лёгкость', signals.effortFit],
        ['По времени', signals.timeFit],
      ],
    };
    metrics[evaluation.scenario].forEach(([label, value], index) => {
      this.metricLabels[index]!.textContent = label;
      this.metricValues[index]!.textContent = String(value);
    });

    this.likelyNewClaims.replaceChildren();
    if (evaluation.insights && evaluation.scenario !== 'relax') {
      const insights = evaluation.insights;
      this.noveltyConfidence.textContent = `уверенность ${Math.round(insights.noveltyConfidence * 100)}%`;
      this.noveltySummary.textContent = insights.noveltySummary;
      for (const claim of insights.likelyNewClaims.slice(0, 3)) {
        const item = document.createElement('li');
        item.textContent = claim;
        this.likelyNewClaims.append(item);
      }
      this.likelyNewBlock.hidden = insights.likelyNewClaims.length === 0;
      this.qualityConfidence.textContent = `уверенность ${Math.round(insights.qualityConfidence * 100)}%`;
      this.qualitySummary.textContent = insights.qualitySummary;
      this.qualityEvidence.textContent = String(
        insights.qualityBreakdown.evidence,
      );
      this.qualityReasoning.textContent = String(
        insights.qualityBreakdown.reasoning,
      );
      this.qualitySpecificity.textContent = String(
        insights.qualityBreakdown.specificity,
      );
      this.qualityCalibration.textContent = String(
        insights.qualityBreakdown.calibration,
      );
      this.qualityLimitation.textContent = insights.qualityLimitations[0]
        ? `Ограничение: ${insights.qualityLimitations[0]}`
        : '';
      this.qualityLimitation.hidden = !insights.qualityLimitations[0];
      this.assessmentInsights.hidden = false;
    } else {
      this.assessmentInsights.hidden = true;
    }

    this.reason.textContent = evaluation.reason;
    this.expectedValue.textContent = evaluation.expectedValue;
    this.recommendedSections.replaceChildren();
    for (const section of evaluation.recommendedSections) {
      const item = document.createElement('li');
      item.textContent = section;
      this.recommendedSections.append(item);
    }
    this.recommendedSectionsBlock.hidden =
      evaluation.recommendedSections.length === 0;
    this.renderProfileSignals(evaluation.profileSignals ?? []);
    this.wrongButton.disabled = false;
    this.wrongButton.textContent = 'Рекомендация была неверной';
    const aiSettings = this.options.getAiSettings();
    this.analyzerLabel.textContent = isAiEvaluation(evaluation)
      ? `AI-анализ · ${aiSettings?.model ?? 'выбранная модель'} · через Vercel AI Gateway`
      : aiSettings
        ? 'Локальный fallback · AI был недоступен'
        : 'Локальный анализ · без передачи данных';

    for (const button of this.options.decisionButtons) {
      if (button.dataset.decision === evaluation.recommendedAction) {
        button.dataset.recommended = 'true';
      } else {
        button.removeAttribute('data-recommended');
      }
    }
    this.panel.hidden = false;
  }

  private renderProfileSignals(signals: PersonalizationSignal[]): void {
    this.profileSignals.replaceChildren();
    for (const signal of signals) {
      const card = document.createElement('article');
      card.className = 'profile-signal';
      card.dataset.effect = signal.effect;
      const top = document.createElement('div');
      const kind = document.createElement('span');
      kind.className = 'profile-signal-kind';
      kind.textContent = signalKindLabels[signal.kind];
      const confidence = document.createElement('span');
      confidence.className = 'profile-signal-confidence';
      confidence.textContent = `${Math.round(signal.confidence * 100)}%`;
      top.append(kind, confidence);
      const title = document.createElement('strong');
      title.textContent = signal.label;
      const explanation = document.createElement('p');
      explanation.textContent = signal.explanation;
      const correction = document.createElement('details');
      correction.className = 'profile-signal-correction';
      const summary = document.createElement('summary');
      summary.textContent = 'Исправить контекст';
      const actions = document.createElement('div');
      actions.className = 'profile-signal-actions';
      const affirm = document.createElement('button');
      affirm.type = 'button';
      affirm.textContent = 'Это про меня';
      affirm.addEventListener('click', () => {
        void this.handleSignalFeedback(
          signal,
          'affirmSignal',
          card,
          explanation,
        );
      });
      const ignore = document.createElement('button');
      ignore.type = 'button';
      ignore.textContent = 'Не учитывать';
      ignore.addEventListener('click', () => {
        void this.handleSignalFeedback(
          signal,
          'ignoreSignal',
          card,
          explanation,
        );
      });
      actions.append(affirm, ignore);
      correction.append(summary, actions);
      card.append(top, title, explanation);
      if (
        signal.profileEntryId !== null &&
        signal.kind !== 'historyTopic' &&
        signal.kind !== 'historySource'
      ) {
        card.append(correction);
      }
      this.profileSignals.append(card);
    }
    this.profileSignalsBlock.hidden = signals.length === 0;
  }

  private async handleSignalFeedback(
    signal: PersonalizationSignal,
    type: Extract<ProfileFeedbackType, 'affirmSignal' | 'ignoreSignal'>,
    card: HTMLElement,
    explanation: HTMLParagraphElement,
  ): Promise<void> {
    const capture = this.options.getCapture();
    if (!capture || !this.activeEvaluation) return;
    for (const button of card.querySelectorAll('button'))
      button.disabled = true;
    try {
      const profile = await loadProfile();
      if (profile) await applyAndStoreSignalFeedback(profile, signal, type);
      await recordProfileFeedback({
        type,
        url: capture.url,
        recommendedAction: this.activeEvaluation.recommendedAction,
        signalId: signal.id,
        profileEntryId: signal.profileEntryId,
      });
      explanation.textContent =
        type === 'affirmSignal'
          ? 'Подтверждено вами. Уверенность этого пункта повышена.'
          : 'Пункт удалён из профиля. Запустите оценку снова, чтобы обновить рекомендацию.';
      card.dataset.feedback = type;
      await this.options.refreshProfile();
      setPopupStatus(
        this.options.status,
        'success',
        type === 'affirmSignal'
          ? 'Профиль уточнён по вашей обратной связи.'
          : 'Пункт больше не будет учитываться.',
      );
    } catch {
      for (const button of card.querySelectorAll('button')) {
        button.disabled = false;
      }
      setPopupStatus(
        this.options.status,
        'error',
        'Не удалось сохранить обратную связь.',
      );
    }
  }

  private async markRecommendationWrong(): Promise<void> {
    const capture = this.options.getCapture();
    if (!capture || !this.activeEvaluation) return;
    this.wrongButton.disabled = true;
    try {
      await recordProfileFeedback({
        type: 'wrongRecommendation',
        url: capture.url,
        recommendedAction: this.activeEvaluation.recommendedAction,
        signalId: null,
        profileEntryId: null,
      });
      this.wrongButton.textContent = 'Отметка сохранена';
      setPopupStatus(
        this.options.status,
        'success',
        'Спасибо. Ошибка рекомендации сохранена локально.',
      );
    } catch {
      this.wrongButton.disabled = false;
      setPopupStatus(
        this.options.status,
        'error',
        'Не удалось сохранить обратную связь.',
      );
    }
  }

  private async recordVerdict(useful: boolean): Promise<void> {
    const capture = this.options.getCapture();
    if (!capture || !this.activeEvaluation) return;
    const stored = await chrome.storage.local.get(EVALUATION_VERDICTS_KEY);
    const previous = Array.isArray(stored[EVALUATION_VERDICTS_KEY])
      ? stored[EVALUATION_VERDICTS_KEY]
      : [];
    await chrome.storage.local.set({
      [EVALUATION_VERDICTS_KEY]: [
        {
          url: capture.url,
          scenario: this.activeEvaluation.scenario,
          predictedUtility: this.activeEvaluation.utilityScore,
          useful,
          recordedAt: new Date().toISOString(),
        },
        ...previous,
      ].slice(0, 200),
    });
    this.usefulButton.dataset.selected = String(useful);
    this.notUsefulButton.dataset.selected = String(!useful);
    setPopupStatus(
      this.options.status,
      'success',
      'Оценка рекомендации сохранена локально.',
    );
  }

  private async analyze(): Promise<void> {
    const capture = this.options.getCapture();
    if (!capture) return;
    this.analyzeButton.disabled = true;
    const originalLabel = this.analyzeButton.textContent;
    this.analyzeButton.textContent = 'Оцениваем…';
    setPopupStatus(
      this.options.status,
      'default',
      this.options.getAiSettings()
        ? 'AI сопоставляет материал с вашим контекстом…'
        : 'Сопоставляем материал с вашим контекстом…',
    );

    try {
      const aiSettings = await this.options.refreshAiSettings();
      const context = this.options.getContext();
      const [profile, features] = await Promise.all([
        loadProfile(),
        buildMaterialFeatures(capture),
      ]);
      const [
        historyEvidence,
        readwiseEvidence,
        obsidianEvidence,
        notionEvidence,
        claimMemory,
        sourceVersions,
        utilityCalibration,
      ] = await Promise.all([
        loadBrowserHistoryEvidence(),
        loadReadwiseEvidence(),
        loadObsidianEvidence(),
        loadNotionEvidence(),
        loadNovelPassageFeedback(),
        loadEvaluationSourceVersions(profile),
        loadUtilityCalibration(),
      ]);
      const relevantProfile = await selectRelevantPersonalContext(
        profile,
        historyEvidence,
        readwiseEvidence,
        obsidianEvidence,
        notionEvidence,
        capture,
        context,
        claimMemory,
        features,
      );
      const analyzer = createAnalyzer(aiSettings, (error) =>
        recordDiagnostic({
          subsystem: 'ai',
          operation: 'analyze-article',
          code: 'AI_PRIMARY_FAILED_LOCAL_FALLBACK',
          severity: 'warning',
          error,
        }),
      );
      const evaluation = calibrateMaterialEvaluation(
        await analyzer.analyze(capture, context, relevantProfile),
        capture.readingTimeMinutes,
        utilityCalibration,
      );
      const storedEvaluation: StoredEvaluation = {
        url: capture.url,
        context,
        evaluation,
        cacheVersion: createEvaluationCacheVersion(
          features,
          context,
          sourceVersions,
        ),
      };
      await chrome.storage.local.set({
        [ANALYSIS_CONTEXT_KEY]: context,
        [LATEST_EVALUATION_KEY]: storedEvaluation,
      });
      await recordMaterialEvaluation(storedEvaluation, capture.title);
      this.render(evaluation);
      this.panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
      setPopupStatus(
        this.options.status,
        'success',
        isAiEvaluation(evaluation)
          ? 'AI-рекомендация готова.'
          : aiSettings
            ? 'AI недоступен — показана локальная рекомендация.'
            : 'Предварительная рекомендация готова.',
      );
    } catch (error) {
      await recordDiagnostic({
        subsystem: 'popup',
        operation: 'analyze-article',
        code: 'ANALYSIS_FAILED',
        error,
      }).catch(() => undefined);
      setPopupStatus(
        this.options.status,
        'error',
        'Не удалось оценить материал.',
      );
    } finally {
      this.analyzeButton.disabled = false;
      this.analyzeButton.textContent = originalLabel;
    }
  }
}
