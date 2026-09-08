import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SessionRuntime = typeof globalThis & {
  __attentionTracker?: {
    sessionId: string;
    visibleSince: number | null;
  } | null;
  __pageCaptureRuntimeAbort?: AbortController;
  __attentionHoverPreviewAbort?: AbortController;
};

describe('content reading session lifecycle', () => {
  let messages: Array<{ type?: string; ended?: boolean }>;
  let listener:
    | ((
        message: unknown,
        sender: unknown,
        respond: (value: unknown) => void,
      ) => void)
    | undefined;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    window.history.replaceState({}, '', '/article/lifecycle');
    document.title = 'An article about reading sessions';
    document.body.innerHTML = `<article><h1>An article about reading sessions</h1><p>${'Evidence and practical context for a substantial article. '.repeat(120)}</p></article>`;
    messages = [];
    listener = undefined;
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          sendMessage: async (message: { type?: string }) => {
            messages.push(message);
            return {};
          },
          onMessage: {
            addListener: (candidate: typeof listener) => {
              if (!listener) listener = candidate;
            },
            removeListener: vi.fn(),
          },
        },
      },
    });
    (await import('../src/content/runtime')).startContentRuntime();
    listener!(
      {
        type: 'ATTENTION_SESSION/START',
        sessionId: 'reading-one',
        url: window.location.href,
        decision: 'read',
        estimatedReadingSeconds: 600,
        sampledForOutcome: true,
        promptShownCount: 0,
      },
      {},
      () => {},
    );
  });

  afterEach(() => {
    (globalThis as SessionRuntime).__pageCaptureRuntimeAbort?.abort();
    (globalThis as SessionRuntime).__attentionHoverPreviewAbort?.abort();
    for (const key of [
      '__pageCaptureListenerInstalled',
      '__pageCaptureRuntimeVersion',
      '__pageCaptureMessageListener',
      '__pageCaptureRuntimeAbort',
      '__attentionTracker',
      '__attentionOutcomePrompt',
    ])
      Reflect.deleteProperty(globalThis, key);
    document
      .querySelectorAll('[data-attention-outcome-prompt]')
      .forEach((element) => element.remove());
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('pauses and resumes the same reading session on a BFCache round trip', async () => {
    await vi.advanceTimersByTimeAsync(10_000);
    window.dispatchEvent(
      new PageTransitionEvent('pagehide', { persisted: true }),
    );
    expect((globalThis as SessionRuntime).__attentionTracker?.sessionId).toBe(
      'reading-one',
    );
    expect(
      (globalThis as SessionRuntime).__attentionTracker?.visibleSince,
    ).toBeNull();
    expect(
      messages
        .filter((message) => message.type === 'ATTENTION_SESSION/PROGRESS')
        .at(-1)?.ended,
    ).toBe(false);
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true }),
    );
    expect(
      (globalThis as SessionRuntime).__attentionTracker?.visibleSince,
    ).not.toBeNull();
    expect((globalThis as SessionRuntime).__attentionTracker?.sessionId).toBe(
      'reading-one',
    );
  });

  it('ends a session on an ordinary document unload', () => {
    window.dispatchEvent(
      new PageTransitionEvent('pagehide', { persisted: false }),
    );
    expect((globalThis as SessionRuntime).__attentionTracker).toBeNull();
    expect(
      messages
        .filter((message) => message.type === 'ATTENTION_SESSION/PROGRESS')
        .at(-1)?.ended,
    ).toBe(true);
  });
});
