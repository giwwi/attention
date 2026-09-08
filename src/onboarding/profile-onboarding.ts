import { createProfileDemo } from './profile-demo';
import {
  mergeProfiles,
  resolveMerge,
  type MergeResult,
} from '../profile/merge';
import {
  createManualEntryId,
  normalizePortableProfile,
} from '../profile/normalize';
import { PROFILE_PROVIDERS } from '../profile/providers';
import {
  createEmptyProfile,
  type ExpertiseLevel,
  type GoalPriority,
  type GoalStatus,
  type KnowledgeEvidenceType,
  type LeisureNoveltyPreference,
  type LeisurePreferenceKind,
  type LeisurePreferenceLevel,
  type PersonalProfile,
  type PreferenceLevel,
  type ProfileCollection,
  type ProfileSource,
  type SourceAttribution,
} from '../profile/schema';
import type { QuickProfileAnswers } from '../profile/quick-builder';
import { deleteProfile, loadProfile, saveProfile } from '../profile/storage';
import { validatePortableProfile } from '../profile/validator';
import { isProfileReady } from '../profile/readiness';
import type { CognitiveEffort } from '../shared/types';
import { captureProfileLabels, profileText as p } from '../i18n/profile';
import { normalizeUiLanguage } from '../i18n/ui';
import {
  beginDataOperation,
  commitDataOperation,
  assertDataOperationCurrent,
  DataOperationCancelledError,
  type DataOperation,
} from '../privacy/data-operations';
import {
  launchClaudeWebFallback,
  launchProfileHandoff,
  prepareChatGptProfileHandoff,
} from './handoff/launchers';
import {
  clearProfileHandoffState,
  createProfileHandoffState,
  loadProfileHandoffState,
  saveProfileHandoffState,
  type ProfileHandoffState,
  type ProfileHandoffProviderId,
} from './handoff/state';

interface ProfileOnboardingOptions {
  onComplete: () => void | Promise<void>;
  buildQuickProfile?: (
    answers: QuickProfileAnswers,
  ) => PersonalProfile | Promise<PersonalProfile>;
}

const sourceLabels: Record<ProfileSource, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  other: 'Другой AI',
  manual: 'Вручную',
  quick_ai: 'Быстрая AI-настройка',
};

const levelLabels: Record<string, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  active: 'Активна',
  paused: 'На паузе',
  completed: 'Завершена',
  beginner: 'Начальный',
  intermediate: 'Средний',
  advanced: 'Продвинутый',
  expert: 'Экспертный',
  demonstrated: 'Продемонстрировано',
  explicitly_stated: 'Указано напрямую',
  inferred: 'Предположение',
  unknown: 'Неизвестно',
  familiar: 'Знакомое',
  balanced: 'Баланс',
  novel: 'Новое',
  genre: 'Жанр',
  format: 'Формат',
  creator: 'Автор',
  recreationalTopic: 'Тема для отдыха',
  dislike: 'Не нравится',
};

function profileBarSummary(count: number | null): string {
  return count === null
    ? p('Личный контекст пока не настроен.')
    : p('Личный контекст: {count} · хранится локально.', { count });
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element: ${id}`);
  return value as T;
}

function attribution(source: ProfileSource): SourceAttribution[] {
  return [
    {
      source,
      importedAt: new Date().toISOString(),
      generatedAt: null,
    },
  ];
}

function confidenceInput(
  value: number,
  onChange: (value: number) => void,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = '1';
  input.step = '0.05';
  input.value = String(value);
  input.setAttribute('aria-label', p('Уверенность от 0 до 1'));
  input.addEventListener('input', () => onChange(Number(input.value)));
  return input;
}

function optionalMinutesInput(
  value: number | null,
  onChange: (value: number | null) => void,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.max = '480';
  input.step = '1';
  input.placeholder = p('Неизвестно');
  input.value = value === null ? '' : String(value);
  input.setAttribute('aria-label', p('Обычная длительность отдыха в минутах'));
  input.addEventListener('input', () => {
    const parsed = Number(input.value);
    onChange(input.value === '' || !Number.isFinite(parsed) ? null : parsed);
  });
  return input;
}

function textInput(
  value: string,
  label: string,
  onChange: (value: string) => void,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.maxLength = 500;
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => onChange(input.value));
  return input;
}

function selectInput<T extends string>(
  value: T,
  values: readonly T[],
  label: string,
  onChange: (value: T) => void,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.setAttribute('aria-label', label);
  for (const optionValue of values) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = p(levelLabels[optionValue] ?? optionValue);
    option.selected = optionValue === value;
    select.append(option);
  }
  select.addEventListener('change', () => onChange(select.value as T));
  return select;
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const wrapper = document.createElement('label');
  const text = document.createElement('span');
  text.textContent = label;
  wrapper.append(text, control);
  return wrapper;
}

function profileErrors(profile: PersonalProfile): string[] {
  const errors: string[] = [];
  const entries = [
    ...profile.interests.map((item) => [item.topic, item.confidence] as const),
    ...profile.goals.map((item) => [item.goal, item.confidence] as const),
    ...profile.expertise.map((item) => [item.topic, item.confidence] as const),
    ...profile.lowValueTopics.map(
      (item) => [item.topic, item.confidence] as const,
    ),
    ...profile.demonstratedKnowledge.map(
      (item) => [item.statement, item.confidence] as const,
    ),
    ...profile.learningAreas.map(
      (item) => [item.topic, item.confidence] as const,
    ),
    ...profile.uncertainties.map(
      (item) => [item.note, item.confidence] as const,
    ),
    ...profile.leisureProfile.preferences.map(
      (item) => [item.category, item.confidence] as const,
    ),
  ];
  if (!isProfileReady(profile)) {
    errors.push(
      p(
        'Добавьте ваши интересы, цели или знакомые темы. Одних настроек формата недостаточно.',
      ),
    );
  }
  if (entries.some(([text]) => !text.trim())) {
    errors.push(p('Текстовые поля не должны быть пустыми.'));
  }
  const confidenceValues = [
    ...entries.map(([, confidence]) => confidence),
    ...profile.interests.map((item) => item.strength),
    ...(profile.contentPreferences
      ? [profile.contentPreferences.confidence]
      : []),
    profile.leisureProfile.confidence,
  ];
  if (
    confidenceValues.some(
      (value) => !Number.isFinite(value) || value < 0 || value > 1,
    )
  ) {
    errors.push(
      p('Уверенность и сила интереса должны быть числами от 0 до 1.'),
    );
  }
  const leisureMinutes = profile.leisureProfile.typicalSessionMinutes;
  if (
    leisureMinutes !== null &&
    (!Number.isFinite(leisureMinutes) ||
      leisureMinutes < 1 ||
      leisureMinutes > 480)
  ) {
    errors.push(
      p('Обычная длительность отдыха должна быть от 1 до 480 минут.'),
    );
  }
  return errors;
}

export class ProfileOnboarding {
  private readonly root = element<HTMLElement>('profile-onboarding');
  private readonly sourceStep = element<HTMLElement>('profile-source-step');
  private readonly quickStep = element<HTMLElement>('profile-quick-step');
  private readonly quickReviewStep = element<HTMLElement>(
    'profile-quick-review-step',
  );
  private readonly promptStep = element<HTMLElement>('profile-prompt-step');
  private readonly reviewStep = element<HTMLElement>('profile-review-step');
  private readonly mergeStep = element<HTMLElement>('profile-merge-step');
  private readonly providerTitle = element<HTMLElement>(
    'profile-provider-title',
  );
  private readonly handoffStatus = element<HTMLElement>(
    'profile-handoff-status',
  );
  private readonly handoffInstructions = element<HTMLOListElement>(
    'profile-handoff-instructions',
  );
  private readonly reopenProviderButton = element<HTMLButtonElement>(
    'reopen-profile-provider',
  );
  private readonly claudeWebFallbackButton = element<HTMLButtonElement>(
    'open-claude-web-fallback',
  );
  private readonly showPromptButton = element<HTMLButtonElement>(
    'show-profile-prompt',
  );
  private readonly manualPrompt = element<HTMLElement>('profile-manual-prompt');
  private readonly prompt = element<HTMLTextAreaElement>(
    'profile-export-prompt',
  );
  private readonly response = element<HTMLTextAreaElement>(
    'profile-import-json',
  );
  private readonly validationErrors = element<HTMLUListElement>(
    'profile-validation-errors',
  );
  private readonly reviewSource = element<HTMLElement>('profile-review-source');
  private readonly reviewContent = element<HTMLElement>(
    'profile-review-content',
  );
  private readonly reviewErrors = element<HTMLUListElement>(
    'profile-review-errors',
  );
  private readonly conflictContent = element<HTMLElement>('profile-conflicts');
  private readonly profileBar = element<HTMLElement>('profile-bar');
  private readonly profileBarText = element<HTMLElement>('profile-bar-text');
  private readonly deleteButton = element<HTMLButtonElement>('delete-profile');
  private readonly quickInternet = element<HTMLTextAreaElement>(
    'quick-profile-internet',
  );
  private readonly quickKnowledge = element<HTMLTextAreaElement>(
    'quick-profile-knowledge',
  );
  private readonly quickLeisure = element<HTMLTextAreaElement>(
    'quick-profile-leisure',
  );
  private readonly quickError = element<HTMLElement>('quick-profile-error');
  private readonly quickSummary = element<HTMLElement>('profile-quick-summary');
  private readonly generateQuickButton = element<HTMLButtonElement>(
    'generate-quick-profile',
  );
  private readonly options: ProfileOnboardingOptions;
  private source: ProfileSource = 'manual';
  private draft: PersonalProfile | null = null;
  private existing: PersonalProfile | null = null;
  private pendingMerge: MergeResult | null = null;
  private handoffState: ProfileHandoffState | null = null;
  private operation: DataOperation | null = null;
  private readonly translateStatic = captureProfileLabels(this.root);

  constructor(options: ProfileOnboardingOptions) {
    this.options = options;
    this.bindEvents();
    this.translateStatic();
    this.renderExample();
    new MutationObserver(() => {
      if (this.root.isConnected) this.translate();
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['lang'],
    });
  }

  private renderExample(): void {
    this.root
      .querySelector('#profile-example-slot')
      ?.replaceChildren(
        createProfileDemo(normalizeUiLanguage(document.documentElement.lang)),
      );
  }

  translate(): void {
    this.translateStatic();
    this.renderExample();
    this.renderProfileBar();
    // Changing the interface language must not reopen an inactive import view.
    if (this.root.hidden) return;
    if (!this.promptStep.hidden && this.handoffState)
      this.renderHandoff(this.handoffState);
    if (!this.reviewStep.hidden && this.draft) this.renderReview();
    if (!this.quickReviewStep.hidden && this.draft) this.renderQuickSummary();
    if (!this.mergeStep.hidden && this.pendingMerge)
      this.renderConflicts(this.pendingMerge);
  }

  resetAfterErasure(): void {
    this.operation = null;
    this.draft = null;
    this.existing = null;
    this.pendingMerge = null;
    this.handoffState = null;
    this.response.value = '';
    this.quickInternet.value = '';
    this.quickKnowledge.value = '';
    this.quickLeisure.value = '';
    this.reviewContent.replaceChildren();
    this.quickSummary.replaceChildren();
    this.conflictContent.replaceChildren();
    this.clearErrors(this.validationErrors);
    this.clearErrors(this.reviewErrors);
    this.root.hidden = true;
    document.body.classList.remove('profile-flow-active');
    this.renderProfileBar();
  }

  async initialize(showOnboarding: boolean): Promise<boolean> {
    this.existing = await loadProfile();
    this.renderProfileBar();
    const handoff = await loadProfileHandoffState();
    if (handoff) {
      const current = await beginDataOperation();
      this.operation = {
        ...current,
        generation: handoff.generation ?? current.generation,
      };
      handoff.vaultEpoch = current.vaultEpoch;
      await assertDataOperationCurrent(this.operation);
      this.restoreHandoff(handoff);
      return true;
    }
    if (showOnboarding) {
      await this.openSource(false);
      return true;
    }
    return false;
  }

  async refreshProfile(): Promise<void> {
    this.existing = await loadProfile();
    this.renderProfileBar();
  }

  async openSource(clearHandoff = true): Promise<void> {
    await this.beginProfileOperation(clearHandoff);
    this.handoffState = null;
    document.body.classList.add('profile-flow-active');
    this.root.hidden = false;
    this.showStep(this.sourceStep);
    this.response.value = '';
    this.clearErrors(this.validationErrors);
  }

  private bindEvents(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      '[data-profile-source]',
    )) {
      button.addEventListener('click', () => {
        const source = button.dataset.profileSource as
          ProfileHandoffProviderId | 'manual' | undefined;
        if (!source) return;
        if (source === 'manual') this.runAction(this.openManual());
        else this.runAction(this.beginProvider(source));
      });
    }
    element<HTMLButtonElement>('open-quick-profile').addEventListener(
      'click',
      () => this.runAction(this.openQuickProfile()),
    );
    element<HTMLButtonElement>('profile-quick-back').addEventListener(
      'click',
      () => this.runAction(this.openSource()),
    );
    element<HTMLButtonElement>('profile-quick-review-back').addEventListener(
      'click',
      () => this.showStep(this.quickStep),
    );
    element<HTMLButtonElement>('cancel-quick-profile').addEventListener(
      'click',
      () => this.runAction(this.openSource()),
    );
    element<HTMLButtonElement>('save-quick-profile').addEventListener(
      'click',
      () => this.runAction(this.acceptDraft()),
    );
    this.generateQuickButton.addEventListener('click', () => {
      this.runAction(this.generateQuickProfile());
    });
    element<HTMLButtonElement>('skip-profile').addEventListener('click', () => {
      this.runAction(this.skip());
    });
    element<HTMLButtonElement>('profile-prompt-back').addEventListener(
      'click',
      () => this.runAction(this.openSource()),
    );
    this.showPromptButton.addEventListener('click', () => {
      this.setManualPromptVisible(this.manualPrompt.hidden);
    });
    this.reopenProviderButton.addEventListener('click', () => {
      this.runAction(this.reopenProvider());
    });
    this.claudeWebFallbackButton.addEventListener('click', () => {
      this.runAction(this.openClaudeWebFallback());
    });
    element<HTMLButtonElement>('copy-profile-prompt').addEventListener(
      'click',
      (event) =>
        this.runAction(
          this.copyPrompt(event.currentTarget as HTMLButtonElement),
        ),
    );
    element<HTMLButtonElement>('validate-profile').addEventListener(
      'click',
      () => this.validateImport(),
    );
    element<HTMLButtonElement>('cancel-profile-review').addEventListener(
      'click',
      () => this.runAction(this.openSource()),
    );
    element<HTMLButtonElement>('save-profile').addEventListener('click', () => {
      this.runAction(this.acceptDraft());
    });
    element<HTMLButtonElement>('cancel-profile-merge').addEventListener(
      'click',
      () => this.renderReview(),
    );
    element<HTMLButtonElement>('confirm-profile-merge').addEventListener(
      'click',
      () => this.runAction(this.confirmMerge()),
    );
    element<HTMLButtonElement>('open-profile-import').addEventListener(
      'click',
      () => this.runAction(this.openSource()),
    );
    this.deleteButton.addEventListener('click', () =>
      this.runAction(this.removeProfile()),
    );
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      '[data-add-profile-item]',
    )) {
      button.addEventListener('click', () => {
        const collection = button.dataset.addProfileItem as
          | ProfileCollection
          | 'contentPreferences'
          | 'leisurePreferences'
          | undefined;
        if (collection) this.addItem(collection);
      });
    }
  }

  private showStep(active: HTMLElement): void {
    for (const step of [
      this.sourceStep,
      this.quickStep,
      this.quickReviewStep,
      this.promptStep,
      this.reviewStep,
      this.mergeStep,
    ]) {
      step.hidden = step !== active;
    }
  }

  private async openQuickProfile(): Promise<void> {
    await this.beginProfileOperation();
    this.handoffState = null;
    this.source = 'quick_ai';
    this.draft = null;
    this.quickError.hidden = true;
    this.quickError.textContent = '';
    document.body.classList.add('profile-flow-active');
    this.root.hidden = false;
    this.showStep(this.quickStep);
    this.quickInternet.focus();
  }

  private async generateQuickProfile(): Promise<void> {
    if (this.generateQuickButton.disabled) return;
    this.generateQuickButton.disabled = true;
    this.quickError.hidden = true;
    this.quickError.textContent = '';
    try {
      const operation = this.operation ?? (await beginDataOperation());
      this.operation = operation;
      if (!this.options.buildQuickProfile) {
        throw new Error(p('Быстрая AI-настройка сейчас недоступна.'));
      }
      this.source = 'quick_ai';
      const draft = await this.options.buildQuickProfile({
        internetUse: this.quickInternet.value,
        knownTopics: this.quickKnowledge.value,
        leisure: this.quickLeisure.value,
      });
      await assertDataOperationCurrent(operation);
      this.draft = draft;
      this.renderQuickSummary();
      this.showStep(this.quickReviewStep);
    } catch (error) {
      this.quickError.textContent =
        error instanceof DataOperationCancelledError
          ? p(
              'Профиль не сохранён: данные были удалены. Начните настройку заново.',
            )
          : p('Не удалось подготовить профиль. Попробуйте ещё раз.');
      this.quickError.hidden = false;
    } finally {
      this.generateQuickButton.disabled = false;
    }
  }

  private renderQuickSummary(): void {
    if (!this.draft) return;
    this.quickSummary.replaceChildren();
    const sections: Array<[string, string[]]> = [
      [p('Интересы'), this.draft.interests.map((item) => item.topic)],
      [p('Текущие цели'), this.draft.goals.map((item) => item.goal)],
      [
        p('Хорошо знакомые темы'),
        this.draft.expertise.map((item) => item.topic),
      ],
      [
        p('Что хотите изучать'),
        this.draft.learningAreas.map((item) => item.topic),
      ],
      [
        p('Для отдыха'),
        this.draft.leisureProfile.preferences.map((item) => item.category),
      ],
    ];

    for (const [title, values] of sections) {
      if (values.length === 0) continue;
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      const list = document.createElement('ul');
      heading.textContent = title;
      for (const value of values) {
        const item = document.createElement('li');
        item.textContent = value;
        list.append(item);
      }
      section.append(heading, list);
      this.quickSummary.append(section);
    }

    if (this.quickSummary.childElementCount === 0) {
      const empty = document.createElement('p');
      empty.textContent = p(
        'В ответах недостаточно конкретного контекста. Добавьте интересы, цели и знакомые темы.',
      );
      this.quickSummary.append(empty);
    }
  }

  private async beginProvider(source: ProfileHandoffProviderId): Promise<void> {
    const operation = await this.beginProfileOperation();
    const chatGptPreparation =
      source === 'chatgpt'
        ? prepareChatGptProfileHandoff(PROFILE_PROVIDERS.chatgpt.prompt)
        : null;
    const state = createProfileHandoffState(source);
    state.generation = operation.generation;
    state.vaultEpoch = operation.vaultEpoch;
    if (source === 'chatgpt') state.method = 'clipboard-and-web';
    if (source === 'claude') state.method = 'deep-link';
    if (source === 'other') state.method = 'manual';
    await this.saveHandoff(state);
    this.restoreHandoff(state);
    if (source === 'other') return;
    if (source === 'chatgpt') {
      if (!chatGptPreparation) return;
      const prepared = await chatGptPreparation;
      const preparedState: ProfileHandoffState = {
        ...state,
        ...prepared,
      };
      this.handoffState = preparedState;
      await this.saveHandoff(preparedState);
      this.renderHandoff(preparedState);
      return;
    }
    await this.launchProvider(state);
  }

  private restoreHandoff(state: ProfileHandoffState): void {
    document.body.classList.add('profile-flow-active');
    this.handoffState = state;
    this.source = state.profileImportProvider;
    const provider = PROFILE_PROVIDERS[state.profileImportProvider];
    this.prompt.value = provider.prompt;
    this.response.value = '';
    this.clearErrors(this.validationErrors);
    this.renderHandoff(state);
    this.root.hidden = false;
    this.showStep(this.promptStep);
  }

  private renderHandoff(state: ProfileHandoffState): void {
    const provider = state.profileImportProvider;
    const providerName =
      provider === 'other' ? p('другим AI') : p(sourceLabels[provider] ?? '');
    this.providerTitle.textContent =
      provider === 'other'
        ? p('Создайте профиль с другим AI')
        : p('Вернитесь с ответом {provider}', { provider: providerName });
    this.reopenProviderButton.hidden = provider === 'other';
    this.claudeWebFallbackButton.hidden =
      provider !== 'claude' || state.method === 'clipboard-and-web';
    if (provider !== 'other') {
      this.reopenProviderButton.textContent =
        provider === 'chatgpt' && state.providerOpened !== true
          ? p('Открыть ChatGPT')
          : p('Открыть {provider} снова', { provider: providerName });
    }

    const openFailed = state.providerOpened === false;
    const copyRequired =
      provider === 'chatgpt' || state.method === 'clipboard-and-web';
    const copyFailed = copyRequired && state.promptCopied === false;
    const usesWebFallback =
      provider === 'claude' && state.method === 'clipboard-and-web';
    let statusText = p('Используйте запрос ниже в любом AI.');
    let instructions = [
      p('Скопируйте запрос и отправьте его выбранному AI.'),
      p('Скопируйте JSON-ответ.'),
      p('Вставьте ответ в поле ниже.'),
    ];

    if (provider === 'chatgpt') {
      statusText =
        state.promptCopied === undefined
          ? p('Копируем запрос и открываем ChatGPT…')
          : copyFailed
            ? p(
                'Не удалось скопировать автоматически. Покажите запрос и скопируйте его вручную.',
              )
            : state.providerOpened === true
              ? p('Запрос скопирован, ChatGPT открыт.')
              : p(
                  'Запрос уже скопирован. Откройте ChatGPT кнопкой ниже, вставьте его в поле сообщения и отправьте.',
                );
      instructions = [
        p('Вставьте запрос в ChatGPT и отправьте его.'),
        p('Скопируйте полученный JSON-ответ.'),
        p('Вернитесь сюда и вставьте ответ ниже.'),
      ];
    } else if (provider === 'claude') {
      statusText = usesWebFallback
        ? copyFailed
          ? p('Claude открыт. Покажите запрос и скопируйте его вручную.')
          : p('Запрос скопирован, Claude открыт в браузере.')
        : p('Claude открыт с подготовленным запросом.');
      instructions = usesWebFallback
        ? [
            p('Вставьте запрос в Claude и отправьте его.'),
            p('Скопируйте полученный JSON-ответ.'),
            p('Вернитесь сюда и вставьте ответ ниже.'),
          ]
        : [
            p('Отправьте уже подготовленный запрос.'),
            p('Скопируйте полученный JSON-ответ.'),
            p('Вернитесь сюда и вставьте ответ ниже.'),
          ];
    }

    if (openFailed) {
      statusText = p(
        '{provider} не открылся автоматически. Откройте сервис снова или используйте запрос вручную.',
        { provider: providerName },
      );
    }
    this.handoffStatus.textContent = statusText;
    this.handoffInstructions.replaceChildren();
    for (const text of instructions) {
      const item = document.createElement('li');
      item.textContent = text;
      this.handoffInstructions.append(item);
    }
    this.setManualPromptVisible(
      provider === 'other' || copyFailed || openFailed,
    );
  }

  private setManualPromptVisible(visible: boolean): void {
    this.manualPrompt.hidden = !visible;
    this.showPromptButton.textContent = visible
      ? p('Скрыть запрос')
      : p('Показать запрос вручную');
  }

  private async launchProvider(state: ProfileHandoffState): Promise<void> {
    const provider = state.profileImportProvider;
    if (provider === 'other') return;
    const prompt = PROFILE_PROVIDERS[provider].prompt;
    const result = await launchProfileHandoff(
      provider,
      prompt,
      undefined,
      async (prepared) => {
        const preparedState: ProfileHandoffState = {
          profileImportProvider: state.profileImportProvider,
          profileImportStage: state.profileImportStage,
          startedAt: state.startedAt,
          ...prepared,
        };
        this.handoffState = preparedState;
        await this.saveHandoff(preparedState);
        this.renderHandoff(preparedState);
      },
    );
    const resultState: ProfileHandoffState = {
      ...state,
      method: result.method,
      promptCopied: result.promptCopied,
      providerOpened: result.providerOpened,
    };
    this.handoffState = resultState;
    await this.saveHandoff(resultState);
    this.renderHandoff(resultState);
  }

  private async reopenProvider(): Promise<void> {
    if (!this.handoffState) return;
    await this.launchProvider({
      profileImportProvider: this.handoffState.profileImportProvider,
      profileImportStage: this.handoffState.profileImportStage,
      startedAt: new Date().toISOString(),
      method: this.handoffState.method,
      promptCopied: this.handoffState.promptCopied,
    });
  }

  private async openClaudeWebFallback(): Promise<void> {
    if (this.handoffState?.profileImportProvider !== 'claude') return;
    const state: ProfileHandoffState = {
      profileImportProvider: 'claude',
      profileImportStage: 'waiting-for-response',
      startedAt: new Date().toISOString(),
      method: 'clipboard-and-web',
    };
    const prompt = PROFILE_PROVIDERS.claude.prompt;
    const result = await launchClaudeWebFallback(
      prompt,
      undefined,
      async (prepared) => {
        const preparedState = { ...state, ...prepared };
        this.handoffState = preparedState;
        await this.saveHandoff(preparedState);
        this.renderHandoff(preparedState);
      },
    );
    const resultState: ProfileHandoffState = {
      ...state,
      method: result.method,
      promptCopied: result.promptCopied,
      providerOpened: result.providerOpened,
    };
    this.handoffState = resultState;
    await this.saveHandoff(resultState);
    this.renderHandoff(resultState);
  }

  private async openManual(): Promise<void> {
    await this.beginProfileOperation();
    this.handoffState = null;
    this.source = 'manual';
    this.draft = createEmptyProfile();
    this.renderReview();
  }

  private async copyPrompt(button: HTMLButtonElement): Promise<void> {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(this.prompt.value);
      button.textContent = p('Скопировано');
    } catch {
      this.prompt.focus();
      this.prompt.select();
      button.textContent = p('Выделено — скопируйте');
    }
    window.setTimeout(() => {
      button.textContent = original;
    }, 1600);
  }

  private validateImport(): void {
    const validation = validatePortableProfile(this.response.value);
    if (!validation.ok) {
      this.renderErrors(this.validationErrors, validation.errors);
      return;
    }
    this.clearErrors(this.validationErrors);
    this.draft = normalizePortableProfile(validation.value, this.source);
    this.renderReview();
  }

  private renderReview(): void {
    if (!this.draft) return;
    document.body.classList.add('profile-flow-active');
    this.reviewSource.textContent =
      this.source === 'manual'
        ? p('Создайте только полезный минимум. Всё можно изменить позже.')
        : p('Источник: {source}. Это гипотеза — проверьте каждый пункт.', {
            source: p(sourceLabels[this.source]),
          });
    this.reviewContent.replaceChildren();
    this.clearErrors(this.reviewErrors);
    this.renderCollection(p('Интересы'), 'interests');
    this.renderCollection(p('Текущие цели'), 'goals');
    this.renderCollection(p('Широкая экспертиза'), 'expertise');
    this.renderCollection(p('Подтверждённые знания'), 'demonstratedKnowledge');
    this.renderCollection(p('Что сейчас изучаете'), 'learningAreas');
    this.renderCollection(p('Неопределённости профиля'), 'uncertainties');
    this.renderPreferences();
    this.renderLeisurePreferences();
    this.renderCollection(p('Обычно малоценные темы'), 'lowValueTopics');
    this.root.hidden = false;
    this.showStep(this.reviewStep);
  }

  private renderCollection(title: string, collection: ProfileCollection): void {
    if (!this.draft) return;
    const section = document.createElement('section');
    section.className = 'profile-review-group';
    const heading = document.createElement('h4');
    heading.textContent = title;
    section.append(heading);
    const entries = this.draft[collection];
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'profile-empty';
      empty.textContent = p('Нет данных');
      section.append(empty);
    }
    for (const item of entries) {
      const card = document.createElement('div');
      card.className = 'profile-edit-card';
      const fields = document.createElement('div');
      fields.className = 'profile-edit-fields';
      if (collection === 'interests') {
        const interest = item as PersonalProfile['interests'][number];
        fields.append(
          field(
            p('Тема'),
            textInput(interest.topic, p('Тема интереса'), (value) => {
              interest.topic = value;
            }),
          ),
          field(
            p('Сила'),
            confidenceInput(interest.strength, (value) => {
              interest.strength = value;
            }),
          ),
          field(
            p('Уверенность'),
            confidenceInput(interest.confidence, (value) => {
              interest.confidence = value;
            }),
          ),
        );
      } else if (collection === 'goals') {
        const goal = item as PersonalProfile['goals'][number];
        fields.append(
          field(
            p('Цель'),
            textInput(goal.goal, p('Текущая цель'), (value) => {
              goal.goal = value;
            }),
          ),
          field(
            p('Приоритет'),
            selectInput<GoalPriority>(
              goal.priority,
              ['low', 'medium', 'high'],
              p('Приоритет цели'),
              (value) => {
                goal.priority = value;
              },
            ),
          ),
          field(
            p('Статус'),
            selectInput<GoalStatus>(
              goal.status,
              ['active', 'paused', 'completed'],
              p('Статус цели'),
              (value) => {
                goal.status = value;
              },
            ),
          ),
          field(
            p('Уверенность'),
            confidenceInput(goal.confidence, (value) => {
              goal.confidence = value;
            }),
          ),
        );
      } else if (collection === 'expertise') {
        const expertise = item as PersonalProfile['expertise'][number];
        fields.append(
          field(
            p('Область'),
            textInput(expertise.topic, p('Область экспертизы'), (value) => {
              expertise.topic = value;
            }),
          ),
          field(
            p('Уровень'),
            selectInput<ExpertiseLevel>(
              expertise.level,
              ['beginner', 'intermediate', 'advanced', 'expert'],
              p('Уровень экспертизы'),
              (value) => {
                expertise.level = value;
              },
            ),
          ),
          field(
            p('Уверенность'),
            confidenceInput(expertise.confidence, (value) => {
              expertise.confidence = value;
            }),
          ),
        );
      } else if (collection === 'lowValueTopics') {
        const lowValue = item as PersonalProfile['lowValueTopics'][number];
        fields.append(
          field(
            p('Тема'),
            textInput(lowValue.topic, p('Малоценная тема'), (value) => {
              lowValue.topic = value;
            }),
          ),
          field(
            p('Уверенность'),
            confidenceInput(lowValue.confidence, (value) => {
              lowValue.confidence = value;
            }),
          ),
        );
      } else if (collection === 'demonstratedKnowledge') {
        const knowledge =
          item as PersonalProfile['demonstratedKnowledge'][number];
        fields.append(
          field(
            p('Область'),
            textInput(knowledge.topic, p('Область знания'), (value) => {
              knowledge.topic = value;
            }),
          ),
          field(
            p('Что уже известно'),
            textInput(
              knowledge.statement,
              p('Известное утверждение'),
              (value) => {
                knowledge.statement = value;
              },
            ),
          ),
          field(
            p('Основание'),
            selectInput<KnowledgeEvidenceType>(
              knowledge.evidenceType,
              ['demonstrated', 'explicitly_stated', 'inferred'],
              p('Тип основания знания'),
              (value) => {
                knowledge.evidenceType = value;
              },
            ),
          ),
          field(
            p('Уверенность'),
            confidenceInput(knowledge.confidence, (value) => {
              knowledge.confidence = value;
            }),
          ),
        );
      } else if (collection === 'learningAreas') {
        const learning = item as PersonalProfile['learningAreas'][number];
        fields.append(
          field(
            p('Область'),
            textInput(learning.topic, p('Изучаемая область'), (value) => {
              learning.topic = value;
            }),
          ),
          field(
            p('Фокус'),
            textInput(learning.focus ?? '', p('Текущий фокус'), (value) => {
              learning.focus = value.trim() ? value : null;
            }),
          ),
          field(
            p('Уверенность'),
            confidenceInput(learning.confidence, (value) => {
              learning.confidence = value;
            }),
          ),
        );
      } else {
        const uncertainty = item as PersonalProfile['uncertainties'][number];
        fields.append(
          field(
            p('Область'),
            textInput(
              uncertainty.topic,
              p('Неопределённая область'),
              (value) => {
                uncertainty.topic = value;
              },
            ),
          ),
          field(
            p('Что неизвестно'),
            textInput(uncertainty.note, p('Неопределённость'), (value) => {
              uncertainty.note = value;
            }),
          ),
          field(
            p('Уверенность'),
            confidenceInput(uncertainty.confidence, (value) => {
              uncertainty.confidence = value;
            }),
          ),
        );
      }
      card.append(fields, this.removeButton(collection, item.id));
      section.append(card);
    }
    this.reviewContent.append(section);
  }

  private renderPreferences(): void {
    if (!this.draft) return;
    const section = document.createElement('section');
    section.className = 'profile-review-group';
    const heading = document.createElement('h4');
    heading.textContent = p('Предпочтения по материалам');
    section.append(heading);
    const preferences = this.draft.contentPreferences;
    if (!preferences) {
      const empty = document.createElement('p');
      empty.className = 'profile-empty';
      empty.textContent = p('Не указаны');
      section.append(empty);
    } else {
      const card = document.createElement('div');
      card.className = 'profile-edit-card';
      const fields = document.createElement('div');
      fields.className = 'profile-edit-fields';
      fields.append(
        field(
          p('Глубина'),
          selectInput<PreferenceLevel>(
            preferences.preferredDepth,
            ['low', 'medium', 'high'],
            p('Предпочитаемая глубина'),
            (value) => {
              preferences.preferredDepth = value;
            },
          ),
        ),
        field(
          p('Новизна'),
          selectInput<PreferenceLevel>(
            preferences.noveltyPreference,
            ['low', 'medium', 'high'],
            p('Предпочитаемая новизна'),
            (value) => {
              preferences.noveltyPreference = value;
            },
          ),
        ),
        field(
          p('Форматы через запятую'),
          textInput(
            preferences.preferredFormats.join(', '),
            p('Предпочитаемые форматы'),
            (value) => {
              preferences.preferredFormats = value
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
            },
          ),
        ),
        field(
          p('Уверенность'),
          confidenceInput(preferences.confidence, (value) => {
            preferences.confidence = value;
          }),
        ),
      );
      const repeatLabel = document.createElement('label');
      repeatLabel.className = 'profile-checkbox';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = preferences.avoidRepetition;
      checkbox.addEventListener('change', () => {
        preferences.avoidRepetition = checkbox.checked;
      });
      const repeatText = document.createElement('span');
      repeatText.textContent = p('Избегать повторов уже известного');
      repeatLabel.append(checkbox, repeatText);
      fields.append(repeatLabel);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'profile-remove';
      remove.textContent = p('Удалить');
      remove.addEventListener('click', () => {
        if (!this.draft) return;
        this.draft.contentPreferences = null;
        this.renderReview();
      });
      card.append(fields, remove);
      section.append(card);
    }
    this.reviewContent.append(section);
  }

  private renderLeisurePreferences(): void {
    if (!this.draft) return;
    const leisure = this.draft.leisureProfile;
    const section = document.createElement('section');
    section.className = 'profile-review-group';
    const heading = document.createElement('h4');
    heading.textContent = p('Предпочтения для отдыха');
    section.append(heading);

    if (leisure.preferences.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'profile-empty';
      empty.textContent = p(
        'Недостаточно данных — в режиме отдыха профиль не будет ничего додумывать.',
      );
      section.append(empty);
    }

    for (const preference of leisure.preferences) {
      const card = document.createElement('div');
      card.className = 'profile-edit-card';
      const fields = document.createElement('div');
      fields.className = 'profile-edit-fields';
      fields.append(
        field(
          p('Тип'),
          selectInput<LeisurePreferenceKind>(
            preference.kind,
            ['genre', 'format', 'creator', 'recreationalTopic', 'dislike'],
            p('Тип предпочтения для отдыха'),
            (value) => {
              preference.kind = value;
            },
          ),
        ),
        field(
          p('Что именно'),
          textInput(
            preference.category,
            p('Предпочтение для отдыха'),
            (value) => {
              preference.category = value;
            },
          ),
        ),
        field(
          p('Насколько нравится'),
          selectInput<LeisurePreferenceLevel>(
            preference.preference,
            ['low', 'medium', 'high', 'unknown'],
            p('Сила предпочтения'),
            (value) => {
              preference.preference = value;
            },
          ),
        ),
        field(
          p('Основание'),
          selectInput<KnowledgeEvidenceType>(
            preference.evidenceType,
            ['demonstrated', 'explicitly_stated', 'inferred'],
            p('Основание предпочтения'),
            (value) => {
              preference.evidenceType = value;
            },
          ),
        ),
        field(
          p('Почему так решено'),
          textInput(preference.basis, p('Основание предпочтения'), (value) => {
            preference.basis = value;
          }),
        ),
        field(
          p('Уверенность'),
          confidenceInput(preference.confidence, (value) => {
            preference.confidence = value;
          }),
        ),
      );
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'profile-remove';
      remove.textContent = p('Удалить');
      remove.addEventListener('click', () => {
        if (!this.draft) return;
        this.draft.leisureProfile.preferences =
          this.draft.leisureProfile.preferences.filter(
            (item) => item.id !== preference.id,
          );
        if (this.draft.leisureProfile.preferences.length === 0) {
          this.draft.leisureProfile.status = 'insufficient_data';
          this.draft.leisureProfile.confidence = 0;
        }
        this.renderReview();
      });
      card.append(fields, remove);
      section.append(card);
    }

    if (leisure.preferences.length > 0) {
      const settings = document.createElement('div');
      settings.className = 'profile-edit-card';
      const fields = document.createElement('div');
      fields.className = 'profile-edit-fields';
      fields.append(
        field(
          p('Новое или знакомое'),
          selectInput<LeisureNoveltyPreference | 'unknown'>(
            leisure.noveltyPreference ?? 'unknown',
            ['unknown', 'familiar', 'balanced', 'novel'],
            p('Новизна для отдыха'),
            (value) => {
              leisure.noveltyPreference = value === 'unknown' ? null : value;
            },
          ),
        ),
        field(
          p('Предпочитаемое усилие'),
          selectInput<CognitiveEffort | 'unknown'>(
            leisure.effortPreference ?? 'unknown',
            ['unknown', 'low', 'medium', 'high'],
            p('Предпочитаемое усилие для отдыха'),
            (value) => {
              leisure.effortPreference = value === 'unknown' ? null : value;
            },
          ),
        ),
        field(
          p('Обычная сессия, минут'),
          optionalMinutesInput(leisure.typicalSessionMinutes, (value) => {
            leisure.typicalSessionMinutes = value;
          }),
        ),
        field(
          p('Уверенность профиля'),
          confidenceInput(leisure.confidence, (value) => {
            leisure.confidence = value;
          }),
        ),
      );
      settings.append(fields);
      section.append(settings);
    }
    this.reviewContent.append(section);
  }

  private removeButton(
    collection: ProfileCollection,
    id: string,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-remove';
    button.textContent = p('Удалить');
    button.addEventListener('click', () => {
      if (!this.draft) return;
      this.draft = {
        ...this.draft,
        [collection]: this.draft[collection].filter((item) => item.id !== id),
      };
      this.renderReview();
    });
    return button;
  }

  private addItem(
    collection: ProfileCollection | 'contentPreferences' | 'leisurePreferences',
  ): void {
    if (!this.draft) return;
    const sources = attribution(this.source);
    if (collection === 'interests') {
      this.draft.interests.push({
        id: createManualEntryId('interest'),
        topic: '',
        strength: 0.5,
        confidence: 1,
        sources,
      });
    } else if (collection === 'goals') {
      this.draft.goals.push({
        id: createManualEntryId('goal'),
        goal: '',
        priority: 'medium',
        status: 'active',
        confidence: 1,
        sources,
      });
    } else if (collection === 'expertise') {
      this.draft.expertise.push({
        id: createManualEntryId('expertise'),
        topic: '',
        level: 'intermediate',
        confidence: 1,
        basis: [p('Добавлено пользователем')],
        sources,
      });
    } else if (collection === 'lowValueTopics') {
      this.draft.lowValueTopics.push({
        id: createManualEntryId('low-value'),
        topic: '',
        confidence: 1,
        sources,
      });
    } else if (collection === 'demonstratedKnowledge') {
      this.draft.demonstratedKnowledge.push({
        id: createManualEntryId('knowledge'),
        topic: '',
        statement: '',
        evidenceType: 'explicitly_stated',
        confidence: 1,
        basis: [p('Добавлено пользователем')],
        sources,
      });
    } else if (collection === 'learningAreas') {
      this.draft.learningAreas.push({
        id: createManualEntryId('learning'),
        topic: '',
        focus: null,
        confidence: 1,
        sources,
      });
    } else if (collection === 'uncertainties') {
      this.draft.uncertainties.push({
        id: createManualEntryId('uncertainty'),
        topic: '',
        note: '',
        confidence: 1,
        sources,
      });
    } else if (collection === 'leisurePreferences') {
      this.draft.leisureProfile.status = 'available';
      this.draft.leisureProfile.confidence = Math.max(
        this.draft.leisureProfile.confidence,
        1,
      );
      this.draft.leisureProfile.preferences.push({
        id: createManualEntryId('leisure'),
        kind: 'genre',
        category: '',
        preference: 'high',
        confidence: 1,
        evidenceType: 'explicitly_stated',
        basis: p('Добавлено пользователем'),
        sources,
      });
    } else if (!this.draft.contentPreferences) {
      this.draft.contentPreferences = {
        preferredDepth: 'medium',
        noveltyPreference: 'medium',
        avoidRepetition: true,
        preferredFormats: [],
        confidence: 1,
        sources,
      };
    }
    this.renderReview();
  }

  private async acceptDraft(): Promise<void> {
    if (!this.draft) return;
    const errors = profileErrors(this.draft);
    if (errors.length > 0) {
      this.renderErrors(this.reviewErrors, errors);
      return;
    }
    if (!this.existing) {
      await this.persist(this.draft);
      return;
    }
    const result = mergeProfiles(this.existing, this.draft);
    if (result.conflicts.length === 0) {
      await this.persist(result.merged);
      return;
    }
    this.pendingMerge = result;
    this.renderConflicts(result);
  }

  private renderConflicts(result: MergeResult): void {
    document.body.classList.add('profile-flow-active');
    this.conflictContent.replaceChildren();
    for (const conflict of result.conflicts) {
      const card = document.createElement('fieldset');
      card.className = 'profile-conflict';
      const legend = document.createElement('legend');
      legend.textContent = conflict.label;
      card.append(legend);
      const values =
        conflict.kind === 'expertise'
          ? [
              p(levelLabels[conflict.existing.level] ?? ''),
              p(levelLabels[conflict.incoming.level] ?? ''),
            ]
          : conflict.kind === 'goal'
            ? [
                `${p(levelLabels[conflict.existing.priority] ?? '')} · ${p(levelLabels[conflict.existing.status] ?? '')}`,
                `${p(levelLabels[conflict.incoming.priority] ?? '')} · ${p(levelLabels[conflict.incoming.status] ?? '')}`,
              ]
            : [
                `${p('Глубина')}: ${p(levelLabels[conflict.existing.preferredDepth] ?? '')} · ${p('Новизна')}: ${p(levelLabels[conflict.existing.noveltyPreference] ?? '')}`,
                `${p('Глубина')}: ${p(levelLabels[conflict.incoming.preferredDepth] ?? '')} · ${p('Новизна')}: ${p(levelLabels[conflict.incoming.noveltyPreference] ?? '')}`,
              ];
      for (const [index, choice] of ['existing', 'incoming'].entries()) {
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `conflict-${conflict.id}`;
        radio.value = choice;
        radio.checked = index === 0;
        const text = document.createElement('span');
        text.textContent = `${index === 0 ? p('Оставить текущее') : p('Использовать импорт')}: ${values[index]}`;
        label.append(radio, text);
        card.append(label);
      }
      this.conflictContent.append(card);
    }
    this.showStep(this.mergeStep);
  }

  private async confirmMerge(): Promise<void> {
    if (!this.pendingMerge) return;
    const resolutions: Record<string, 'existing' | 'incoming'> = {};
    for (const conflict of this.pendingMerge.conflicts) {
      const selected = document.querySelector<HTMLInputElement>(
        `input[name="conflict-${CSS.escape(conflict.id)}"]:checked`,
      );
      resolutions[conflict.id] =
        selected?.value === 'incoming' ? 'incoming' : 'existing';
    }
    await this.persist(resolveMerge(this.pendingMerge, resolutions));
  }

  private async persist(profile: PersonalProfile): Promise<void> {
    const operation = this.operation;
    if (!operation) return;
    try {
      await commitDataOperation(operation, async () => {
        await saveProfile(profile, this.source, this.draft ?? profile);
        await clearProfileHandoffState();
      });
    } catch (error) {
      if (!(error instanceof DataOperationCancelledError)) throw error;
      this.draft = null;
      this.pendingMerge = null;
      this.operation = null;
      const target = !this.quickReviewStep.hidden
        ? this.quickError
        : this.reviewErrors;
      if (target === this.quickError) this.showStep(this.quickStep);
      if (target instanceof HTMLUListElement) {
        this.renderErrors(target, [
          p(
            'Профиль не сохранён: данные были удалены. Начните настройку заново.',
          ),
        ]);
      } else {
        target.textContent = p(
          'Профиль не сохранён: данные были удалены. Начните настройку заново.',
        );
        target.hidden = false;
      }
      return;
    }
    this.handoffState = null;
    this.existing = profile;
    this.draft = null;
    this.pendingMerge = null;
    this.operation = null;
    this.response.value = '';
    this.showStep(this.sourceStep);
    this.root.hidden = true;
    document.body.classList.remove('profile-flow-active');
    this.renderProfileBar();
    await this.options.onComplete();
  }

  private async skip(): Promise<void> {
    // The old skip action cannot activate an empty installation, even when
    // invoked directly or left over in a previously open popup.
    if (!isProfileReady(await loadProfile())) return;
    const operation = this.operation ?? (await beginDataOperation());
    await commitDataOperation(operation, async () => {
      await clearProfileHandoffState();
    });
    this.handoffState = null;
    this.root.hidden = true;
    document.body.classList.remove('profile-flow-active');
    this.renderProfileBar();
    await this.options.onComplete();
  }

  private async removeProfile(): Promise<void> {
    if (!window.confirm(p('Удалить весь локальный личный профиль?'))) return;
    await deleteProfile();
    this.existing = null;
    this.renderProfileBar();
    await this.options.onComplete();
  }

  private renderProfileBar(): void {
    const ready = isProfileReady(this.existing);
    element<HTMLButtonElement>('skip-profile').hidden = !ready;
    for (const item of this.root.querySelectorAll<HTMLElement>(
      '[data-profile-requires-ready]',
    ))
      item.hidden = !ready;
    for (const item of this.root.querySelectorAll<HTMLElement>(
      '[data-profile-required]',
    ))
      item.hidden = ready;
    this.profileBar.hidden = false;
    if (!this.existing) {
      this.profileBarText.textContent = profileBarSummary(null);
      this.deleteButton.hidden = true;
      return;
    }
    const count =
      this.existing.interests.length +
      this.existing.goals.length +
      this.existing.expertise.length +
      this.existing.lowValueTopics.length +
      this.existing.demonstratedKnowledge.length +
      this.existing.learningAreas.length +
      this.existing.uncertainties.length +
      this.existing.leisureProfile.preferences.length +
      (this.existing.contentPreferences ? 1 : 0);
    this.profileBarText.textContent = profileBarSummary(count);
    this.deleteButton.hidden = false;
  }

  private renderErrors(list: HTMLUListElement, errors: string[]): void {
    list.replaceChildren();
    for (const error of errors) {
      const item = document.createElement('li');
      const translated = p(error);
      item.textContent =
        normalizeUiLanguage(document.documentElement.lang) !== 'ru' &&
        /[а-яё]/iu.test(translated)
          ? p('Проверьте формат JSON и обязательные поля профиля.')
          : translated;
      list.append(item);
    }
    list.hidden = false;
  }

  private clearErrors(list: HTMLUListElement): void {
    list.replaceChildren();
    list.hidden = true;
  }

  private async beginProfileOperation(
    clearHandoff = true,
  ): Promise<DataOperation> {
    const operation = await beginDataOperation();
    this.operation = operation;
    const existing = await commitDataOperation(operation, async () => {
      const profile = await loadProfile();
      if (clearHandoff) await clearProfileHandoffState();
      return profile;
    });
    if (this.operation !== operation) throw new DataOperationCancelledError();
    this.existing = existing;
    return operation;
  }

  private runAction(action: Promise<unknown>): void {
    void action.catch((error: unknown) => {
      if (
        !this.root.isConnected ||
        (error instanceof DataOperationCancelledError &&
          this.operation === null)
      )
        return;
      const message =
        error instanceof DataOperationCancelledError
          ? p(
              'Профиль не сохранён: данные были удалены. Начните настройку заново.',
            )
          : p('Не удалось подготовить профиль. Попробуйте ещё раз.');
      if (error instanceof DataOperationCancelledError) {
        this.operation = null;
        this.draft = null;
        this.pendingMerge = null;
        this.handoffState = null;
      }
      this.root.hidden = false;
      this.showStep(this.promptStep);
      this.handoffStatus.textContent = message;
      this.reopenProviderButton.hidden = true;
      this.claudeWebFallbackButton.hidden = true;
    });
  }

  private async saveHandoff(state: ProfileHandoffState): Promise<void> {
    const operation = state.generation
      ? {
          generation: state.generation,
          vaultEpoch: state.vaultEpoch ?? this.operation?.vaultEpoch,
        }
      : this.operation;
    if (!operation) throw new DataOperationCancelledError();
    await commitDataOperation(operation, () =>
      saveProfileHandoffState({
        ...state,
        generation: operation.generation,
        vaultEpoch: operation.vaultEpoch,
      }),
    );
  }
}
