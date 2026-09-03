import { describe, expect, it } from 'vitest';
import { findNovelPassageMatches } from '../src/content/novel-passages';
import type { KeyClaimAssessment, PageCapture } from '../src/shared/types';

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
  it('returns the exact source sentence for a confident likely-new claim', () => {
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
      'Solar cells reached a measured efficiency of 34 percent in the reported experiment.',
    );
    expect(matches[0]?.range.toString()).toBe(matches[0]?.excerpt);
  });

  it('offers an uncertain exact claim when prior knowledge is not confirmed', () => {
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

    expect(matches).toHaveLength(1);
    expect(matches[0]?.range.toString()).toContain('reduced energy use');
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
        'uncertain',
        {
          sourceExcerpt:
            'Researchers observed a 31 percent reduction in processing time after changing the scheduling policy.',
          knownProbability: 0.48,
          confidence: 0.4,
        },
      ),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.excerpt).toContain('31 percent reduction');
  });

  it('prioritizes a central fact and ignores supporting details', () => {
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
      'The main trial reduced household energy costs by 22 percent.',
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
