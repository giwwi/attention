import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRecommendedSectionHighlights,
  findHeadingElement,
  highlightRecommendedSections,
  scrollToHeading,
} from '../src/content/headings';

describe('article heading navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    clearRecommendedSectionHighlights(document);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('finds a visible heading by normalized text', () => {
    document.body.innerHTML = `
      <nav><h2>Related stories</h2></nav>
      <article>
        <h2>  Why attention\nmatters </h2>
        <p>Article text.</p>
      </article>
    `;

    expect(findHeadingElement(document, 'Why attention matters')?.tagName).toBe(
      'H2',
    );
  });

  it('ignores hidden headings and reports missing sections', () => {
    document.body.innerHTML = `
      <article>
        <h2 hidden>Hidden section</h2>
        <h2>Visible section</h2>
      </article>
    `;

    expect(findHeadingElement(document, 'Hidden section')).toBeNull();
    expect(findHeadingElement(document, 'Missing section')).toBeNull();
  });

  it('smoothly scrolls to the matching section', () => {
    document.body.innerHTML =
      '<article><h3>Practical conclusion</h3></article>';
    const heading = document.querySelector<HTMLElement>('h3');
    if (!heading) throw new Error('Fixture heading is missing.');
    const scrollIntoView = vi.fn();
    Object.defineProperty(heading, 'scrollIntoView', {
      value: scrollIntoView,
    });

    expect(scrollToHeading(document, 'Practical conclusion')).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
  });

  it('marks only the first real destination temporarily, without decorating its section', () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<article>
      <h2>Introduction</h2><p>Known material.</p>
      <h2 id="method">Practical method</h2><p>Useful steps.</p><ul><li>Do this.</li></ul>
      <h3>Example</h3><p>An example.</p>
      <h2>Conclusion</h2><p>Final words.</p>
    </article>`;
    expect(
      highlightRecommendedSections(document, [
        'Invented section',
        'Practical method',
        'Conclusion',
      ]),
    ).toBe(1);
    expect(document.querySelector('[data-attention-reading-target]')?.id).toBe(
      'method',
    );
    expect(
      document.querySelectorAll('[data-attention-reading-target]'),
    ).toHaveLength(1);
    expect(
      document.querySelector(
        '[data-attention-recommended-section], [data-attention-section-label]',
      ),
    ).toBeNull();
    vi.advanceTimersByTime(2200);
    expect(
      document.querySelector('[data-attention-reading-target]'),
    ).toBeNull();
    expect(
      document.getElementById('attention-recommended-section-style'),
    ).toBeNull();
  });

  it('ignores navigation outside the article and clears obsolete section paint', () => {
    document.body.innerHTML =
      '<aside><h2>Evidence</h2><p id="unrelated">Other material</p></aside><article><h2 data-attention-section-label="Attention · рекомендуем" data-attention-recommended-section="heading">Evidence</h2><p id="actual" data-attention-recommended-section="content">Article evidence</p></article>';
    expect(highlightRecommendedSections(document, ['Evidence'])).toBe(1);
    expect(document.querySelector('[data-attention-reading-target]')).toBe(
      document.querySelector('article h2'),
    );
    expect(
      document.querySelector('aside [data-attention-reading-target]'),
    ).toBeNull();
    expect(
      document.querySelector(
        '[data-attention-recommended-section], [data-attention-section-label]',
      ),
    ).toBeNull();
  });

  it('keeps a later destination visible for its full duration and respects reduced motion', () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    document.body.innerHTML =
      '<article><h2>First</h2><h2>Second</h2></article>';
    scrollToHeading(document, 'First');
    expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({
      behavior: 'instant',
      block: 'start',
    });
    vi.advanceTimersByTime(1500);
    scrollToHeading(document, 'Second');
    vi.advanceTimersByTime(1000);
    expect(
      document.querySelector('[data-attention-reading-target]')?.textContent,
    ).toBe('Second');
    vi.advanceTimersByTime(1200);
    expect(
      document.querySelector('[data-attention-reading-target]'),
    ).toBeNull();
    Reflect.deleteProperty(window, 'matchMedia');
  });
});
