import {
  DEFAULT_UI_LANGUAGE,
  UI_LANGUAGE_KEY,
  normalizeUiLanguage,
  uiText,
  type UiLanguage,
  type UiTextKey,
} from '../../i18n/ui';
import type { FirstValueSelection } from '../../onboarding/first-value';
import {
  changeScenario,
  contextFromScenarioState,
  createDefaultScenarioState,
  loadScenarioState,
  normalizeAnalysisContext,
  saveScenarioState,
} from '../../scenario/scenario';
import type {
  AnalysisContext,
  AttentionScenario,
  CognitiveEffort,
  RelaxIntent,
  ScenarioState,
} from '../../shared/types';
import { getElement, setPopupStatus } from '../dom';
import { isAnalysisContext } from '../guards';
import { ANALYSIS_CONTEXT_KEY } from '../storage-keys';
import {
  NOVEL_PASSAGE_HIGHLIGHTS_KEY,
  novelPassageHighlightsEnabled,
} from '../../novelty/settings';

export interface SettingsControllerOptions {
  status: HTMLParagraphElement;
  onEvaluationInvalidated: () => void;
  onTranslated: (language: UiLanguage) => void;
  onLanguageChanged: () => Promise<void> | void;
}

export class SettingsController {
  private readonly interfaceLanguageSelect =
    getElement<HTMLSelectElement>('interface-language');
  private readonly intentInput = getElement<HTMLInputElement>('intent');
  private readonly intentLabelText =
    getElement<HTMLSpanElement>('intent-label-text');
  private readonly scenarioSelect =
    getElement<HTMLSelectElement>('scenario-select');
  private readonly relaxContext = getElement<HTMLElement>('relax-context');
  private readonly relaxIntentSelect =
    getElement<HTMLSelectElement>('relax-intent');
  private readonly desiredEffortSelect =
    getElement<HTMLSelectElement>('desired-effort');
  private readonly novelPassageHighlights = getElement<HTMLInputElement>(
    'novel-passage-highlights',
  );
  private scenarioState: ScenarioState = createDefaultScenarioState();
  private interfaceLanguage: UiLanguage = DEFAULT_UI_LANGUAGE;
  private intentSaveTimer: number | null = null;

  constructor(private readonly options: SettingsControllerOptions) {
    this.bindEvents();
  }

  get language(): UiLanguage {
    return this.interfaceLanguage;
  }

  get scenario(): AttentionScenario {
    return this.scenarioState.scenario;
  }

  currentContext(): AnalysisContext {
    return contextFromScenarioState(
      this.scenarioState,
      this.intentInput.value.trim(),
      15,
    );
  }

  async initializeLanguage(): Promise<void> {
    const stored = await chrome.storage.local.get(UI_LANGUAGE_KEY);
    this.translate(normalizeUiLanguage(stored[UI_LANGUAGE_KEY]));
  }

  async initializeScenario(): Promise<void> {
    const [scenarioState, stored] = await Promise.all([
      loadScenarioState(),
      chrome.storage.local.get(NOVEL_PASSAGE_HIGHLIGHTS_KEY),
    ]);
    this.scenarioState = scenarioState;
    this.novelPassageHighlights.checked = novelPassageHighlightsEnabled(
      stored[NOVEL_PASSAGE_HIGHLIGHTS_KEY],
    );
    this.renderScenarioControls();
    await this.restoreContext();
  }

  applyContext(context: AnalysisContext): void {
    const normalized = normalizeAnalysisContext(context);
    this.intentInput.value = normalized.intent;
    this.renderScenarioControls();
  }

  async applyFirstValue(selection: FirstValueSelection): Promise<void> {
    this.scenarioState = changeScenario(
      createDefaultScenarioState(),
      selection.scenario,
    );
    this.intentInput.value = selection.interest;
    await saveScenarioState(this.scenarioState);
    await chrome.storage.local.set({
      [ANALYSIS_CONTEXT_KEY]: this.currentContext(),
    });
  }

  private bindEvents(): void {
    this.intentInput.addEventListener('input', () => {
      this.options.onEvaluationInvalidated();
      if (this.intentSaveTimer !== null) {
        window.clearTimeout(this.intentSaveTimer);
      }
      this.intentSaveTimer = window.setTimeout(() => {
        void this.persistContext().catch(() => {
          setPopupStatus(
            this.options.status,
            'error',
            'Не удалось сохранить настройки.',
          );
        });
      }, 250);
    });

    this.scenarioSelect.addEventListener('change', () => {
      const scenario = this.scenarioSelect.value as AttentionScenario;
      if (!['work', 'learn', 'explore', 'relax'].includes(scenario)) return;
      void this.selectScenario(scenario).catch(() => {
        setPopupStatus(
          this.options.status,
          'error',
          'Не удалось сменить сценарий.',
        );
      });
    });

    this.relaxIntentSelect.addEventListener('change', () => {
      void this.updateRelaxContext().catch(() => {
        setPopupStatus(
          this.options.status,
          'error',
          'Не удалось обновить контекст отдыха.',
        );
      });
    });
    this.desiredEffortSelect.addEventListener('change', () => {
      void this.updateRelaxContext().catch(() => {
        setPopupStatus(
          this.options.status,
          'error',
          'Не удалось обновить желаемое усилие.',
        );
      });
    });

    this.interfaceLanguageSelect.addEventListener('change', () => {
      const language = normalizeUiLanguage(this.interfaceLanguageSelect.value);
      void this.selectLanguage(language).catch(() => {
        setPopupStatus(
          this.options.status,
          'error',
          'Не удалось сохранить язык интерфейса.',
        );
      });
    });

    this.novelPassageHighlights.addEventListener('change', () => {
      void chrome.storage.local
        .set({
          [NOVEL_PASSAGE_HIGHLIGHTS_KEY]: this.novelPassageHighlights.checked,
        })
        .catch(() => {
          this.novelPassageHighlights.checked =
            !this.novelPassageHighlights.checked;
          setPopupStatus(
            this.options.status,
            'error',
            'Не удалось сохранить настройку.',
          );
        });
    });
  }

  private translate(language: UiLanguage): void {
    this.interfaceLanguage = language;
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    this.interfaceLanguageSelect.value = language;
    const languageLabel = uiText(language, 'language');
    this.interfaceLanguageSelect.setAttribute('aria-label', languageLabel);
    this.interfaceLanguageSelect.parentElement?.setAttribute(
      'title',
      languageLabel,
    );

    for (const element of document.querySelectorAll<HTMLElement>(
      '[data-i18n]',
    )) {
      const key = element.dataset.i18n as UiTextKey | undefined;
      if (key) element.textContent = uiText(language, key);
    }
    for (const element of document.querySelectorAll<HTMLInputElement>(
      '[data-i18n-placeholder]',
    )) {
      const key = element.dataset.i18nPlaceholder as UiTextKey | undefined;
      if (key) element.placeholder = uiText(language, key);
    }
    this.renderScenarioControls();
    this.options.onTranslated(language);
  }

  private async selectLanguage(language: UiLanguage): Promise<void> {
    this.translate(language);
    await chrome.storage.local.set({ [UI_LANGUAGE_KEY]: language });
    await this.options.onLanguageChanged();
  }

  private async persistContext(): Promise<void> {
    await chrome.storage.local.set({
      [ANALYSIS_CONTEXT_KEY]: this.currentContext(),
    });
  }

  private renderScenarioControls(): void {
    this.scenarioSelect.value = this.scenarioState.scenario;
    this.relaxContext.hidden = this.scenarioState.scenario !== 'relax';
    this.relaxIntentSelect.value = this.scenarioState.relaxIntent ?? '';
    this.desiredEffortSelect.value = this.scenarioState.desiredEffort ?? '';

    const copy: Record<
      AttentionScenario,
      { label: UiTextKey; placeholder: UiTextKey }
    > = {
      work: { label: 'currentTask', placeholder: 'currentTaskPlaceholder' },
      learn: { label: 'learnIntent', placeholder: 'learnIntentPlaceholder' },
      explore: {
        label: 'exploreIntent',
        placeholder: 'exploreIntentPlaceholder',
      },
      relax: { label: 'relaxIntent', placeholder: 'relaxIntentPlaceholder' },
    };
    const selected = copy[this.scenarioState.scenario];
    this.intentLabelText.textContent = uiText(
      this.interfaceLanguage,
      selected.label,
    );
    this.intentInput.placeholder = uiText(
      this.interfaceLanguage,
      selected.placeholder,
    );
  }

  private async restoreContext(): Promise<void> {
    const stored = await chrome.storage.local.get(ANALYSIS_CONTEXT_KEY);
    const value: unknown = stored[ANALYSIS_CONTEXT_KEY];
    if (!isAnalysisContext(value)) {
      this.renderScenarioControls();
      return;
    }
    this.applyContext(value);
  }

  private async selectScenario(scenario: AttentionScenario): Promise<void> {
    this.scenarioState = changeScenario(this.scenarioState, scenario);
    await saveScenarioState(this.scenarioState);
    this.renderScenarioControls();
    this.options.onEvaluationInvalidated();
    await this.persistContext();
  }

  private async updateRelaxContext(): Promise<void> {
    this.scenarioState = {
      ...this.scenarioState,
      relaxIntent: (this.relaxIntentSelect.value || null) as RelaxIntent | null,
      desiredEffort: (this.desiredEffortSelect.value ||
        null) as CognitiveEffort | null,
      scenarioUpdatedAt: new Date().toISOString(),
      scenarioSource: 'manual',
    };
    await saveScenarioState(this.scenarioState);
    this.options.onEvaluationInvalidated();
    await this.persistContext();
  }
}
