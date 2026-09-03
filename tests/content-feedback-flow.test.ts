import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATTENTION_SESSION_AUTO_START_TYPE,
  ATTENTION_SESSION_PROGRESS_TYPE,
} from '../src/shared/types';

describe('content-script feedback flow', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows feedback at the article end even if an earlier runtime marked the prompt as shown', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    window.history.replaceState({}, '', '/home/post/p-211734563');
    const title =
      'Thinking about other industries like we think about data centers shows how impoverished the debate is';
    document.title = title;
    document.body.innerHTML = `
      <main><div role="article">${'Background feed card. '.repeat(30)}</div></main>
      <article class="newsletter-post">
        <a href="https://publication.example/p/post">${title}</a>
        <div class="reader2-post-content body markup">
          <p>${'A substantive article paragraph with evidence and practical context. '.repeat(120)}</p>
          <p data-conclusion>${'The actual conclusion of the article. '.repeat(8)}</p>
        </div>
      </article>
    `;
    const article = document.querySelector<HTMLElement>('article');
    if (!article) throw new Error('Missing article fixture');
    let articleTop = 100;
    let articleBottom = 4_100;
    Object.defineProperty(article, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        right: 700,
        top: articleTop,
        bottom: articleBottom,
        width: 600,
        height: articleBottom - articleTop,
        x: 100,
        y: articleTop,
        toJSON: () => ({}),
      }),
    });
    const sendMessage = vi.fn(async (message: { type?: string }) => {
      if (message.type === ATTENTION_SESSION_AUTO_START_TYPE) {
        return {
          ok: true,
          session: {
            sessionId: 'session-one',
            url: window.location.href,
            decision: 'read',
            estimatedReadingSeconds: 600,
            sampledForOutcome: true,
            promptShownCount: 1,
          },
        };
      }
      return undefined;
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          sendMessage,
          onMessage: {
            addListener: vi.fn(),
            removeListener: vi.fn(),
          },
        },
      },
    });

    await import('../src/content/index');
    await vi.advanceTimersByTimeAsync(91_000);
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: ATTENTION_SESSION_AUTO_START_TYPE }),
    );
    expect(
      document.querySelector<HTMLElement>(
        '[data-attention-outcome-prompt="true"]',
      )?.style.display,
    ).toBe('none');

    articleTop = -300;
    articleBottom = 3_700;
    window.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: ATTENTION_SESSION_AUTO_START_TYPE }),
    );

    articleTop = -3_500;
    articleBottom = 500;
    await vi.advanceTimersByTimeAsync(91_000);
    window.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(0);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: ATTENTION_SESSION_PROGRESS_TYPE }),
    );
    const prompt = document.querySelector<HTMLElement>(
      '[data-attention-outcome-prompt="true"]',
    );
    expect(prompt?.dataset.state).toBe('visible');
    expect(prompt?.style.display).toBe('block');

    window.history.pushState({}, '', '/home/post/p-another-article');
    await vi.advanceTimersByTimeAsync(1_100);

    expect(prompt?.dataset.state).toBe('hidden');
    expect(prompt?.style.display).toBe('none');

    const nextTitle = 'A second article rendered after the SPA route changed';
    document.title = nextTitle;
    document.body.innerHTML = `
      <main class="reader-nav-page">
        <article data-background-feed>
          <h1><a href="https://publication.example/p/another-article">${nextTitle}</a></h1>
          <p>${'A duplicate preview left mounted in the feed. '.repeat(12)}</p>
        </article>
      </main>
      <article class="newsletter-post post-viewer-post" data-current-article>
        <h1><a href="https://publication.example/p/another-article">${nextTitle}</a></h1>
        <div class="reader2-post-content body markup">
          ${'<p>The newly hydrated article includes evidence, examples, implications, and practical context.</p>'.repeat(120)}
        </div>
      </article>
    `;
    const nextArticle = document.querySelector<HTMLElement>(
      '[data-current-article]',
    );
    if (!nextArticle) throw new Error('Missing next SPA article fixture');
    let nextArticleTop = 100;
    let nextArticleBottom = 4_100;
    Object.defineProperty(nextArticle, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        right: 700,
        top: nextArticleTop,
        bottom: nextArticleBottom,
        width: 600,
        height: nextArticleBottom - nextArticleTop,
        x: 100,
        y: nextArticleTop,
        toJSON: () => ({}),
      }),
    });
    await vi.advanceTimersByTimeAsync(1_100);
    nextArticleTop = -300;
    nextArticleBottom = 3_700;
    window.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(0);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ATTENTION_SESSION_AUTO_START_TYPE,
        capture: expect.objectContaining({
          title: nextTitle,
          url: expect.stringContaining('/home/post/p-another-article'),
        }),
      }),
    );
  }, 10_000);
});
