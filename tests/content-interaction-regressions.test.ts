import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installHoverPreview } from '../src/content/hover-preview';
import { isTrustedUserInteraction } from '../src/content/user-interaction';

vi.mock('../src/content/user-interaction', () => ({
  isTrustedUserInteraction: vi.fn(() => true),
}));

import { ATTENTION_INPUTS_INVALIDATED_TYPE } from '../src/background/input-invalidation';

const title = 'A rigorous article with evidence and practical implications';
const preview = {
  scenario: 'work',
  utilityScore: 78,
  recommendedAction: 'open',
  reason: 'Useful material.',
  expectedValue: 'New evidence.',
  risk: 'Some familiar context.',
  confidence: 'high',
  source: 'full-analysis',
  signalIds: [],
  calibrationSampleSize: 0,
  components: { relevance: 90, novelty: 70, actionability: 65, quality: 85 },
  estimatedUsefulMinutes: 8,
  recommendedSections: ['Evidence'],
};

describe('current article interactions', () => {
  let runtimeListeners: Array<(message: unknown) => void>;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(isTrustedUserInteraction).mockReturnValue(true);
    window.history.replaceState({}, '', '/essay.html');
    document.title = title;
    document.body.innerHTML = `<article><h1>${title}</h1><h2>Evidence</h2><p>${'A substantive article paragraph with evidence and practical context. '.repeat(120)}</p></article>`;
    const attachShadow = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
      this: Element,
      options,
    ) {
      return attachShadow.call(this, { ...options, mode: 'open' });
    });
    runtimeListeners = [];
    sendMessage = vi.fn(async (message: { type?: string }) =>
      message.type === 'ATTENTION_PREVIEW/REQUEST'
        ? {
            ok: true,
            aiState: 'not-connected',
            analysisSource: 'local',
            preview,
          }
        : {},
    );
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          sendMessage,
          onMessage: {
            addListener: (listener: (message: unknown) => void) =>
              runtimeListeners.push(listener),
            removeListener: (listener: (message: unknown) => void) => {
              runtimeListeners = runtimeListeners.filter(
                (item) => item !== listener,
              );
            },
          },
        },
      },
    });
  });

  afterEach(() => {
    (
      globalThis as typeof globalThis & {
        __attentionHoverPreviewAbort?: AbortController;
      }
    ).__attentionHoverPreviewAbort?.abort();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  const host = () =>
    document.querySelector<HTMLElement>('[data-attention-preview]')!;
  const trigger = () =>
    document.querySelector<HTMLButtonElement>('[data-attention-trigger]')!;
  const hover = async () => {
    document
      .querySelector('h1')!
      .dispatchEvent(new Event('pointerover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(200);
  };

  it('sends the article capture on a normal slug and exposes a keyboard trigger', async () => {
    installHoverPreview();
    expect(trigger().type).toBe('button');
    expect(trigger().getAttribute('aria-label')).toContain(
      'Evaluate this article',
    );
    await hover();
    expect(host().style.display).toBe('block');
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ATTENTION_PREVIEW/REQUEST',
        capture: expect.objectContaining({ url: window.location.href }),
      }),
    );
    const request = sendMessage.mock.calls.find(
      ([message]) => message.type === 'ATTENTION_PREVIEW/REQUEST',
    )?.[0] as unknown as { capture: { content: string } };
    expect(request.capture.content).not.toContain('Attention');
  });

  it.each([
    'readwiseSettings',
    'attentionDataGeneration',
    'novelPassageHighlightsEnabled',
  ])(
    'keeps the selected passage after feedback, but clears it on %s',
    async (key) => {
      // A realistic whole paragraph; oversized blocks deliberately abstain.
      document.querySelector('p')!.textContent =
        'A substantive article paragraph with evidence and practical context. '.repeat(
          12,
        );
      Element.prototype.scrollIntoView = vi.fn();
      sendMessage.mockImplementation(async () => ({
        ok: true,
        novelPassageHighlightsEnabled: true,
        readwiseConnected: true,
        preview: {
          ...preview,
          insights: {
            likelyNewClaims: [],
            noveltySummary: 'Potentially new.',
            noveltyConfidence: 0.8,
            qualityBreakdown: {
              reasoning: 80,
              evidence: 80,
              specificity: 80,
              calibration: 80,
            },
            qualitySummary: 'Useful evidence.',
            qualityLimitations: [],
            qualityConfidence: 0.8,
            keyClaims: [
              {
                claim:
                  'A substantive article paragraph with evidence and practical context.',
                type: 'fact',
                importance: 'primary',
                novelty: 'likely-new',
                knownProbability: 0.2,
                confidence: 0.8,
              },
            ],
          },
        },
      }));
      installHoverPreview();
      await hover();
      host()
        .shadowRoot!.querySelector<HTMLButtonElement>('.passages-button')!
        .click();
      const panel = document.querySelector('[data-attention-novel-passages]');
      expect(panel).not.toBeNull();
      expect(
        panel!.shadowRoot!.querySelector<HTMLButtonElement>('.readwise')!
          .hidden,
      ).toBe(false);

      runtimeListeners.forEach((listener) =>
        listener({
          type: ATTENTION_INPUTS_INVALIDATED_TYPE,
          changedKeys: ['novelPassageFeedback', 'claimMemoryRevision'],
        }),
      );
      await vi.advanceTimersByTimeAsync(200);
      expect(document.querySelector('[data-attention-novel-passages]')).toBe(
        panel,
      );

      runtimeListeners.forEach((listener) =>
        listener({
          type: ATTENTION_INPUTS_INVALIDATED_TYPE,
          changedKeys: ['novelPassageFeedback', key],
        }),
      );
      expect(
        document.querySelector('[data-attention-novel-passages]'),
      ).toBeNull();
    },
  );

  it('refreshes capabilities and recommendations through runtime invalidation without content storage access', async () => {
    installHoverPreview();
    trigger().focus();
    trigger().click();
    await vi.advanceTimersByTimeAsync(200);
    expect(document.activeElement).toBe(host());
    expect(host().dataset.attentionAiState).toBe('not-connected');
    sendMessage.mockImplementation(async (message: { type?: string }) =>
      message.type === 'ATTENTION_PREVIEW/REQUEST'
        ? {
            ok: true,
            aiState: 'ready',
            analysisSource: 'local',
            preview: { ...preview, scenario: 'learn', utilityScore: 91 },
          }
        : {},
    );
    runtimeListeners.forEach((listener) =>
      listener({
        type: ATTENTION_INPUTS_INVALIDATED_TYPE,
        changedKeys: ['attentionScenario', 'aiAnalyzerSettings'],
      }),
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(host().dataset.attentionAiState).toBe('ready');
    expect(document.activeElement).toBe(host());
    expect(host().dataset.attentionScore).toBe('91');
    expect(
      host().shadowRoot!.querySelector('.score-detail')!.textContent,
    ).toContain('91/100');
    expect(
      sendMessage.mock.calls.filter(
        ([message]) => message.type === 'ATTENTION_PREVIEW/REQUEST',
      ),
    ).toHaveLength(2);
  });

  it('clears the card after erasure without automatically recreating evaluation data', async () => {
    installHoverPreview();
    await hover();
    runtimeListeners.forEach((listener) =>
      listener({
        type: ATTENTION_INPUTS_INVALIDATED_TYPE,
        changedKeys: ['attentionDataGeneration'],
      }),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(host().style.display).toBe('none');
    expect(
      sendMessage.mock.calls.filter(
        ([message]) => message.type === 'ATTENTION_PREVIEW/REQUEST',
      ),
    ).toHaveLength(1);
  });

  it('opens from the trigger, keeps focus in the card, and restores it on Escape', async () => {
    installHoverPreview();
    trigger().focus();
    trigger().click();
    // A scroll queued by focus/Skim must not cancel the explicit Enter action.
    window.dispatchEvent(new Event('scroll'));
    document.body.dispatchEvent(
      new MouseEvent('pointerover', { bubbles: true }),
    );
    document.body.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true }),
    );
    document.documentElement.dispatchEvent(new Event('pointerleave'));
    document.querySelector('h1')!.dispatchEvent(
      new MouseEvent('pointerout', {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(host().style.display).toBe('block');
    window.dispatchEvent(new Event('scroll'));
    document.body.dispatchEvent(
      new MouseEvent('pointerover', { bubbles: true }),
    );
    document.body.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true }),
    );
    expect(host().style.display).toBe('block');
    expect(document.activeElement).toBe(host());
    expect(host().shadowRoot?.activeElement?.tagName).toBe('BUTTON');
    document
      .querySelector('h1')!
      .dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: host() }),
      );
    expect(host().style.display).toBe('block');
    host().shadowRoot!.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        composed: true,
      }),
    );
    expect(host().style.display).toBe('none');
    expect(document.activeElement).toBe(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('saves the article once and shows confirmation without closing the card', async () => {
    const onDecision = vi.fn().mockResolvedValue(true);
    installHoverPreview({ onDecision });
    await hover();
    const save = host().shadowRoot!.querySelector<HTMLButtonElement>(
      '[data-decision="save"]',
    )!;
    expect(host().shadowRoot!.querySelectorAll('[data-decision]')).toHaveLength(
      1,
    );
    save.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(onDecision).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ url: window.location.href, title }),
      'save',
    );
    expect(host().dataset.attentionSaved).toBe('true');
    expect(host().style.display).toBe('block');
    expect(save.textContent).toContain('Saved');
    expect(save.disabled).toBe(true);
    save.click();
    expect(onDecision).toHaveBeenCalledTimes(1);
  });

  it('ignores a late save acknowledgement after data erasure', async () => {
    let complete!: (ok: boolean) => void;
    installHoverPreview({
      onDecision: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    await hover();
    host()
      .shadowRoot!.querySelector<HTMLButtonElement>('[data-decision="save"]')!
      .click();
    runtimeListeners.forEach((listener) =>
      listener({
        type: ATTENTION_INPUTS_INVALIDATED_TYPE,
        changedKeys: ['attentionDataGeneration'],
      }),
    );
    complete(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(host().style.display).toBe('none');
    expect(host().dataset.attentionSaved).not.toBe('true');
  });

  it('retains a usable card when saving a decision fails', async () => {
    installHoverPreview({
      onDecision: vi.fn().mockRejectedValue(new Error('Storage unavailable')),
    });
    await hover();
    host()
      .shadowRoot!.querySelector<HTMLButtonElement>('[data-decision="save"]')!
      .click();
    await vi.advanceTimersByTimeAsync(0);
    expect(host().style.display).toBe('block');
    expect(
      host().shadowRoot!.querySelector<HTMLElement>('.action-status')!.hidden,
    ).toBe(false);
    expect(
      host().shadowRoot!.querySelector<HTMLButtonElement>(
        '[data-decision="save"]',
      )!.disabled,
    ).toBe(false);
  });

  it('rejects page-generated trigger, Escape and decision clicks', async () => {
    const onDecision = vi.fn().mockResolvedValue(true);
    installHoverPreview({ onDecision });
    vi.mocked(isTrustedUserInteraction).mockReturnValue(false);
    trigger().click();
    await vi.advanceTimersByTimeAsync(200);
    expect(host().style.display).toBe('none');
    expect(sendMessage).not.toHaveBeenCalled();
    await hover();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    for (const button of host().shadowRoot!.querySelectorAll<HTMLButtonElement>(
      '[data-decision]',
    ))
      button.click();
    expect(host().style.display).toBe('block');
    expect(onDecision).not.toHaveBeenCalled();
  });

  it('finishes saving after focus loss without reopening the card', async () => {
    let complete!: (ok: boolean) => void;
    installHoverPreview({
      onDecision: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    await hover();
    host()
      .shadowRoot!.querySelector<HTMLButtonElement>('[data-decision="save"]')!
      .click();
    host().dispatchEvent(
      new FocusEvent('focusout', {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
    expect(host().style.display).toBe('none');
    complete(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(host().style.display).toBe('none');
  });
});
