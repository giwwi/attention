import { describe, expect, it, vi } from 'vitest';
import { installOutcomePrompt } from '../src/content/outcome-prompt';

describe('on-page outcome prompt', () => {
  it('collects a one-tap answer and confirms it without a popup', async () => {
    vi.useFakeTimers();
    const submit = vi.fn().mockResolvedValue(true);
    const prompt = installOutcomePrompt('open');
    prompt.show(submit);

    const host = document.querySelector<HTMLElement>(
      '[data-attention-outcome-prompt="true"]',
    );
    const worthIt = Array.from(
      host?.shadowRoot?.querySelectorAll<HTMLButtonElement>('.option') ?? [],
    ).find((button) => button.textContent === '👍 Worth it');
    if (!worthIt) throw new Error('Missing quick feedback button');

    worthIt.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(submit).toHaveBeenCalledWith('yes');
    expect(host?.dataset.state).toBe('saved');
    expect(host?.dataset.outcome).toBe('yes');
    expect(host?.shadowRoot?.textContent).toContain(
      'Thanks. Future recommendations will improve.',
    );

    await vi.advanceTimersByTimeAsync(449);
    expect(host?.style.display).toBe('block');
    await vi.advanceTimersByTimeAsync(1);
    expect(host?.style.display).toBe('none');

    prompt.setLanguage('ar');
    prompt.show(submit);
    expect(host?.shadowRoot?.querySelector('.panel')?.getAttribute('dir')).toBe(
      'rtl',
    );
    expect(host?.shadowRoot?.textContent).toContain(
      'هل استحقت هذه المادة وقتك؟',
    );
    vi.useRealTimers();
  });
});
