import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installHoverPreview,
  materialReadingInfo,
  personalValuePromise,
  personalValueReason,
  previewVerdict,
  resolveHoverTargetDetails,
} from '../src/content/hover-preview';
import { EXTENSION_RUNTIME_VERSION } from '../src/shared/version';

describe('hover preview content script', () => {
  afterEach(() => {
    vi.useRealTimers();
    (
      globalThis as typeof globalThis & {
        __attentionHoverPreviewAbort?: AbortController;
      }
    ).__attentionHoverPreviewAbort?.abort();
    Reflect.deleteProperty(globalThis, '__attentionHoverPreviewInstalled');
    Reflect.deleteProperty(globalThis, '__attentionHoverPreviewVersion');
    Reflect.deleteProperty(globalThis, '__attentionHoverPreviewAbort');
    document
      .querySelector<HTMLElement>('[data-attention-preview="true"]')
      ?.remove();
    document.body.replaceChildren();
    document.title = '';
    document.documentElement.classList.remove(
      'translated-ltr',
      'translated-rtl',
    );
    document
      .querySelectorAll(
        'link[rel~="canonical"], meta[property="og:url"], meta[property="og:title"], meta[name="twitter:title"]',
      )
      .forEach((element) => element.remove());
    window.history.replaceState({}, '', '/');
  });

  it('renders compact recommendations for linked materials in a feed', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <article>
        <a href="https://example.com/research">A rigorous AI evaluation framework</a>
        <p>New benchmarks and practical methods.</p>
      </article>
    `;
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      preview: {
        utilityScore: null,
        recommendedAction: 'open',
        reason: 'Matches an active goal.',
        expectedValue: 'Связь с активной целью',
        risk: 'Новизна неизвестна до открытия.',
        confidence: 'medium',
        source: 'title-preview',
        signalIds: ['goal:goal-1'],
        calibrationSampleSize: 0,
      },
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage } },
    });

    installHoverPreview();
    const link = document.querySelector('a');
    if (!link) throw new Error('Missing link fixture');
    link.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://example.com/research',
      }),
    );
    const host = document.querySelector<HTMLElement>(
      '[data-attention-preview="true"]',
    );
    expect(host?.style.display).toBe('block');
    expect(host?.dataset.attentionExpanded).toBe('false');
    expect(host?.dataset.attentionSource).toBe('title-preview');
    expect(host?.getAttribute('role')).toBe('status');
    expect(host?.getAttribute('aria-live')).toBe('polite');

    link.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect(
      sendMessage.mock.calls.filter(
        ([message]) =>
          (message as { type?: string } | undefined)?.type ===
          'ATTENTION_PREVIEW/REQUEST',
      ),
    ).toHaveLength(1);
    expect(host?.style.display).toBe('block');
  });

  it('drops a stale feed preview when the persisted analysis context changes', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <article>
        <a href="https://www.youtube.com/watch?v=german-lesson">
          Deutsch lernen B2–C1
        </a>
      </article>
    `;
    let storageChangeListener:
      | ((
          changes: Record<string, chrome.storage.StorageChange>,
          areaName: string,
        ) => void)
      | undefined;
    let previewRequestCount = 0;
    const workResponse = {
      ok: true,
      preview: {
        scenario: 'work',
        utilityScore: null,
        recommendedAction: 'maybe',
        reason: 'This is learning content.',
        expectedValue: 'Better for Learn',
        risk: 'Unknown',
        confidence: 'medium',
        source: 'title-preview',
        signalIds: [],
        calibrationSampleSize: 0,
      },
    };
    const learnResponse = {
      ok: true,
      preview: {
        scenario: 'learn',
        utilityScore: null,
        recommendedAction: 'open',
        reason: 'Matches a learning area.',
        expectedValue: 'Learning value',
        risk: 'Unknown',
        confidence: 'medium',
        source: 'title-preview',
        signalIds: ['learningArea:german'],
        calibrationSampleSize: 0,
      },
    };
    const sendMessage = vi.fn().mockImplementation((message: unknown) => {
      if (
        (message as { type?: string } | undefined)?.type !==
        'ATTENTION_PREVIEW/REQUEST'
      ) {
        return Promise.resolve(undefined);
      }
      previewRequestCount += 1;
      return Promise.resolve(
        previewRequestCount === 1 ? workResponse : learnResponse,
      );
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: { sendMessage },
        storage: {
          onChanged: {
            addListener: vi.fn((listener) => {
              storageChangeListener = listener;
            }),
            removeListener: vi.fn(),
          },
        },
      },
    });

    installHoverPreview();
    const link = document.querySelector('a');
    if (!link) throw new Error('Missing link fixture');
    link.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    const host = document.querySelector<HTMLElement>(
      '[data-attention-preview="true"]',
    );
    expect(host?.dataset.attentionVerdict).toBe('maybe');

    storageChangeListener?.(
      {
        analysisContext: {
          oldValue: { scenario: 'work' },
          newValue: { scenario: 'learn' },
        },
      },
      'local',
    );
    expect(host?.style.display).toBe('none');

    link.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect(previewRequestCount).toBe(2);
    expect(host?.dataset.attentionVerdict).toBe('read');
  });

  it('replaces an older hover runtime already installed in the page', () => {
    const oldHost = document.createElement('div');
    oldHost.dataset.attentionPreview = 'true';
    oldHost.dataset.attentionVersion = '0.13.4';
    document.documentElement.append(oldHost);
    Object.assign(globalThis, {
      __attentionHoverPreviewInstalled: true,
      __attentionHoverPreviewVersion: '0.13.4',
    });

    installHoverPreview();

    const hosts = document.querySelectorAll<HTMLElement>(
      '[data-attention-preview="true"]',
    );
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.dataset.attentionVersion).toBe(EXTENSION_RUNTIME_VERSION);
    expect(hosts[0]?.dataset.attentionContract).toBe(
      'feed-compact-current-title-expanded-actionable-value-spa-v13',
    );
  });

  it('replaces a stale same-version runtime instead of preserving its compact card', () => {
    const staleHost = document.createElement('div');
    staleHost.dataset.attentionPreview = 'true';
    staleHost.dataset.attentionVersion = EXTENSION_RUNTIME_VERSION;
    staleHost.dataset.attentionExpanded = 'false';
    document.documentElement.append(staleHost);
    const staleController = new AbortController();
    const abort = vi.spyOn(staleController, 'abort');
    Object.assign(globalThis, {
      __attentionHoverPreviewInstalled: true,
      __attentionHoverPreviewVersion: EXTENSION_RUNTIME_VERSION,
      __attentionHoverPreviewAbort: staleController,
    });

    installHoverPreview();

    const hosts = document.querySelectorAll<HTMLElement>(
      '[data-attention-preview="true"]',
    );
    expect(abort).toHaveBeenCalledOnce();
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).not.toBe(staleHost);
    expect(hosts[0]?.dataset.attentionContract).toBe(
      'feed-compact-current-title-expanded-actionable-value-spa-v13',
    );
  });

  it('reduces recommendations to positive, neutral, or negative verdicts', () => {
    expect(
      previewVerdict({
        scenario: 'work',
        utilityScore: null,
        recommendedAction: 'maybe',
        reason: '',
        expectedValue: '',
        risk: '',
        confidence: 'low',
        source: 'title-preview',
        signalIds: [],
        calibrationSampleSize: 0,
      }),
    ).toBe('maybe');
    expect(
      previewVerdict({
        scenario: 'work',
        utilityScore: 62,
        recommendedAction: 'maybe',
        reason: '',
        expectedValue: '',
        risk: '',
        confidence: 'medium',
        source: 'full-analysis',
        signalIds: [],
        calibrationSampleSize: 5,
      }),
    ).toBe('maybe');
  });

  it('explains low-value material through missing novelty and weak reasoning', () => {
    const preview = {
      scenario: 'work' as const,
      utilityScore: 34,
      recommendedAction: 'skip' as const,
      reason: '',
      expectedValue: '',
      risk: '',
      confidence: 'medium' as const,
      source: 'full-analysis' as const,
      signalIds: [],
      calibrationSampleSize: 2,
      components: {
        relevance: 78,
        novelty: 28,
        actionability: 35,
        quality: 42,
      },
      insights: {
        keyClaims: [],
        likelyNewClaims: [],
        familiarClaims: ['A familiar claim.'],
        noveltySummary: 'Mostly familiar.',
        noveltyConfidence: 0.7,
        qualityBreakdown: {
          evidence: 38,
          reasoning: 31,
          specificity: 45,
          calibration: 42,
        },
        qualitySummary: 'Weakly supported.',
        qualityStrengths: [],
        qualityLimitations: ['The reasoning has gaps.'],
        qualityConfidence: 0.65,
      },
    };

    expect(personalValuePromise(preview)).toBe(
      'Relevant to you, but probably little is new',
    );
    expect(personalValueReason(preview)).toBe(
      'The topic fits you, but the conclusions may be unreliable',
    );
  });

  it('describes only central potentially new claims and ignores supporting details', () => {
    const preview = {
      scenario: 'work' as const,
      utilityScore: 70,
      recommendedAction: 'open' as const,
      reason: '',
      expectedValue: '',
      risk: '',
      confidence: 'medium' as const,
      source: 'full-analysis' as const,
      signalIds: [],
      calibrationSampleSize: 0,
      components: {
        relevance: 75,
        novelty: 55,
        actionability: 60,
        quality: 70,
      },
      insights: {
        keyClaims: [
          {
            claim: 'The main trial reduced energy costs by 22 percent.',
            type: 'fact' as const,
            importance: 'primary' as const,
            novelty: 'uncertain' as const,
            knownProbability: 0.5,
            reason: 'No concrete prior knowledge.',
            confidence: 0.36,
          },
          {
            claim: 'A secondary survey included 48 respondents.',
            type: 'fact' as const,
            importance: 'supporting' as const,
            novelty: 'likely-new' as const,
            knownProbability: 0.2,
            reason: 'No concrete prior knowledge.',
            confidence: 0.8,
          },
        ],
        likelyNewClaims: ['A secondary survey included 48 respondents.'],
        familiarClaims: [],
        noveltySummary: 'One central result may be new.',
        noveltyConfidence: 0.36,
        qualityBreakdown: {
          evidence: 70,
          reasoning: 70,
          specificity: 70,
          calibration: 60,
        },
        qualitySummary: 'Reasonably supported.',
        qualityStrengths: [],
        qualityLimitations: [],
        qualityConfidence: 0.6,
      },
    };

    expect(personalValuePromise(preview)).toBe('For you: likely 1 new fact');
  });

  it('shows reading duration and a short section hint without a time selector', () => {
    const preview = {
      scenario: 'work' as const,
      utilityScore: 76,
      recommendedAction: 'open' as const,
      reason: '',
      expectedValue: '',
      risk: '',
      confidence: 'high' as const,
      source: 'full-analysis' as const,
      signalIds: [],
      calibrationSampleSize: 0,
      recommendedSections: ['Evidence', 'Practical implications'],
    };
    const longMaterial = {
      title: 'A long article',
      url: 'https://example.com/long',
      content: 'Article content.',
      excerpt: 'Article excerpt.',
      byline: null,
      siteName: 'Example',
      publishedTime: null,
      language: 'en',
      wordCount: 4_000,
      readingTimeMinutes: 24,
      headings: ['Evidence', 'Practical implications'],
      isArticle: true,
      extractionMethod: 'readability' as const,
      capturedAt: '2026-08-27T10:00:00.000Z',
    };

    expect(materialReadingInfo(preview, longMaterial, 'ru')).toBe(
      'Чтение — 24 мин · Нет времени? Начните с 2 ключевых разделов',
    );
    expect(
      materialReadingInfo(
        { ...preview, recommendedSections: ['Evidence'] },
        { ...longMaterial, readingTimeMinutes: 6 },
        'ru',
      ),
    ).toBe('Чтение — 6 мин');
  });

  it('resolves a Substack-style post when the heading is separate from its link', () => {
    document.body.innerHTML = `
      <article data-testid="post-preview">
        <a href="https://timdenning.substack.com/p/game-theory-explains-why-smart-people-dont-win" aria-label="Open post">
          <img alt="Post cover">
        </a>
        <div>
          <span>Modern Freedom</span>
          <h2><span>Game theory explains why smart people don't win</span></h2>
          <p>Being smart and working harder doesn't fix money problems.</p>
        </div>
      </article>
    `;

    const title = document.querySelector('h2 span');
    if (!title) throw new Error('Missing title fixture');
    const details = resolveHoverTargetDetails(title);

    expect(details).toMatchObject({
      url: 'https://timdenning.substack.com/p/game-theory-explains-why-smart-people-dont-win',
      title: "Game theory explains why smart people don't win",
    });
    expect(details?.snippet).toContain(
      "Being smart and working harder doesn't fix money problems.",
    );
  });

  it('does not mistake a semantic card title for the current page title', () => {
    document.body.innerHTML = `
      <article>
        <a href="https://example.com/post/a-linked-material"><img alt="Cover"></a>
        <div class="post-title">A linked material inside a feed card</div>
        <p>A short description of the linked material.</p>
      </article>
    `;

    const title = document.querySelector('.post-title');
    if (!title) throw new Error('Missing card title fixture');
    const details = resolveHoverTargetDetails(title);

    expect(details).toMatchObject({
      url: 'https://example.com/post/a-linked-material',
      title: 'A linked material inside a feed card',
      currentPage: false,
    });
  });

  it('uses the current page URL for an unlinked article h1', () => {
    document.body.innerHTML = `
      <main>
        <article>
          <h1><span>Anger, Anxiety and Agency</span></h1>
          <p>Anger can be a useful signal, but it rarely improves the situation.</p>
        </article>
      </main>
    `;

    const title = document.querySelector('h1 span');
    if (!title) throw new Error('Missing current-page title fixture');
    const details = resolveHoverTargetDetails(title);

    expect(details).toMatchObject({
      url: window.location.href,
      title: 'Anger, Anxiety and Agency',
      currentPage: true,
    });
    expect(details?.snippet).toContain('Anger can be a useful signal');
  });

  it('treats a linked primary heading in an article route as the current material', () => {
    window.history.replaceState({}, '', '/home/post/p-207461608');
    document.body.innerHTML = `
      <main>
        <article data-testid="post">
          <a href="https://publication.substack.com/p/apple-is-the-king-of-ai">
            <h1><span>Apple Is the King of AI and Nobody Knows It</span></h1>
          </a>
          <p>NVIDIA is a dead man walking. Consider this my timestamp.</p>
        </article>
      </main>
    `;

    const title = document.querySelector('h1 span');
    const heading = document.querySelector('h1');
    const link = document.querySelector('a');
    if (!title || !heading || !link) throw new Error('Missing title fixture');
    const details = resolveHoverTargetDetails(title);

    expect(details).toMatchObject({
      url: window.location.href,
      title: 'Apple Is the King of AI and Nobody Knows It',
      currentPage: true,
      element: link,
      positionElement: heading,
    });
  });

  it('recognizes a translated Substack title when source metadata stays in English', () => {
    window.history.replaceState({}, '', '/home/post/p-202400651');
    document.documentElement.classList.add('translated-ltr');
    document.title =
      'Следующей ставкой Великобритании в области ИИ должна стать верификация ИИ.';
    const openGraphTitle = document.createElement('meta');
    openGraphTitle.setAttribute('property', 'og:title');
    openGraphTitle.content =
      'Ed Zitron Just Disproved the Core Claim Behind His AI Bubble Case';
    const twitterTitle = document.createElement('meta');
    twitterTitle.name = 'twitter:title';
    twitterTitle.content = openGraphTitle.content;
    document.head.append(openGraphTitle, twitterTitle);
    document.body.innerHTML = `
      <article data-testid="background-feed-card">
        <a href="https://another-publication.example/p/ai-verification">
          ${document.title}
        </a>
        <p>${'Фоновая карточка ленты, заголовок которой совпал с устаревшим заголовком вкладки. '.repeat(4)}</p>
      </article>
      <main>
        <article data-testid="post">
          <a href="https://www.obsolete.pub">Устаревший</a>
          <a
            class="font-display size-36 weight-bold"
            href="https://www.obsolete.pub/p/ed-zitron-just-disproved-the-core"
          >
            <span>Эд Зитрон только что опроверг основное утверждение, лежащее в основе его доводов об искусственном интеллекте.</span>
          </a>
          <p>${'Переведённый текст статьи с аргументами, фактами и подробными доказательствами. '.repeat(30)}</p>
          <h2>Примечание для читателей</h2>
          <p>${'Продолжение основного материала после первого раздела. '.repeat(10)}</p>
        </article>
      </main>
    `;

    const title = document.querySelector(
      'a[href*="ed-zitron-just-disproved"] span',
    );
    const section = document.querySelector('article h2');
    if (!title || !section) throw new Error('Missing translated fixture');

    expect(resolveHoverTargetDetails(title)).toMatchObject({
      url: window.location.href,
      title:
        'Эд Зитрон только что опроверг основное утверждение, лежащее в основе его доводов об искусственном интеллекте.',
      currentPage: true,
    });
    expect(resolveHoverTargetDetails(section)).toBeNull();
  });

  it('recognizes a Substack post header overlay and ignores its subtitle link', () => {
    window.history.replaceState({}, '', '/home/post/p-209055325');
    const canonical = document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href =
      'https://hereisyourbrain.substack.com/p/ai-generated-content-mind-virus';
    document.head.append(canonical);
    document.body.innerHTML = `
      <main>
        <article>
          <header data-testid="post-header">
            <h1>The mind virus: Why you should care whether you read AI-generated content</h1>
            <a data-testid="post-title-link" href="${canonical.href}">
              The mind virus: Why you should care whether you read AI-generated content
            </a>
            <h3>
              <a data-testid="post-subtitle-link" href="${canonical.href}">
                How AI broke proof-of-thought and created a horde of fools
              </a>
            </h3>
          </header>
          <p>The article body starts here.</p>
          <h1>
            <a href="${canonical.href}#the-mind-virus">The mind virus</a>
          </h1>
        </article>
      </main>
    `;

    const title = document.querySelector('header h1');
    const titleOverlay = document.querySelector(
      '[data-testid="post-title-link"]',
    );
    const subtitle = document.querySelector(
      '[data-testid="post-subtitle-link"]',
    );
    const section = document.querySelector('article > h1 a');
    if (!title || !titleOverlay || !subtitle || !section) {
      throw new Error('Missing Substack header fixture');
    }

    expect(resolveHoverTargetDetails(title)).toMatchObject({
      url: window.location.href,
      currentPage: true,
      positionElement: title,
    });
    expect(resolveHoverTargetDetails(titleOverlay)).toMatchObject({
      url: window.location.href,
      currentPage: true,
      element: titleOverlay,
      positionElement: title,
    });
    expect(resolveHoverTargetDetails(subtitle)).toBeNull();
    expect(resolveHoverTargetDetails(section)).toBeNull();
  });

  it('uses the metadata-matching page title when the article body starts with another h1', () => {
    window.history.replaceState({}, '', '/home/post/p-209055325');
    const fullTitle =
      'The mind virus: Why you should care whether you read AI-generated content';
    document.title = `${fullTitle} | Here Is Your Brain`;
    const canonical = document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href =
      'https://hereisyourbrain.substack.com/p/ai-generated-content-mind-virus';
    const openGraphTitle = document.createElement('meta');
    openGraphTitle.setAttribute('property', 'og:title');
    openGraphTitle.content = fullTitle;
    document.head.append(canonical, openGraphTitle);
    document.body.innerHTML = `
      <main>
        <section data-testid="post-header">
          <h1>${fullTitle}</h1>
          <a data-testid="title-overlay" href="${canonical.href}">${fullTitle}</a>
        </section>
        <article data-testid="post-body">
          <p>The article body starts outside the post header.</p>
          <h1>
            <a href="${canonical.href}#the-mind-virus" aria-label="Link to section">
              The mind virus
            </a>
          </h1>
          <p>This is a section inside the article.</p>
        </article>
      </main>
    `;

    const title = document.querySelector('[data-testid="post-header"] h1');
    const overlay = document.querySelector('[data-testid="title-overlay"]');
    const firstSection = document.querySelector(
      '[data-testid="post-body"] h1 a',
    );
    if (!title || !overlay || !firstSection) {
      throw new Error('Missing split Substack fixture');
    }

    expect(resolveHoverTargetDetails(title)).toMatchObject({
      url: window.location.href,
      title: fullTitle,
      currentPage: true,
      positionElement: title,
    });
    expect(resolveHoverTargetDetails(overlay)).toMatchObject({
      url: window.location.href,
      title: fullTitle,
      currentPage: true,
      positionElement: title,
    });
    expect(resolveHoverTargetDetails(firstSection)).toBeNull();
  });

  it('uses the visible pre-body h1 in a metadata-poor Substack reader shell', () => {
    window.history.replaceState({}, '', '/home/post/p-209055325');
    document.title = 'Substack';
    const fullTitle =
      'The mind virus: Why you should care whether you read AI-generated content';
    const canonical = document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href =
      'https://hereisyourbrain.substack.com/p/ai-generated-content-mind-virus';
    document.head.append(canonical);
    document.body.innerHTML = `
      <main>
        <section data-testid="post-header">
          <h1>${fullTitle}</h1>
          <a data-testid="title-overlay" href="${canonical.href}">${fullTitle}</a>
        </section>
        <article data-testid="post-body">
          <p>The article body starts outside the post header.</p>
          <h1>
            The mind virus
            <a href="${canonical.href}#the-mind-virus" aria-label="Link to section"></a>
          </h1>
          <p>This is a section inside the article.</p>
        </article>
      </main>
    `;

    const title = document.querySelector<HTMLElement>(
      '[data-testid="post-header"] h1',
    );
    const overlay = document.querySelector('[data-testid="title-overlay"]');
    const firstSection = document.querySelector<HTMLElement>(
      '[data-testid="post-body"] h1',
    );
    if (!title || !overlay || !firstSection) {
      throw new Error('Missing metadata-poor Substack fixture');
    }
    Object.defineProperty(title, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        right: 700,
        top: 100,
        bottom: 220,
        width: 600,
        height: 120,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(firstSection, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        right: 500,
        top: 500,
        bottom: 560,
        width: 400,
        height: 60,
        x: 100,
        y: 500,
        toJSON: () => ({}),
      }),
    });

    expect(
      resolveHoverTargetDetails(overlay, { x: 200, y: 150 }),
    ).toMatchObject({
      url: window.location.href,
      title: fullTitle,
      currentPage: true,
      positionElement: title,
    });
    expect(
      resolveHoverTargetDetails(firstSection, { x: 200, y: 530 }),
    ).toBeNull();
  });

  it('reuses the extracted article title for a detached Substack post header', () => {
    window.history.replaceState({}, '', '/home/post/p-211734563');
    document.title = 'Substack';
    const fullTitle =
      'Thinking about other industries like we think about data centers shows how impoverished the debate is';
    document.body.innerHTML = `
      <header data-testid="post-header">
        <h1>${fullTitle}</h1>
        <h3>Clumsy environmental ideas ignore the complexity of modern systems</h3>
      </header>
      <main>
        <article data-testid="post-body">
          <p>${'A substantive article paragraph about complex industrial systems and environmental policy. '.repeat(20)}</p>
        </article>
      </main>
    `;

    const title = document.querySelector('[data-testid="post-header"] h1');
    const subtitle = document.querySelector('[data-testid="post-header"] h3');
    if (!title || !subtitle) {
      throw new Error('Missing detached Substack header fixture');
    }

    expect(resolveHoverTargetDetails(title)).toMatchObject({
      url: window.location.href,
      title: fullTitle,
      currentPage: true,
      positionElement: title,
    });
    expect(resolveHoverTargetDetails(subtitle)).toBeNull();
  });

  it('shows the expanded analysis for a linked current-page heading', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/home/post/p-207461608');
    document.body.innerHTML = `
      <main>
        <article data-testid="post">
          <a href="https://publication.substack.com/p/apple-is-the-king-of-ai">
            <h1><span>Apple Is the King of AI and Nobody Knows It</span></h1>
          </a>
          <p>The dataset contains a previously unreported result.</p>
          <p>The result changes how attention should be allocated.</p>
          <p>${'A detailed article paragraph with useful evidence. '.repeat(20)}</p>
        </article>
      </main>
    `;
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      saved: true,
      novelPassageHighlightsEnabled: true,
      analysisSource: 'local',
      aiState: 'ready',
      preview: {
        utilityScore: 78,
        recommendedAction: 'open',
        reason: 'Useful material.',
        expectedValue: 'New evidence.',
        risk: 'Some familiar context.',
        confidence: 'high',
        source: 'full-analysis',
        signalIds: ['goal:goal-1'],
        calibrationSampleSize: 3,
        components: {
          relevance: 90,
          novelty: 70,
          actionability: 65,
          quality: 85,
        },
        estimatedUsefulMinutes: 8,
        recommendedSections: ['Evidence', 'Practical implications'],
        insights: {
          keyClaims: [
            {
              claim: 'The dataset contains a previously unreported result.',
              type: 'fact',
              importance: 'primary',
              novelty: 'likely-new',
              knownProbability: 0.18,
              reason: 'The profile contains no matching knowledge.',
              confidence: 0.78,
            },
            {
              claim: 'The result changes how attention should be allocated.',
              type: 'thesis',
              importance: 'primary',
              novelty: 'likely-new',
              knownProbability: 0.24,
              reason: 'The conclusion is not present in the profile.',
              confidence: 0.72,
            },
          ],
          likelyNewClaims: [
            'The article presents a new expected-value allocation method.',
          ],
          familiarClaims: [],
          noveltySummary: 'The central method is probably new.',
          noveltyConfidence: 0.72,
          qualityBreakdown: {
            evidence: 78,
            reasoning: 84,
            specificity: 73,
            calibration: 67,
          },
          qualitySummary: 'The reasoning is explicit and mostly supported.',
          qualityStrengths: ['The causal steps are explicit.'],
          qualityLimitations: [
            'The cited evidence was not independently checked.',
          ],
          qualityConfidence: 0.74,
          reliability: {
            heuristicLanguage: 'en',
            languageSupported: true,
            extractionConfidence: 0.42,
            overallConfidence: 0.55,
            level: 'medium',
            weakExtraction: true,
          },
        },
      },
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage } },
    });

    const onCurrentPageEvaluation = vi.fn();
    installHoverPreview({ onCurrentPageEvaluation });
    const title = document.querySelector('h1 span');
    if (!title) throw new Error('Missing title fixture');
    title.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    const host = document.querySelector<HTMLElement>(
      '[data-attention-preview="true"]',
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: window.location.href,
        capture: expect.objectContaining({ url: window.location.href }),
      }),
    );
    expect(host?.style.display).toBe('block');
    expect(host?.dataset.attentionExpanded).toBe('true');
    expect(host?.dataset.attentionSaved).toBe('true');
    expect(host?.dataset.attentionAnalysisSource).toBe('local');
    expect(host?.dataset.attentionAiState).toBe('ready');
    expect(host?.style.pointerEvents).toBe('auto');
    expect(host?.getAttribute('aria-label')).toContain(
      'PROBABLY READ, 78 percent',
    );
    expect(host?.getAttribute('aria-label')).toContain(
      'For you: likely 1 new fact and 1 new conclusion',
    );
    expect(host?.dataset.attentionWeakExtraction).toBe('true');
    expect(host?.dataset.attentionReadingInfo).toContain('1 min read');
    expect(host?.getAttribute('aria-label')).toContain(
      'Part of the text may be missing',
    );
    expect(host?.getAttribute('aria-label')).toContain(
      'The topic fits you · the conclusions look convincing',
    );
    expect(onCurrentPageEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        url: window.location.href,
        isArticle: true,
      }),
    );

    document
      .querySelector('article')
      ?.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(host?.style.display).toBe('none');
  });

  it('shows the expanded card on the first SPA open while the feed stays mounted', async () => {
    vi.useFakeTimers();
    const title = 'What makes slop, slop?';
    window.history.replaceState({}, '', '/');
    document.title = 'Substack';
    document.body.innerHTML = `
      <main class="reader-nav-page">
        <article data-background-feed>
          <h1><a href="https://publication.example/p/slop">${title}</a></h1>
          <p>${'A background feed preview remains mounted underneath. '.repeat(12)}</p>
        </article>
      </main>
    `;
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      preview: {
        utilityScore: 76,
        recommendedAction: 'open',
        reason: 'Useful material.',
        expectedValue: 'New evidence.',
        risk: 'Some familiar context.',
        confidence: 'high',
        source: 'full-analysis',
        signalIds: [],
        calibrationSampleSize: 0,
        components: {
          relevance: 82,
          novelty: 69,
          actionability: 73,
          quality: 81,
        },
        estimatedUsefulMinutes: 7,
      },
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage } },
    });

    installHoverPreview();
    const feedHost = document.querySelector<HTMLElement>(
      '[data-attention-preview="true"]',
    );
    window.history.pushState({}, '', '/home/post/p-199967519');
    document.title = `${title} - by ampdot and Lyn - ampdot's blog`;
    document.body.insertAdjacentHTML(
      'beforeend',
      `<article class="newsletter-post post-viewer-post" data-current-article>
        <header><h1 data-current-title><a href="https://publication.example/p/slop">${title}</a></h1></header>
        <div class="available-content reader2-post-content">
          ${'<p>The foreground modal contains the complete argument, evidence, examples, and practical implications.</p>'.repeat(40)}
        </div>
      </article>`,
    );
    await vi.advanceTimersByTimeAsync(250);
    const articleHost = document.querySelector<HTMLElement>(
      '[data-attention-preview="true"]',
    );
    expect(articleHost).toBe(feedHost);
    expect(articleHost?.dataset.attentionInstalledUrl).toBe(
      window.location.href,
    );
    const currentTitle = document.querySelector<HTMLElement>(
      '[data-current-title]',
    );
    if (!currentTitle) throw new Error('Missing foreground SPA title fixture');
    currentTitle.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: window.location.href,
        capture: expect.objectContaining({
          title,
          content: expect.stringContaining(
            'The foreground modal contains the complete argument',
          ),
        }),
      }),
    );
    expect(
      document.querySelector<HTMLElement>('[data-attention-preview="true"]')
        ?.dataset.attentionExpanded,
    ).toBe('true');
    expect(Number(articleHost?.dataset.attentionPointerEvents)).toBeGreaterThan(
      0,
    );
  });

  it('finds a pointer-transparent title from the parent event coordinates', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/home/post/p-211734563');
    const fullTitle =
      'Thinking about other industries like we think about data centers shows how impoverished the debate is';
    document.title = fullTitle;
    document.body.innerHTML = `
      <main>
        <article data-testid="post">
          <h1>${fullTitle}</h1>
          <h3>Clumsy environmental ideas ignore the complexity of modern systems</h3>
          <p>${'A substantive article paragraph about industrial systems. '.repeat(20)}</p>
        </article>
      </main>
    `;
    const title = document.querySelector<HTMLElement>('h1');
    const article = document.querySelector('article');
    if (!title || !article) {
      throw new Error('Missing pointer-transparent title fixture');
    }
    Object.defineProperty(title, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        right: 800,
        top: 100,
        bottom: 260,
        width: 700,
        height: 160,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      }),
    });
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      preview: {
        utilityScore: 72,
        recommendedAction: 'open',
        reason: 'Useful material.',
        expectedValue: 'New evidence.',
        risk: 'Some familiar context.',
        confidence: 'high',
        source: 'full-analysis',
        signalIds: [],
        calibrationSampleSize: 0,
        components: {
          relevance: 80,
          novelty: 65,
          actionability: 60,
          quality: 85,
        },
        estimatedUsefulMinutes: 7,
      },
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage } },
    });

    installHoverPreview();
    await vi.advanceTimersByTimeAsync(100);
    article.dispatchEvent(
      new MouseEvent('pointermove', {
        bubbles: true,
        clientX: 200,
        clientY: 150,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: window.location.href,
        capture: expect.objectContaining({ title: fullTitle }),
      }),
    );
    expect(
      document.querySelector<HTMLElement>('[data-attention-preview="true"]')
        ?.dataset.attentionExpanded,
    ).toBe('true');
  });

  it('does not show a preview over the current article subtitle', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/home/post/p-211734563');
    document.title = 'Substack';
    const fullTitle =
      'Thinking about other industries like we think about data centers shows how impoverished the debate is';
    document.body.innerHTML = `
      <header data-testid="post-header">
        <h1>${fullTitle}</h1>
        <h3>Clumsy environmental ideas ignore the complexity of modern systems</h3>
      </header>
      <main>
        <article data-testid="post-body">
          <p>${'A substantive article paragraph about industrial systems and environmental policy. '.repeat(20)}</p>
        </article>
      </main>
    `;
    const title = document.querySelector<HTMLElement>('h1');
    const subtitle = document.querySelector<HTMLElement>('h3');
    const paragraph = document.querySelector<HTMLParagraphElement>('p');
    if (!title || !subtitle || !paragraph) {
      throw new Error('Missing Substack title-zone fixture');
    }
    Object.defineProperty(title, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        right: 500,
        top: 100,
        bottom: 220,
        width: 400,
        height: 120,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(subtitle, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        right: 480,
        top: 230,
        bottom: 270,
        width: 380,
        height: 40,
        x: 100,
        y: 230,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(paragraph, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        right: 500,
        top: 330,
        bottom: 430,
        width: 400,
        height: 100,
        x: 100,
        y: 330,
        toJSON: () => ({}),
      }),
    });
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      preview: {
        utilityScore: 72,
        recommendedAction: 'open',
        reason: 'Useful material.',
        expectedValue: 'New evidence.',
        risk: 'Some familiar context.',
        confidence: 'high',
        source: 'full-analysis',
        signalIds: [],
        calibrationSampleSize: 0,
        components: {
          relevance: 80,
          novelty: 65,
          actionability: 60,
          quality: 85,
        },
        estimatedUsefulMinutes: 7,
      },
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage } },
    });

    installHoverPreview();
    subtitle.dispatchEvent(
      new MouseEvent('pointerover', {
        bubbles: true,
        clientX: 200,
        clientY: 250,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ATTENTION_PREVIEW/REQUEST' }),
    );
    const host = document.querySelector<HTMLElement>(
      '[data-attention-preview="true"]',
    );
    expect(host?.style.display).toBe('none');
  });

  it('treats a headingless cross-domain Substack title link as the current article', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/home/post/p-211734563');
    const fullTitle =
      'Thinking about other industries like we think about data centers shows how impoverished the debate is';
    document.title = fullTitle;
    document.body.innerHTML = `
      <div class="reader-shell">
        <div class="post-title-block">
          <a href="https://blog.andymasley.com/p/other-large-industries-show-how-impoverished" target="_blank">${fullTitle}</a>
          <div>Clumsy environmental ideas ignore the complexity of modern systems</div>
        </div>
        <div class="post-body">
          ${'<p>A substantive article paragraph about industrial systems, environmental policy, evidence, and practical trade-offs.</p>'.repeat(12)}
        </div>
      </div>
    `;
    const titleLink = document.querySelector<HTMLAnchorElement>(
      '.post-title-block a',
    );
    const subtitle = document.querySelector<HTMLElement>(
      '.post-title-block > div',
    );
    if (!titleLink || !subtitle) {
      throw new Error('Missing headingless Substack title block');
    }
    Object.defineProperty(titleLink, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        right: 500,
        top: 100,
        bottom: 220,
        width: 400,
        height: 120,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(subtitle, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        right: 500,
        top: 230,
        bottom: 270,
        width: 400,
        height: 40,
        x: 100,
        y: 230,
        toJSON: () => ({}),
      }),
    });
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      preview: {
        utilityScore: 72,
        recommendedAction: 'open',
        reason: 'Useful material.',
        expectedValue: 'New evidence.',
        risk: 'Some familiar context.',
        confidence: 'high',
        source: 'full-analysis',
        signalIds: [],
        calibrationSampleSize: 0,
        components: {
          relevance: 80,
          novelty: 65,
          actionability: 60,
          quality: 85,
        },
        estimatedUsefulMinutes: 7,
      },
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage } },
    });

    installHoverPreview();
    titleLink.dispatchEvent(
      new MouseEvent('pointerover', {
        bubbles: true,
        clientX: 200,
        clientY: 150,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: window.location.href,
        title: fullTitle,
        capture: expect.objectContaining({ title: fullTitle }),
      }),
    );
    const host = document.querySelector<HTMLElement>(
      '[data-attention-preview="true"]',
    );
    expect(host?.dataset.attentionExpanded).toBe('true');
    expect(host?.dataset.attentionSource).toBe('full-analysis');

    titleLink.dispatchEvent(
      new MouseEvent('pointerout', {
        bubbles: true,
        relatedTarget: subtitle,
      }),
    );
    const requestCount = sendMessage.mock.calls.filter(
      ([message]) =>
        (message as { type?: string } | undefined)?.type ===
        'ATTENTION_PREVIEW/REQUEST',
    ).length;
    subtitle.dispatchEvent(
      new MouseEvent('pointerover', {
        bubbles: true,
        clientX: 200,
        clientY: 250,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(
      sendMessage.mock.calls.filter(
        ([message]) =>
          (message as { type?: string } | undefined)?.type ===
          'ATTENTION_PREVIEW/REQUEST',
      ),
    ).toHaveLength(requestCount);
    expect(host?.style.display).toBe('none');
  });

  it('never downgrades the current article title to a compact card', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/home/post/p-211734563');
    const fullTitle =
      'Thinking about other industries like we think about data centers shows how impoverished the debate is';
    document.title = fullTitle;
    document.body.innerHTML = `
      <div class="reader-shell">
        <div class="post-title-block">
          <a href="https://blog.andymasley.com/p/other-large-industries-show-how-impoverished">${fullTitle}</a>
          <div>Clumsy environmental ideas ignore the complexity of modern systems</div>
        </div>
        <div class="post-body">
          ${'<p>A substantive article paragraph about industrial systems, environmental policy, evidence, and practical trade-offs.</p>'.repeat(12)}
        </div>
      </div>
    `;
    const titleLink = document.querySelector<HTMLAnchorElement>(
      '.post-title-block a',
    );
    if (!titleLink) throw new Error('Missing current article title');
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      preview: {
        utilityScore: null,
        recommendedAction: 'maybe',
        reason: 'Only preliminary title evidence is available.',
        expectedValue: 'Unknown',
        risk: 'Unknown',
        confidence: 'low',
        source: 'title-preview',
        signalIds: [],
        calibrationSampleSize: 0,
      },
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage } },
    });

    installHoverPreview();
    titleLink.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: window.location.href,
        capture: expect.objectContaining({ title: fullTitle }),
      }),
    );
    const host = document.querySelector<HTMLElement>(
      '[data-attention-preview="true"]',
    );
    expect(host?.style.display).toBe('none');
    expect(host?.dataset.attentionExpanded).toBe('false');
    expect(host?.dataset.attentionContract).toBe(
      'feed-compact-current-title-expanded-actionable-value-spa-v13',
    );
  });

  it('does not render compact recommendations for links inside an open article', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/home/post/p-article');
    document.title = 'The current open article';
    document.body.innerHTML = `
      <main>
        <article>
          <h1>The current open article</h1>
          <p>${'Substantive body text with evidence and context. '.repeat(20)}</p>
          <p>See <a href="https://example.com/another-article">another related article with a useful title</a>.</p>
        </article>
      </main>
    `;
    const sendMessage = vi.fn();
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage } },
    });

    installHoverPreview();
    const bodyLink = document.querySelector<HTMLAnchorElement>(
      'a[href="https://example.com/another-article"]',
    );
    if (!bodyLink) throw new Error('Missing body link fixture');
    bodyLink.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLElement>('[data-attention-preview="true"]')
        ?.style.display,
    ).toBe('none');
  });

  it('refreshes an early skeleton capture when a new article body arrives', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/home/post/p-new-article');
    document.title = 'A newly opened article';
    document.body.innerHTML = `
      <main><article><h1>A newly opened article</h1><p>Loading…</p></article></main>
    `;
    const title = document.querySelector<HTMLElement>('h1');
    if (!title) throw new Error('Missing title fixture');
    expect(resolveHoverTargetDetails(title)?.snippet).toContain('Loading');

    document
      .querySelector('article')
      ?.insertAdjacentHTML(
        'beforeend',
        `<p>${'The complete article body now contains substantial evidence, examples, and practical context. '.repeat(30)}</p>`,
      );
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      preview: {
        utilityScore: 81,
        recommendedAction: 'open',
        reason: 'Strong fit.',
        expectedValue: 'Useful evidence.',
        risk: 'Low.',
        confidence: 'high',
        source: 'full-analysis',
        signalIds: [],
        calibrationSampleSize: 0,
        components: {
          relevance: 88,
          novelty: 72,
          actionability: 80,
          quality: 84,
        },
        estimatedUsefulMinutes: 9,
      },
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage } },
    });

    installHoverPreview();
    title.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ATTENTION_PREVIEW/REQUEST',
        capture: expect.objectContaining({
          title: 'A newly opened article',
          isArticle: true,
        }),
      }),
    );
    expect(
      document.querySelector<HTMLElement>('[data-attention-preview="true"]')
        ?.dataset.attentionExpanded,
    ).toBe('true');
  });

  it('retries a stationary title hover after an SPA article body is hydrated', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/home/post/p-spa-hydration');
    const articleTitle = 'The article that finishes rendering after navigation';
    document.title = articleTitle;
    document.body.innerHTML = `
      <main><article>
        <a href="https://publication.example/p/spa-hydration"><h1>${articleTitle}</h1></a>
        <p data-loading>Loading…</p>
      </article></main>
    `;
    const onCurrentPageEvaluation = vi.fn();
    const sendMessage = vi.fn(
      async (message: { capture?: { wordCount?: number } }) => {
        const full = (message.capture?.wordCount ?? 0) >= 80;
        return {
          ok: true,
          preview: {
            utilityScore: full ? 78 : null,
            recommendedAction: full ? 'open' : 'maybe',
            reason: full ? 'The complete article is available.' : 'Loading.',
            expectedValue: full ? 'Useful evidence.' : 'Unknown.',
            risk: full ? 'Low.' : 'Unknown.',
            confidence: full ? 'high' : 'low',
            source: full ? 'full-analysis' : 'title-preview',
            signalIds: [],
            calibrationSampleSize: 0,
            ...(full
              ? {
                  components: {
                    relevance: 82,
                    novelty: 71,
                    actionability: 76,
                    quality: 84,
                  },
                  estimatedUsefulMinutes: 8,
                }
              : {}),
          },
        };
      },
    );
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage } },
    });

    installHoverPreview({ onCurrentPageEvaluation });
    const title = document.querySelector<HTMLElement>('h1');
    if (!title) throw new Error('Missing hydrated title fixture');
    title.dispatchEvent(
      new MouseEvent('pointerover', {
        bubbles: true,
        clientX: 120,
        clientY: 80,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);

    document.querySelector('[data-loading]')?.remove();
    document
      .querySelector('article')
      ?.insertAdjacentHTML(
        'beforeend',
        `<div class="body">${'<p>The complete article contains detailed evidence, examples, implications, and practical context for the reader.</p>'.repeat(35)}</div>`,
      );
    await vi.advanceTimersByTimeAsync(1_000);

    const host = document.querySelector<HTMLElement>(
      '[data-attention-preview="true"]',
    );
    expect(host?.style.display).toBe('block');
    expect(host?.dataset.attentionExpanded).toBe('true');
    expect(host?.dataset.attentionSource).toBe('full-analysis');
    expect(onCurrentPageEvaluation).toHaveBeenCalledOnce();
  });

  it('announces one reading candidate for every SPA article URL', async () => {
    vi.useFakeTimers();
    const fullPreview = {
      ok: true,
      preview: {
        utilityScore: 74,
        recommendedAction: 'open',
        reason: 'Strong fit.',
        expectedValue: 'Useful evidence.',
        risk: 'Low.',
        confidence: 'high',
        source: 'full-analysis',
        signalIds: [],
        calibrationSampleSize: 0,
        components: {
          relevance: 80,
          novelty: 68,
          actionability: 72,
          quality: 79,
        },
        estimatedUsefulMinutes: 7,
      },
    };
    const sendMessage = vi.fn().mockResolvedValue(fullPreview);
    const onCurrentPageEvaluation = vi.fn();
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage } },
    });
    const renderArticle = (title: string): HTMLElement => {
      document.title = title;
      document.body.innerHTML = `
        <main><article>
          <h1>${title}</h1>
          ${'<p>A complete article paragraph with evidence, examples, implications, and practical context.</p>'.repeat(35)}
        </article></main>
      `;
      const heading = document.querySelector<HTMLElement>('h1');
      if (!heading) throw new Error('Missing SPA article title fixture');
      return heading;
    };

    window.history.replaceState({}, '', '/home/post/p-first');
    const firstTitle = renderArticle('The first article in this SPA tab');
    installHoverPreview({ onCurrentPageEvaluation });
    firstTitle.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    window.history.pushState({}, '', '/home/post/p-second');
    const secondTitle = renderArticle('The second article in this SPA tab');
    secondTitle.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect(onCurrentPageEvaluation).toHaveBeenCalledTimes(2);
    expect(onCurrentPageEvaluation.mock.calls[0]?.[0].url).toContain(
      '/home/post/p-first',
    );
    expect(onCurrentPageEvaluation.mock.calls[1]?.[0].url).toContain(
      '/home/post/p-second',
    );
  });

  it('shows a LessWrong article preview quickly and keeps its cache stable while comments hydrate', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/posts/abc/a-lesswrong-article');
    document.title = 'A LessWrong article — LessWrong';
    document.body.innerHTML = `
      <main><article>
        <h1>A LessWrong article</h1>
        <div id="postBody">
          <div class="instapaper_body">
            <div id="postContent">
              ${'<p>The authored post contains evidence, examples, implications, and practical context for a careful reader.</p>'.repeat(240)}
            </div>
          </div>
        </div>
        <section class="PostsPage-commentsSection"></section>
      </article></main>
    `;
    const fullPreview = {
      ok: true,
      preview: {
        utilityScore: 76,
        recommendedAction: 'open',
        reason: 'Strong fit.',
        expectedValue: 'Useful evidence.',
        risk: 'Low.',
        confidence: 'high',
        source: 'full-analysis',
        signalIds: [],
        calibrationSampleSize: 0,
        components: {
          relevance: 82,
          novelty: 70,
          actionability: 73,
          quality: 81,
        },
        estimatedUsefulMinutes: 7,
      },
    };
    const sendMessage = vi.fn().mockResolvedValue(fullPreview);
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage } },
    });

    installHoverPreview();
    const title = document.querySelector('h1');
    if (!title) throw new Error('Missing LessWrong title fixture');
    title.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(119);
    expect(sendMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    window.dispatchEvent(new Event('scroll'));
    document
      .querySelector('.PostsPage-commentsSection')
      ?.insertAdjacentHTML(
        'beforeend',
        '<p>A newly hydrated comment with a lot of unrelated discussion.</p>',
      );
    title.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(120);

    const previewRequests = sendMessage.mock.calls.filter(
      ([message]) =>
        (message as { type?: string } | undefined)?.type ===
        'ATTENTION_PREVIEW/REQUEST',
    );
    expect(previewRequests).toHaveLength(1);
    expect(
      document.querySelector<HTMLElement>('[data-attention-preview="true"]')
        ?.dataset.attentionExpanded,
    ).toBe('true');
  });

  it('cancels a delayed preview when the pointer leaves a wrapped heading', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/home/post/p-207461608');
    document.body.innerHTML = `
      <main>
        <article data-testid="post">
          <a href="https://publication.substack.com/p/apple-is-the-king-of-ai">
            <h1><span>Apple Is the King of AI and Nobody Knows It</span></h1>
          </a>
          <p>A detailed article paragraph.</p>
        </article>
      </main>
    `;
    const sendMessage = vi.fn();
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage } },
    });

    installHoverPreview();
    const title = document.querySelector('h1 span');
    const link = document.querySelector('a');
    if (!title || !link) throw new Error('Missing title fixture');
    title.dispatchEvent(new Event('pointerover', { bubbles: true }));
    link.dispatchEvent(
      new MouseEvent('pointerout', {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLElement>('[data-attention-preview="true"]')
        ?.style.display,
    ).toBe('none');
  });

  it('recognizes a current-page title expressed through a semantic class', () => {
    document.body.innerHTML = `
      <main class="content">
        <div class="article-header">
          <div class="article-title">AI Chip Architectures</div>
        </div>
        <p>Modern accelerators focus on compute for artificial intelligence.</p>
      </main>
    `;

    const title = document.querySelector('.article-title');
    if (!title) throw new Error('Missing semantic title fixture');
    const details = resolveHoverTargetDetails(title);

    expect(details).toMatchObject({
      url: window.location.href,
      title: 'AI Chip Architectures',
      currentPage: true,
    });
    expect(details?.snippet).toContain('Modern accelerators');
  });

  it('does not treat unlinked article subheadings as separate materials', () => {
    document.body.innerHTML = `
      <article>
        <h2>How anger changes decision making</h2>
        <p>This is only one section of the current material.</p>
      </article>
    `;

    const subheading = document.querySelector('h2');
    if (!subheading) throw new Error('Missing subheading fixture');

    expect(resolveHoverTargetDetails(subheading)).toBeNull();
  });

  it('ignores a full-URL permalink wrapping a later article heading', () => {
    window.history.replaceState({}, '', '/home/post/p-209055325');
    document.body.innerHTML = `
      <main>
        <article>
          <h1>The mind virus: Why you should care whether you read AI-generated content</h1>
          <p>The article body starts here.</p>
          <h1>
            <a href="https://hereisyourbrain.substack.com/p/ai-generated-content-mind-virus">
              The mind virus
            </a>
          </h1>
        </article>
      </main>
    `;

    const section = document.querySelector('article h1:nth-of-type(2) a');
    if (!section) throw new Error('Missing section permalink fixture');

    expect(resolveHoverTargetDetails(section)).toBeNull();
  });

  it('recognizes a current-title overlay rendered outside the article', () => {
    window.history.replaceState({}, '', '/home/post/p-209055325');
    document.title =
      'The mind virus: Why you should care whether you read AI-generated content';
    document.body.innerHTML = `
      <main>
        <article>
          <h1>The mind virus: Why you should care whether you read AI-generated content</h1>
          <p>The article body starts here.</p>
          <h2>The burden of proof</h2>
        </article>
      </main>
      <a id="title-overlay" href="https://hereisyourbrain.substack.com/p/ai-generated-content-mind-virus"></a>
    `;

    const overlay = document.querySelector('#title-overlay');
    const title = document.querySelector<HTMLElement>('article h1');
    const section = document.querySelector<HTMLElement>('article h2');
    if (!overlay || !title || !section) {
      throw new Error('Missing title overlay fixture');
    }
    Object.defineProperty(title, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        right: 700,
        top: 100,
        bottom: 220,
        width: 600,
        height: 120,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(section, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        right: 500,
        top: 500,
        bottom: 560,
        width: 400,
        height: 60,
        x: 100,
        y: 500,
        toJSON: () => ({}),
      }),
    });

    expect(
      resolveHoverTargetDetails(overlay, { x: 200, y: 150 }),
    ).toMatchObject({
      url: window.location.href,
      currentPage: true,
      element: overlay,
      positionElement: title,
    });
    expect(resolveHoverTargetDetails(overlay, { x: 200, y: 530 })).toBeNull();
  });

  it('ignores canonical permalinks attached to article subheadings', () => {
    window.history.replaceState({}, '', '/home/post/p-207461608');
    const canonical = document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href =
      'https://publication.substack.com/p/apple-is-the-king-of-ai';
    document.head.append(canonical);
    document.body.innerHTML = `
      <main>
        <article data-testid="post">
          <h1>Apple Is the King of AI and Nobody Knows It</h1>
          <h2>
            The scoreboard everyone is reading is wrong
            <a href="https://publication.substack.com/p/apple-is-the-king-of-ai#scoreboard" aria-label="Link"></a>
          </h2>
        </article>
      </main>
    `;

    const permalink = document.querySelector('h2 a');
    if (!permalink) throw new Error('Missing permalink fixture');

    expect(resolveHoverTargetDetails(permalink)).toBeNull();
  });

  it('ignores ordinary navigation links', () => {
    document.body.innerHTML = `
      <nav>
        <a href="https://example.com/archive">Article archive</a>
      </nav>
    `;
    const navigation = document.querySelector('a');
    if (!navigation) throw new Error('Missing navigation fixture');

    expect(resolveHoverTargetDetails(navigation)).toBeNull();
  });

  it('does not treat same-origin account actions as materials', () => {
    window.history.replaceState({}, '', '/earnings');
    document.body.innerHTML = `
      <main>
        <section class="earnings-promo">
          <a href="/referrals">
            <h2><span>Unlock more earnings with Mercor Intros</span></h2>
            <p>Explore your LinkedIn connections and invite people.</p>
          </a>
        </section>
      </main>
    `;

    const title = document.querySelector('h2 span');
    if (!title) throw new Error('Missing account action fixture');
    expect(resolveHoverTargetDetails(title)).toBeNull();
  });

  it('ignores article-like links inside navigation list items', () => {
    document.body.innerHTML = `
      <header>
        <nav role="navigation">
          <ul>
            <li role="heading">
              <a href="https://example.com/articles/browse-research-papers">Browse research papers</a>
            </li>
          </ul>
        </nav>
      </header>
    `;
    const navigation = document.querySelector('a');
    if (!navigation) throw new Error('Missing navigation fixture');

    expect(resolveHoverTargetDetails(navigation)).toBeNull();
  });
});
