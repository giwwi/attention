import { privateStorage } from '../../vault/storage';
import { evaluationPrediction } from '../../utility/prediction';
import { createAnalyzer } from '../../analyzer';
import { popupText, type PopupTextKey } from '../../i18n/popup';
import { uiText, type UiLanguage } from '../../i18n/ui';
import { readingPlanText } from '../../i18n/reading-plan';
import {
  beginDataOperation,
  observeDataOperation,
  assertDataOperationCurrent,
  commitDataOperation,
  DataOperationCancelledError,
  type DataOperation,
} from '../../privacy/data-operations';
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
import { buildReadingPlan } from '../../attention/reading-plan';
import { loadUtilityCalibration } from '../../utility/storage';
import type {
  AnalysisContext,
  AttentionScenario,
  MaterialEvaluation,
  PageCapture,
  PersonalizationSignal,
  ProfileFeedbackType,
  StoredEvaluation,
} from '../../shared/types';
import { getElement, setPopupStatus } from '../dom';
import { isStoredEvaluation } from '../guards';
import {
  EVALUATION_VERDICTS_KEY,
  LATEST_EVALUATION_KEY,
} from '../storage-keys';

export interface EvaluationControllerOptions {
  status: HTMLParagraphElement;
  decisionButtons: HTMLButtonElement[];
  getCapture: () => PageCapture | null;
  getCaptureOperation?: () => DataOperation | null;
  getContext: () => AnalysisContext;
  getScenario: () => AttentionScenario;
  getLanguage: () => UiLanguage;
  getAiSettings: () => AiAnalyzerSettings | null;
  refreshAiSettings: () => Promise<AiAnalyzerSettings | null>;
  applyContext: (context: AnalysisContext) => void;
  refreshProfile: () => Promise<void> | void;
  onSectionSelected: (heading: string, button: HTMLButtonElement) => void;
  onHighlightSections: (headings: string[], button: HTMLButtonElement) => void;
}

function confidenceLabel(language: UiLanguage, value: number): string {
  return popupText(
    language,
    value < 0.55
      ? 'confidenceLow'
      : value < 0.7
        ? 'confidenceMedium'
        : 'confidenceHigh',
  );
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
  private readonly readingPlan = getElement<HTMLElement>('reading-plan');
  private readonly readingPlanTitle =
    getElement<HTMLHeadingElement>('reading-plan-title');
  private readonly readingPlanNote =
    getElement<HTMLParagraphElement>('reading-plan-note');
  private readonly readingPlanSections = getElement<HTMLOListElement>(
    'reading-plan-sections',
  );
  private readonly highlightSectionsButton =
    getElement<HTMLButtonElement>('highlight-sections');
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
  private activeOperation: DataOperation | null = null;
  private revision = 0;

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
    this.highlightSectionsButton.addEventListener('click', () => {
      const headings = Array.from(
        this.readingPlanSections.querySelectorAll<HTMLElement>(
          '[data-section-heading]',
        ),
      ).map((element) => element.dataset.sectionHeading ?? '');
      this.options.onHighlightSections(
        headings.filter(Boolean),
        this.highlightSectionsButton,
      );
    });
  }

  get current(): MaterialEvaluation | null {
    return this.activeEvaluation;
  }

  clear(): void {
    this.revision += 1;
    this.analyzeButton.disabled = false;
    this.analyzeButton.textContent = uiText(
      this.options.getLanguage(),
      'checkWithAi',
    );
    this.activeEvaluation = null;
    this.activeOperation = null;
    this.panel.hidden = true;
    this.readingPlan.hidden = true;
    this.assessmentInsights.hidden = true;
    this.wrongButton.disabled = false;
    this.wrongButton.textContent = popupText(
      this.options.getLanguage(),
      'opinionUnhelpful',
    );
    this.usefulButton.removeAttribute('data-selected');
    this.notUsefulButton.removeAttribute('data-selected');
    for (const button of this.options.decisionButtons) {
      button.removeAttribute('data-recommended');
    }
  }

  async restore(pageUrl: string, operation: DataOperation): Promise<void> {
    const revision = this.revision;
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
      if (revision !== this.revision) return;
      this.options.applyContext(remembered.storedEvaluation.context);
      this.activeOperation = operation;
      this.render(remembered.storedEvaluation.evaluation);
      return;
    }
    const stored = await privateStorage.get(LATEST_EVALUATION_KEY);
    const value: unknown = stored[LATEST_EVALUATION_KEY];
    if (!isStoredEvaluation(value) || value.url !== pageUrl) return;
    if (!isEvaluationCacheCurrent(value, sourceVersions, context, features)) {
      return;
    }

    if (revision !== this.revision) return;
    this.options.applyContext(value.context);
    this.activeOperation = operation;
    this.render(value.evaluation);
  }

  async evaluateLocal(operation?: DataOperation): Promise<void> {
    await this.analyze(true, operation);
  }

  translate(): void {
    if (this.activeEvaluation) {
      this.render(this.activeEvaluation);
      if (this.options.status.classList.contains('success')) {
        setPopupStatus(
          this.options.status,
          'success',
          popupText(this.options.getLanguage(), 'ready'),
        );
      }
    }
  }

  private render(evaluation: MaterialEvaluation): void {
    const language = this.options.getLanguage();
    this.activeEvaluation = evaluation;
    this.utilityScore.textContent = `${evaluation.utilityScore}/100`;
    this.recommendation.textContent = readingPlanText(
      language,
      evaluation.recommendedAction,
    );
    this.recommendation.dataset.action = evaluation.recommendedAction;
    this.confidence.textContent = confidenceLabel(
      language,
      evaluation.confidence,
    );
    this.usefulMinutes.textContent = evaluation.estimatedUsefulMinutes
      ? uiText(language, 'usefulMinutes', {
          count: evaluation.estimatedUsefulMinutes,
        })
      : popupText(language, 'usefulUnknown');

    this.renderReadingPlan(evaluation);

    const signals = evaluation.scenarioSignals;
    const metrics: Record<AttentionScenario, Array<[PopupTextKey, number]>> = {
      work: [
        ['relevance', signals.relevance],
        ['actionability', signals.actionability],
        ['quality', signals.quality],
        ['novelty', signals.novelty],
      ],
      learn: [
        ['level', signals.knowledgeFit],
        ['novelty', signals.novelty],
        ['quality', signals.quality],
        ['ease', signals.effortFit],
      ],
      explore: [
        ['discovery', signals.serendipity],
        ['novelty', signals.novelty],
        ['quality', signals.quality],
        ['relevance', signals.relevance],
      ],
      relax: [
        ['taste', signals.tasteFit],
        ['enjoyment', signals.enjoymentFit],
        ['ease', signals.effortFit],
        ['quality', signals.quality],
      ],
    };
    metrics[evaluation.scenario].forEach(([label, value], index) => {
      this.metricLabels[index]!.textContent = popupText(language, label);
      this.metricValues[index]!.textContent = String(value);
    });

    this.likelyNewClaims.replaceChildren();
    if (evaluation.insights && evaluation.scenario !== 'relax') {
      const insights = evaluation.insights;
      this.noveltyConfidence.textContent = popupText(
        language,
        'confidencePercent',
        { count: Math.round(insights.noveltyConfidence * 100) },
      );
      this.noveltySummary.textContent = insights.likelyNewClaims.length
        ? uiText(language, 'likelyNewIdea', {
            count: insights.likelyNewClaims.length,
          })
        : uiText(language, 'noveltyUnclear');
      for (const claim of insights.likelyNewClaims.slice(0, 3)) {
        const item = document.createElement('li');
        item.textContent = claim;
        this.likelyNewClaims.append(item);
      }
      this.likelyNewBlock.hidden = insights.likelyNewClaims.length === 0;
      this.qualityConfidence.textContent = popupText(
        language,
        'confidencePercent',
        { count: Math.round(insights.qualityConfidence * 100) },
      );
      this.qualitySummary.textContent = popupText(language, 'qualityCaution');
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
      this.qualityLimitation.textContent = '';
      this.qualityLimitation.hidden = true;
      this.assessmentInsights.hidden = false;
    } else {
      this.assessmentInsights.hidden = true;
    }

    this.reason.textContent = this.localizedReason(evaluation);
    this.expectedValue.textContent = this.localizedReason(evaluation);
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
    this.wrongButton.textContent = popupText(language, 'opinionUnhelpful');
    this.analyzerLabel.textContent = isAiEvaluation(evaluation)
      ? uiText(language, 'aiAnalysisSource')
      : uiText(language, 'localAnalysisSource');

    for (const button of this.options.decisionButtons) {
      if (button.dataset.decision === evaluation.recommendedAction) {
        button.dataset.recommended = 'true';
      } else {
        button.removeAttribute('data-recommended');
      }
    }
    this.panel.hidden = false;
  }

  private localizedReason(evaluation: MaterialEvaluation): string {
    const language = this.options.getLanguage();
    const signals = evaluation.scenarioSignals;
    if (evaluation.insights?.reliability?.weakExtraction)
      return uiText(language, 'weakExtraction');
    if (evaluation.scenario === 'relax')
      return uiText(
        language,
        signals.effortFit < 40
          ? 'harderThanWanted'
          : signals.tasteFit >= 70
            ? 'usualTaste'
            : 'tasteUnclear',
      );
    if (evaluation.scenario === 'learn')
      return uiText(
        language,
        signals.knowledgeFit < 42
          ? 'levelMismatch'
          : signals.knowledgeFit >= 70
            ? 'learningNextStep'
            : 'noveltyUnclear',
      );
    if (evaluation.scenario === 'explore')
      return uiText(
        language,
        signals.serendipity >= 68
          ? 'meaningfulConnection'
          : 'noStrongConnection',
      );
    const topic = uiText(
      language,
      signals.relevance >= 70
        ? 'topicFits'
        : signals.relevance >= 45
          ? 'topicPartlyFits'
          : 'outsideInterests',
    );
    return signals.quality < 50
      ? uiText(language, 'conclusionsNeedEvidence', { topic })
      : topic;
  }

  private renderReadingPlan(evaluation: MaterialEvaluation): void {
    const capture = this.options.getCapture();
    const label = this.readingPlan.querySelector<HTMLElement>(
      '.reading-plan-label',
    );
    if (label)
      label.textContent = readingPlanText(
        this.options.getLanguage(),
        'planLabel',
      );
    this.highlightSectionsButton.textContent = readingPlanText(
      this.options.getLanguage(),
      'highlight',
    );
    const plan = capture
      ? buildReadingPlan(capture, evaluation, this.options.getLanguage())
      : null;
    this.readingPlanSections.replaceChildren();
    if (!plan) {
      this.readingPlan.hidden = true;
      return;
    }
    this.readingPlanTitle.textContent = plan.title;
    this.readingPlanNote.textContent = plan.note ?? '';
    this.readingPlanNote.hidden = !plan.note;
    plan.sections.forEach((section, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.sectionHeading = section.heading;
      const number = document.createElement('span');
      number.className = 'reading-plan-section-number';
      number.textContent = String(index + 1);
      const copy = document.createElement('span');
      copy.className = 'reading-plan-section-copy';
      const heading = document.createElement('strong');
      heading.textContent = section.heading;
      const reason = document.createElement('small');
      reason.textContent = section.reason;
      copy.append(heading, reason);
      button.append(number, copy);
      button.addEventListener('click', () => {
        this.options.onSectionSelected(section.heading, button);
      });
      item.append(button);
      this.readingPlanSections.append(item);
    });
    this.highlightSectionsButton.disabled = false;
    this.readingPlan.hidden = false;
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
      kind.textContent = uiText(this.options.getLanguage(), 'personalProfile');
      const confidence = document.createElement('span');
      confidence.className = 'profile-signal-confidence';
      confidence.textContent = `${Math.round(signal.confidence * 100)}%`;
      top.append(kind, confidence);
      const title = document.createElement('strong');
      title.textContent = signal.label;
      const explanation = document.createElement('p');
      explanation.hidden = true;
      const correction = document.createElement('details');
      correction.className = 'profile-signal-correction';
      const summary = document.createElement('summary');
      summary.textContent = uiText(this.options.getLanguage(), 'change');
      const actions = document.createElement('div');
      actions.className = 'profile-signal-actions';
      const affirm = document.createElement('button');
      affirm.type = 'button';
      affirm.textContent = uiText(this.options.getLanguage(), 'save');
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
      ignore.textContent = uiText(this.options.getLanguage(), 'delete');
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
    if (!capture || !this.activeEvaluation || !this.activeOperation) return;
    const operation = this.activeOperation;
    for (const button of card.querySelectorAll('button'))
      button.disabled = true;
    try {
      const evaluation = this.activeEvaluation;
      const profile = await loadProfile();
      await commitDataOperation(operation, async () => {
        if (profile) await applyAndStoreSignalFeedback(profile, signal, type);
        await recordProfileFeedback({
          type,
          url: capture.url,
          recommendedAction: evaluation.recommendedAction,
          signalId: signal.id,
          profileEntryId: signal.profileEntryId,
        });
      });
      explanation.hidden = false;
      explanation.textContent = uiText(
        this.options.getLanguage(),
        'feedbackSaved',
      );
      card.dataset.feedback = type;
      await this.options.refreshProfile();
      setPopupStatus(
        this.options.status,
        'success',
        uiText(this.options.getLanguage(), 'feedbackSaved'),
      );
    } catch (error) {
      if (error instanceof DataOperationCancelledError) return;
      for (const button of card.querySelectorAll('button')) {
        button.disabled = false;
      }
      setPopupStatus(
        this.options.status,
        'error',
        uiText(this.options.getLanguage(), 'outcomeError'),
      );
    }
  }

  private async markRecommendationWrong(): Promise<void> {
    const capture = this.options.getCapture();
    if (!capture || !this.activeEvaluation || !this.activeOperation) return;
    const operation = this.activeOperation;
    this.wrongButton.disabled = true;
    try {
      const evaluation = this.activeEvaluation;
      await commitDataOperation(operation, () =>
        recordProfileFeedback({
          type: 'wrongRecommendation',
          url: capture.url,
          recommendedAction: evaluation.recommendedAction,
          signalId: null,
          profileEntryId: null,
        }),
      );
      this.wrongButton.textContent = uiText(
        this.options.getLanguage(),
        'feedbackSaved',
      );
      setPopupStatus(
        this.options.status,
        'success',
        uiText(this.options.getLanguage(), 'feedbackSaved'),
      );
    } catch (error) {
      if (error instanceof DataOperationCancelledError) return;
      this.wrongButton.disabled = false;
      setPopupStatus(
        this.options.status,
        'error',
        uiText(this.options.getLanguage(), 'outcomeError'),
      );
    }
  }

  private async recordVerdict(useful: boolean): Promise<void> {
    const capture = this.options.getCapture();
    if (!capture || !this.activeEvaluation || !this.activeOperation) return;
    const operation = this.activeOperation;
    const evaluation = this.activeEvaluation;
    try {
      await commitDataOperation(operation, async () => {
        const stored = await privateStorage.get(EVALUATION_VERDICTS_KEY);
        const previous = Array.isArray(stored[EVALUATION_VERDICTS_KEY])
          ? stored[EVALUATION_VERDICTS_KEY]
          : [];
        await privateStorage.set({
          [EVALUATION_VERDICTS_KEY]: [
            {
              url: capture.url,
              scenario: evaluation.scenario,
              predictedUtility: evaluation.utilityScore,
              prediction: evaluationPrediction(evaluation),
              source: 'evaluation-verdict',
              useful,
              recordedAt: new Date().toISOString(),
            },
            ...previous,
          ].slice(0, 200),
        });
      });
      this.usefulButton.dataset.selected = String(useful);
      this.notUsefulButton.dataset.selected = String(!useful);
      setPopupStatus(
        this.options.status,
        'success',
        uiText(this.options.getLanguage(), 'feedbackSaved'),
      );
    } catch (error) {
      if (error instanceof DataOperationCancelledError) return;
      setPopupStatus(
        this.options.status,
        'error',
        uiText(this.options.getLanguage(), 'outcomeError'),
      );
    }
  }

  private async analyze(
    localOnly = false,
    suppliedOperation?: DataOperation,
  ): Promise<void> {
    const capture = this.options.getCapture();
    if (!capture) return;
    const revision = ++this.revision;
    const context = this.options.getContext();
    const language = this.options.getLanguage();
    let operation: DataOperation | undefined;
    this.analyzeButton.disabled = true;
    this.analyzeButton.textContent = popupText(language, 'analyzing');
    setPopupStatus(
      this.options.status,
      'default',
      popupText(language, 'analyzing'),
    );

    try {
      const capturedOperation = this.options.getCaptureOperation?.();
      if (this.options.getCaptureOperation && !capturedOperation) return;
      operation =
        suppliedOperation ?? capturedOperation ?? (await beginDataOperation());
      const activeOperation = operation;
      const aiSettings = localOnly
        ? null
        : await this.options.refreshAiSettings();
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
        commitDataOperation(activeOperation, () =>
          recordDiagnostic({
            subsystem: 'ai',
            operation: 'analyze-article',
            code: 'AI_PRIMARY_FAILED_LOCAL_FALLBACK',
            severity: 'warning',
            error,
          }),
        ),
      );
      const cancellation = await observeDataOperation(activeOperation);
      let rawEvaluation;
      try {
        await assertDataOperationCurrent(activeOperation);
        rawEvaluation = await analyzer.analyze(
          capture,
          context,
          relevantProfile,
          cancellation.signal,
        );
      } finally {
        cancellation.dispose();
      }
      const evaluation = calibrateMaterialEvaluation(
        rawEvaluation,
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
      if (revision !== this.revision || capture !== this.options.getCapture())
        return;
      await commitDataOperation(operation, async () => {
        if (revision !== this.revision) return;
        await privateStorage.set({
          [LATEST_EVALUATION_KEY]: storedEvaluation,
        });
        await recordMaterialEvaluation(storedEvaluation, capture.title);
      });
      if (revision !== this.revision) return;
      this.activeOperation = operation;
      this.render(evaluation);
      setPopupStatus(
        this.options.status,
        'success',
        popupText(this.options.getLanguage(), 'ready'),
      );
    } catch (error) {
      if (
        error instanceof DataOperationCancelledError ||
        revision !== this.revision
      )
        return;
      if (operation) {
        try {
          await commitDataOperation(operation, () =>
            recordDiagnostic({
              subsystem: 'popup',
              operation: 'analyze-article',
              code: 'ANALYSIS_FAILED',
              error,
            }),
          );
        } catch {
          return;
        }
      }
      setPopupStatus(
        this.options.status,
        'error',
        popupText(this.options.getLanguage(), 'analysisFailed'),
      );
    } finally {
      if (revision === this.revision) {
        this.analyzeButton.disabled = false;
        this.analyzeButton.textContent = uiText(
          this.options.getLanguage(),
          'checkWithAi',
        );
      }
    }
  }
}
