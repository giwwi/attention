import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findNovelPassageMatches,
  NovelPassageController,
} from '../src/content/novel-passages';
import type { KeyClaimAssessment, PageCapture } from '../src/shared/types';
import { collectReadingBlocks } from '../src/content/reading-blocks';
import type { ReadingPassages } from '../src/reading/types';
import {
  scrollToHeading,
  clearRecommendedSectionHighlights,
} from '../src/content/headings';

const capture: PageCapture = {
  title: 'A useful article',
  url: 'https://example.com/article',
  content: '',
  excerpt: '',
  byline: 'Author',
  siteName: 'Example',
  publishedTime: null,
  language: 'en',
  wordCount: 180,
  readingTimeMinutes: 1,
  headings: [],
  isArticle: true,
  extractionMethod: 'semantic',
  capturedAt: '2026-08-27T18:00:00.000Z',
};

afterEach(() => {
  clearRecommendedSectionHighlights(document);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(
  [true, false].flatMap((native) =>
    (['legacy', 'local', 'ai', 'semantic'] as const).map((source) => ({
      native,
      source,
    })),
  ),
)(
  'navigates whole passages in article order (native highlights: $native, source: $source)',
  ({ native, source }) => {
    document.body.innerHTML = `<article><h1>A useful article</h1>
    <h2>First section</h2><p>Solar cells reached a measured efficiency of 34 percent in the reported experiment.</p>
    <p>However, the experiment used controlled conditions and a small test sample.</p>
    <h2>Second section</h2><p>A new manufacturing method reduced energy use by 27 percent in a six-month trial.</p>
  </article>`;
    Element.prototype.scrollIntoView = vi.fn();
    const registry = new Map<string, Set<Range>>();
    vi.stubGlobal('CSS', { highlights: native ? registry : undefined });
    vi.stubGlobal(
      'Highlight',
      class extends Set<Range> {
        constructor(...ranges: Range[]) {
          super(ranges);
        }
      },
    );
    const original = Element.prototype.attachShadow;
    let panel: ShadowRoot | undefined;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
      this: Element,
      options,
    ) {
      const root = original.call(this, options);
      if (this.hasAttribute('data-attention-novel-passages')) panel = root;
      return root;
    });
    const paragraphs = [...document.querySelectorAll('article p')].map(
      (p) => p.textContent!,
    );
    const { map } = collectReadingBlocks(document.querySelector('article')!);
    const selection: ReadingPassages | undefined =
      source === 'legacy'
        ? undefined
        : {
            version: 1,
            fingerprint: map.fingerprint,
            source: source === 'ai' ? 'ai' : 'local',
            ...(source === 'semantic' ? { method: 'semantic' as const } : {}),
            coverage: 'complete',
            status: 'ready',
            items: [
              {
                coreBlockId: map.blocks[2]!.id,
                blockIds: [map.blocks[2]!.id],
                basis: 'goal',
                knowledge: 'unknown',
                score: 0.95,
              },
              {
                coreBlockId: map.blocks[0]!.id,
                blockIds: [map.blocks[0]!.id, map.blocks[1]!.id],
                basis: 'goal',
                knowledge: 'unknown',
                score: 0.85,
              },
            ],
          };
    const matches = findNovelPassageMatches(
      document,
      capture,
      [claim(paragraphs[2]!), claim(paragraphs[0]!)],
      3,
      selection,
    );
    expect(matches).toHaveLength(2);
    // Relevance can rank the later paragraph first. Reading navigation must not.
    expect(matches[0]?.excerpt).toBe(paragraphs[2]);
    expect(matches[1]?.excerpt).toContain(paragraphs[1]);
    scrollToHeading(document, 'First section');
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    if (native) registry.set('attention-reading-core', new Set());
    const controller = new NovelPassageController();
    const highlighted = () =>
      native
        ? [...(registry.get('attention-potential-new') ?? [])].map((range) =>
            range.toString(),
          )
        : [
            ...document.querySelectorAll('.attention-potential-new-fallback'),
          ].map((node) => node.textContent);
    try {
      expect(
        controller.show(matches, capture, {
          language: 'ru',
          readwiseConnected: false,
        }),
      ).toBe(true);
      expect(highlighted()).toEqual(paragraphs.slice(0, 2));
      expect(registry.has('attention-reading-core')).toBe(false);
      expect(
        document.querySelector('[data-attention-reading-target]'),
      ).toBeNull();
      expect(panel!.querySelector('.counter')?.textContent).toBe('1 из 2');
      expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts).toEqual(
        [document.querySelector('article p')],
      );
      const readwise = panel!.querySelector<HTMLButtonElement>('.readwise')!;
      const readwiseHint = panel!.querySelector<HTMLElement>('.readwise-hint')!;
      expect(readwise.hidden).toBe(false);
      expect(readwise.disabled).toBe(true);
      expect(readwise.dataset.unavailable).toBe('true');
      expect(readwiseHint.hidden).toBe(false);
      expect(readwiseHint.textContent).toBe(
        'Для сохранения подключите Readwise в настройках.',
      );
      expect(readwise.getAttribute('aria-describedby')).toBe(readwiseHint.id);
      panel!.querySelector<HTMLButtonElement>('.next')!.click();
      expect(highlighted()).toEqual([paragraphs[2]]);
      expect(panel!.querySelector('.counter')?.textContent).toBe('2 из 2');
      expect(
        vi.mocked(Element.prototype.scrollIntoView).mock.contexts.at(-1),
      ).toBe(document.querySelectorAll('article p')[2]);
      expect(readwise.disabled).toBe(true);
      panel!.querySelector<HTMLButtonElement>('.previous')!.click();
      expect(highlighted()).toEqual(paragraphs.slice(0, 2));
      expect(
        vi.mocked(Element.prototype.scrollIntoView).mock.contexts.at(-1),
      ).toBe(document.querySelector('article p'));
      expect(matches[0]?.excerpt).toBe(paragraphs[2]);
      // Opening again must restart at the first position, even after navigation.
      panel!.querySelector<HTMLButtonElement>('.next')!.click();
      controller.show(matches, capture, {
        language: 'ru',
        readwiseConnected: false,
      });
      expect(highlighted()).toEqual(paragraphs.slice(0, 2));
      expect(panel!.querySelector('.counter')?.textContent).toBe('1 из 2');
      expect(
        [...document.querySelectorAll('article p')].map((p) => p.textContent),
      ).toEqual(paragraphs);
    } finally {
      controller.clear();
    }
    expect(highlighted()).toEqual([]);
    expect(
      document.querySelector('[data-attention-novel-highlight-style]'),
    ).toBeNull();
  },
);

it('isolates passage actions and rejects synthetic mutations even with privileged test access', () => {
  document.body.innerHTML =
    '<article><h1>A useful article</h1><p>Solar cells reached a measured efficiency of 34 percent in the reported experiment.</p></article>';
  const sendMessage = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  Element.prototype.scrollIntoView = vi.fn();
  const original = Element.prototype.attachShadow;
  let panel: ShadowRoot | undefined;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    options,
  ) {
    const root = original.call(this, options);
    if (this.hasAttribute('data-attention-novel-passages')) panel = root;
    return root;
  });
  const controller = new NovelPassageController();
  controller.show(
    findNovelPassageMatches(document, capture, [
      claim(
        'Solar cells reached a measured efficiency of 34 percent in the reported experiment.',
      ),
    ]),
    capture,
    { language: 'en', readwiseConnected: true },
  );
  expect(
    document.querySelector('[data-attention-novel-passages]')?.shadowRoot,
  ).toBeNull();
  expect(panel).toBeDefined();
  const readwise = panel!.querySelector<HTMLButtonElement>('.readwise')!;
  expect(readwise.hidden).toBe(false);
  expect(readwise.disabled).toBe(false);
  expect(readwise.dataset.unavailable).toBe('false');
  expect(readwise.hasAttribute('aria-describedby')).toBe(false);
  expect(panel!.querySelector<HTMLElement>('.readwise-hint')!.hidden).toBe(
    true,
  );
  for (const selector of ['.known', '.novel', '.readwise'])
    panel!.querySelector<HTMLButtonElement>(selector)!.click();
  expect(sendMessage).not.toHaveBeenCalled();
  controller.clear();
});

function claim(
  text: string,
  novelty: KeyClaimAssessment['novelty'] = 'likely-new',
  overrides: Partial<KeyClaimAssessment> = {},
): KeyClaimAssessment {
  return {
    claim: text,
    type: 'fact',
    importance: 'primary',
    novelty,
    knownProbability: 0.2,
    reason: 'Not found in prior evidence',
    confidence: 0.8,
    ...overrides,
  };
}

describe('potentially new passage matching', () => {
  it('keeps the whole source paragraph around a confident legacy claim', () => {
    document.body.innerHTML = `
      <article>
        <h1>A useful article</h1>
        <p>The familiar introduction provides context. Solar cells reached a measured efficiency of 34 percent in the reported experiment.</p>
        <p>A final paragraph summarizes the implications for manufacturing.</p>
      </article>`;
    document.title = capture.title;

    const matches = findNovelPassageMatches(document, capture, [
      claim(
        'Solar cells reached a measured efficiency of 34 percent in the reported experiment.',
      ),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.excerpt).toBe(
      'The familiar introduction provides context. Solar cells reached a measured efficiency of 34 percent in the reported experiment.',
    );
    expect(matches[0]?.range.toString()).toBe(matches[0]?.excerpt);
  });

  it('does not turn uncertain legacy knowledge into a novel highlight', () => {
    document.body.innerHTML = `
      <article>
        <h1>A useful article</h1>
        <p>A new manufacturing method reduced energy use by 27 percent in a six-month trial.</p>
      </article>`;
    document.title = capture.title;

    const matches = findNovelPassageMatches(document, capture, [
      claim(
        'A new manufacturing method reduced energy use by 27 percent in a six-month trial.',
        'uncertain',
        { knownProbability: 0.5, confidence: 0.36 },
      ),
    ]);

    expect(matches).toHaveLength(0);
  });

  it('uses the exact source excerpt when the AI claim is a paraphrase', () => {
    document.body.innerHTML = `
      <article>
        <h1>A useful article</h1>
        <p>Researchers observed a 31 percent reduction in processing time after changing the scheduling policy.</p>
      </article>`;
    document.title = capture.title;

    const matches = findNovelPassageMatches(document, capture, [
      claim(
        'The revised scheduling policy substantially improved performance.',
        'likely-new',
        {
          sourceExcerpt:
            'Researchers observed a 31 percent reduction in processing time after changing the scheduling policy.',
          knownProbability: 0.2,
          confidence: 0.8,
        },
      ),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.excerpt).toContain('31 percent reduction');
  });

  it('retains confident supporting legacy claims while dropping uncertain claims', () => {
    document.body.innerHTML = `
      <article>
        <h1>A useful article</h1>
        <p>The evidence changes the economic case for the proposed policy.</p>
        <p>The main trial reduced household energy costs by 22 percent.</p>
        <p>A secondary survey happened to include 48 respondents from one city.</p>
      </article>`;
    document.title = capture.title;

    const matches = findNovelPassageMatches(document, capture, [
      claim(
        'The evidence changes the economic case for the proposed policy.',
        'likely-new',
        {
          type: 'thesis',
        },
      ),
      claim(
        'The main trial reduced household energy costs by 22 percent.',
        'uncertain',
        {
          knownProbability: 0.5,
          confidence: 0.36,
        },
      ),
      claim(
        'A secondary survey happened to include 48 respondents from one city.',
        'likely-new',
        {
          importance: 'supporting',
        },
      ),
    ]);

    expect(matches.map((match) => match.excerpt)).toEqual([
      'A secondary survey happened to include 48 respondents from one city.',
      'The evidence changes the economic case for the proposed policy.',
    ]);
  });

  it('does not highlight known claims or weak lexical guesses', () => {
    document.body.innerHTML = `
      <article>
        <h1>A useful article</h1>
        <p>This paragraph discusses solar energy in broad and familiar terms.</p>
      </article>`;
    document.title = capture.title;

    expect(
      findNovelPassageMatches(document, capture, [
        claim('This paragraph discusses solar energy.', 'known', {
          knownProbability: 0.9,
        }),
        claim('A specific experiment doubled battery life in cold climates.'),
      ]),
    ).toEqual([]);
  });
});
