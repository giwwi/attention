import { cardText } from '../i18n/card';
import { uiText, type UiLanguage, type UiTextKey } from '../i18n/ui';
import type { AnalysisContext } from '../shared/types';
import { isTrustedUserInteraction } from './user-interaction';

const scenarios = ['work', 'learn', 'explore', 'relax'] as const;

/** The article's small context editor; it never reads personal storage. */
export class CardContextControl {
  readonly details = document.createElement('details');
  private readonly summary = document.createElement('summary');
  private readonly form = document.createElement('form');
  private readonly scenario = document.createElement('select');
  private readonly minutes = document.createElement('select');
  private readonly intent = document.createElement('input');
  private readonly mood = document.createElement('select');
  private readonly effort = document.createElement('select');
  private readonly relax = document.createElement('div');
  private readonly apply = document.createElement('button');
  private readonly status = document.createElement('p');
  private readonly labels: Array<[HTMLElement, UiTextKey | 'cardIntent']> = [];
  private context: AnalysisContext = {
    scenario: 'work',
    intent: '',
    availableMinutes: 15,
  };
  private language: UiLanguage = 'en';
  private dirty = false;
  private revision = 0;
  private pending = false;
  private submitArmed = false;
  private confirmingSelect = false;

  constructor(
    slot: HTMLElement,
    private readonly save: (
      context: AnalysisContext,
    ) => Promise<AnalysisContext>,
    signal: AbortSignal,
  ) {
    this.details.className = 'card-context';
    this.summary.className = 'context-summary';
    this.form.className = 'context-form';
    this.scenario.className = 'context-scenario';
    this.minutes.className = 'context-minutes';
    this.intent.className = 'context-intent';
    this.intent.type = 'text';
    this.intent.maxLength = 180;
    this.intent.autocomplete = 'off';
    this.apply.type = 'submit';
    this.apply.className = 'context-apply';
    this.status.className = 'context-status';
    this.status.setAttribute('role', 'status');
    this.status.hidden = true;
    const options = (select: HTMLSelectElement, values: readonly string[]) => {
      for (const value of values) {
        const option = document.createElement('option');
        option.value = value;
        select.append(option);
      }
    };
    options(this.scenario, scenarios);
    options(this.minutes, ['5', '15', '30']);
    options(this.mood, [
      '',
      'chill',
      'funny',
      'interesting',
      'exciting',
      'familiar',
      'surprise',
    ]);
    options(this.effort, ['', 'low', 'medium', 'high']);
    const field = (control: HTMLElement, key: UiTextKey | 'cardIntent') => {
      const label = document.createElement('label');
      const text = document.createElement('span');
      this.labels.push([text, key]);
      label.append(text, control);
      return label;
    };
    const row = document.createElement('div');
    row.className = 'context-selects';
    row.append(
      field(this.scenario, 'scenario'),
      field(this.minutes, 'availableTime'),
    );
    this.relax.className = 'context-selects';
    this.relax.append(
      field(this.mood, 'relaxMood'),
      field(this.effort, 'effort'),
    );
    this.form.append(
      row,
      field(this.intent, 'cardIntent'),
      this.relax,
      this.apply,
      this.status,
    );
    this.details.append(this.summary, this.form);
    const style = document.createElement('style');
    style.textContent = `
      .card-context { font: 500 12px/1.4 system-ui, sans-serif; margin: 2px 0 14px; }
      .context-summary { width: fit-content; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--attention-muted); cursor: pointer; border-radius: 5px; }
      .context-summary:hover { color: var(--attention-accent); }
      .context-summary:focus-visible { outline: 2px solid var(--attention-accent); outline-offset: 3px; }
      .context-form { display: grid; gap: 12px; margin-top: 12px; padding: 12px; border-radius: 10px; background: var(--attention-inset-bg); }
      .context-form label { display: grid; gap: 5px; min-width: 0; color: var(--attention-secondary); font-size: 12px; }
      .context-selects { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .context-selects[hidden], .context-status[hidden] { display: none; }
      .context-form input, .context-form select { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--attention-input-border); border-radius: 7px; padding: 8px; color: var(--attention-fg); background: var(--attention-control-bg); font: inherit; }
      .context-form input:focus-visible, .context-form select:focus-visible, .context-apply:focus-visible { outline: 2px solid var(--attention-accent); outline-offset: 2px; }
      .context-apply { border: 0; border-radius: 7px; padding: 9px; color: var(--attention-on-accent); background: var(--attention-accent); font: 600 12px/1.4 system-ui, sans-serif; cursor: pointer; }
      .context-apply:not(:disabled):hover { background: var(--attention-accent-hover); }
      .context-form :disabled { opacity: .55; cursor: wait; }
      .context-status { margin: 0; color: var(--attention-error); font-size: 12px; }
    `;
    slot.append(style, this.details);
    this.form.addEventListener(
      'input',
      (event) => {
        if (isTrustedUserInteraction(event)) this.dirty = true;
      },
      { signal },
    );
    this.scenario.addEventListener(
      'change',
      () => {
        this.relax.hidden = this.scenario.value !== 'relax';
      },
      { signal },
    );
    this.form.addEventListener(
      'submit',
      (event) => {
        event.preventDefault();
        const allowed = this.submitArmed && isTrustedUserInteraction(event);
        this.submitArmed = false;
        if (!allowed || this.pending) return;
        void this.submit();
      },
      { signal },
    );
    this.apply.addEventListener(
      'click',
      (event) => {
        this.submitArmed =
          isTrustedUserInteraction(event) &&
          !(this.confirmingSelect && event.detail === 0);
        if (!this.submitArmed) event.preventDefault();
      },
      { signal },
    );
    this.form.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter') return;
        // Confirming a native select must not implicitly apply the whole form.
        if (event.target instanceof HTMLSelectElement) {
          this.submitArmed = false;
          this.confirmingSelect = true;
          return;
        }
        this.confirmingSelect = false;
        this.submitArmed = isTrustedUserInteraction(event);
        if (!this.submitArmed) event.preventDefault();
      },
      { signal },
    );
    this.form.addEventListener(
      'keyup',
      (event) => {
        if (event.key === 'Enter') {
          this.submitArmed = false;
          this.confirmingSelect = false;
        }
      },
      { signal },
    );
    signal.addEventListener('abort', () => this.reset());
  }

  render(context: AnalysisContext, language: UiLanguage): void {
    this.context = context;
    this.language = language;
    const scenario = context.scenario ?? 'work';
    this.summary.textContent = [
      uiText(language, scenario),
      uiText(language, 'minutesShort', { count: context.availableMinutes }),
      context.intent,
    ]
      .filter(Boolean)
      .join(' · ');
    this.summary.title = `${cardText(language, 'editContext')}: ${this.summary.textContent}`;
    this.summary.setAttribute('aria-label', this.summary.title);
    for (const [label, key] of this.labels) {
      label.textContent =
        key === 'cardIntent'
          ? cardText(language, 'intent')
          : uiText(language, key);
    }
    for (const option of this.scenario.options)
      option.textContent = uiText(
        language,
        option.value as (typeof scenarios)[number],
      );
    for (const option of this.minutes.options)
      option.textContent = uiText(language, 'minutesShort', {
        count: option.value,
      });
    const moodLabels: UiTextKey[] = [
      'any',
      'calm',
      'funny',
      'interesting',
      'exciting',
      'familiar',
      'surprise',
    ];
    const effortLabels: UiTextKey[] = ['any', 'easy', 'medium', 'hard'];
    Array.from(this.mood.options).forEach((option, index) => {
      option.textContent = uiText(language, moodLabels[index]!);
    });
    Array.from(this.effort.options).forEach((option, index) => {
      option.textContent = uiText(language, effortLabels[index]!);
    });
    this.intent.placeholder = cardText(language, 'intentPlaceholder');
    this.apply.textContent = cardText(language, 'apply');
    if (!this.dirty || !this.details.open) {
      this.scenario.value = scenario;
      this.minutes.value = String(context.availableMinutes);
      this.intent.value = context.intent;
      this.mood.value = context.relaxIntent ?? '';
      this.effort.value = context.desiredEffort ?? '';
    }
    this.relax.hidden = this.scenario.value !== 'relax';
  }

  reset(): void {
    this.revision += 1;
    this.pending = false;
    this.submitArmed = false;
    this.confirmingSelect = false;
    this.dirty = false;
    this.details.open = false;
    this.context = { scenario: 'work', intent: '', availableMinutes: 15 };
    this.intent.value = '';
    this.summary.textContent = '';
    this.summary.removeAttribute('title');
    this.summary.removeAttribute('aria-label');
    this.scenario.value = 'work';
    this.minutes.value = '15';
    this.mood.value = '';
    this.effort.value = '';
    this.status.hidden = true;
    this.disable(false);
  }

  private disable(disabled: boolean): void {
    for (const element of [
      this.scenario,
      this.minutes,
      this.intent,
      this.mood,
      this.effort,
      this.apply,
    ])
      element.disabled = disabled;
  }

  private async submit(): Promise<void> {
    const revision = ++this.revision;
    const context: AnalysisContext = {
      ...this.context,
      scenario: this.scenario.value as AnalysisContext['scenario'],
      availableMinutes: Number(
        this.minutes.value,
      ) as AnalysisContext['availableMinutes'],
      intent: this.intent.value.trim(),
      relaxIntent: (this.mood.value || null) as AnalysisContext['relaxIntent'],
      desiredEffort: (this.effort.value ||
        null) as AnalysisContext['desiredEffort'],
    };
    this.pending = true;
    // Disabling the focused input/button causes a blur to the page in Chromium.
    // Keep focus inside the card while persistence and re-evaluation finish.
    this.summary.focus({ preventScroll: true });
    this.disable(true);
    this.status.hidden = true;
    try {
      const saved = await this.save(context);
      if (revision !== this.revision) return;
      this.dirty = false;
      this.details.open = false;
      this.render(saved, this.language);
      this.summary.focus({ preventScroll: true });
    } catch {
      if (revision !== this.revision) return;
      this.status.textContent = cardText(this.language, 'contextFailed');
      this.status.hidden = false;
    } finally {
      if (revision === this.revision) {
        this.pending = false;
        this.disable(false);
      }
    }
  }
}
