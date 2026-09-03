import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FirstValueOnboarding,
  normalizeFirstValueInterest,
  shouldShowFirstValueOnboarding,
} from '../src/onboarding/first-value';

function renderOnboarding(): void {
  document.body.innerHTML = `
    <section id="first-value-onboarding" hidden>
      <div id="first-value-scenario-step">
        <button data-first-value-scenario="work">Work</button>
        <button data-first-value-scenario="learn">Learn</button>
        <button data-first-value-scenario="explore">Explore</button>
        <button data-first-value-scenario="relax">Relax</button>
      </div>
      <div id="first-value-interest-step" hidden>
        <button id="first-value-back">Back</button>
        <textarea id="first-value-interest"></textarea>
        <button id="skip-first-value-interest">Skip</button>
        <button id="complete-first-value">Continue</button>
      </div>
    </section>
  `;
}

describe('value-first onboarding', () => {
  beforeEach(renderOnboarding);

  it('collects a scenario and an optional short intent without a profile', async () => {
    const onComplete = vi.fn();
    const onboarding = new FirstValueOnboarding({ onComplete });

    onboarding.open();
    document
      .querySelector<HTMLButtonElement>('[data-first-value-scenario="learn"]')
      ?.click();
    const interest = document.querySelector<HTMLTextAreaElement>(
      '#first-value-interest',
    );
    if (interest) interest.value = '  Understand   model routing  ';
    document.querySelector<HTMLButtonElement>('#complete-first-value')?.click();

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith({
        scenario: 'learn',
        interest: 'Understand model routing',
      });
    });
    expect(document.body.classList.contains('first-value-flow-active')).toBe(
      false,
    );
  });

  it('allows the user to skip the optional intent', async () => {
    const onComplete = vi.fn();
    const onboarding = new FirstValueOnboarding({ onComplete });
    onboarding.open();
    document
      .querySelector<HTMLButtonElement>('[data-first-value-scenario="relax"]')
      ?.click();
    document
      .querySelector<HTMLButtonElement>('#skip-first-value-interest')
      ?.click();

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith({
        scenario: 'relax',
        interest: '',
      });
    });
  });

  it('normalizes and bounds free text before storage', () => {
    expect(normalizeFirstValueInterest(`  ${'a '.repeat(200)}`)).toHaveLength(
      180,
    );
  });

  it('does not interrupt existing users who completed or created the old profile flow', () => {
    expect(shouldShowFirstValueOnboarding(true, null)).toBe(false);
    expect(
      shouldShowFirstValueOnboarding(false, { schemaVersion: '2.0' }),
    ).toBe(false);
    expect(shouldShowFirstValueOnboarding(undefined, undefined)).toBe(true);
  });
});
