import type { AttentionScenario } from '../shared/types';

export const FIRST_VALUE_INTEREST_MAX_LENGTH = 180;

export interface FirstValueSelection {
  scenario: AttentionScenario;
  interest: string;
}

interface FirstValueOnboardingOptions {
  onComplete(selection: FirstValueSelection): void | Promise<void>;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element: ${id}`);
  return value as T;
}

export function normalizeFirstValueInterest(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FIRST_VALUE_INTEREST_MAX_LENGTH);
}

export function shouldShowFirstValueOnboarding(
  onboardingComplete: unknown,
  storedProfile: unknown,
): boolean {
  return onboardingComplete !== true && !storedProfile;
}

export class FirstValueOnboarding {
  private readonly root = element<HTMLElement>('first-value-onboarding');
  private readonly scenarioStep = element<HTMLElement>(
    'first-value-scenario-step',
  );
  private readonly interestStep = element<HTMLElement>(
    'first-value-interest-step',
  );
  private readonly interestInput = element<HTMLTextAreaElement>(
    'first-value-interest',
  );
  private readonly continueButton = element<HTMLButtonElement>(
    'complete-first-value',
  );
  private readonly options: FirstValueOnboardingOptions;
  private scenario: AttentionScenario = 'work';
  private completing = false;

  constructor(options: FirstValueOnboardingOptions) {
    this.options = options;
    this.bindEvents();
  }

  open(): void {
    document.body.classList.add('first-value-flow-active');
    this.root.hidden = false;
    this.showStep(this.scenarioStep);
  }

  close(): void {
    this.root.hidden = true;
    document.body.classList.remove('first-value-flow-active');
  }

  private bindEvents(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      '[data-first-value-scenario]',
    )) {
      button.addEventListener('click', () => {
        const scenario = button.dataset.firstValueScenario;
        if (!isAttentionScenario(scenario)) return;
        this.scenario = scenario;
        this.showStep(this.interestStep);
        this.interestInput.focus();
      });
    }

    element<HTMLButtonElement>('first-value-back').addEventListener(
      'click',
      () => this.showStep(this.scenarioStep),
    );
    element<HTMLButtonElement>('skip-first-value-interest').addEventListener(
      'click',
      () => void this.complete(''),
    );
    this.continueButton.addEventListener('click', () => {
      void this.complete(this.interestInput.value);
    });
  }

  private showStep(active: HTMLElement): void {
    this.scenarioStep.hidden = active !== this.scenarioStep;
    this.interestStep.hidden = active !== this.interestStep;
  }

  private async complete(interest: string): Promise<void> {
    if (this.completing) return;
    this.completing = true;
    this.continueButton.disabled = true;
    try {
      await this.options.onComplete({
        scenario: this.scenario,
        interest: normalizeFirstValueInterest(interest),
      });
      this.close();
    } finally {
      this.completing = false;
      this.continueButton.disabled = false;
    }
  }
}

function isAttentionScenario(value: unknown): value is AttentionScenario {
  return ['work', 'learn', 'explore', 'relax'].includes(String(value));
}
