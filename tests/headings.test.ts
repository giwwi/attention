import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRecommendedSectionHighlights,
  findHeadingElement,
  highlightRecommendedSections,
  scrollToHeading,
} from '../src/content/headings';

describe('article heading navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
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

  it('highlights only exact real sections and their content', () => {
    document.body.innerHTML = `
      <article>
        <h2>Introduction</h2><p>Known material.</p>
        <h2>Practical method</h2><p>Useful steps.</p><ul><li>Do this.</li></ul>
        <h3>Example</h3><p>An example.</p>
        <h2>Conclusion</h2><p>Final words.</p>
      </article>
    `;

    expect(
      highlightRecommendedSections(document, [
        'Practical method',
        'Invented section',
      ]),
    ).toBe(1);
    expect(
      document
        .querySelector('h2:nth-of-type(2)')
        ?.getAttribute('data-attention-recommended-section'),
    ).toBe('heading');
    expect(
      document
        .querySelector('h2:nth-of-type(3)')
        ?.hasAttribute('data-attention-recommended-section'),
    ).toBe(false);

    clearRecommendedSectionHighlights(document);
    expect(
      document.querySelector('[data-attention-recommended-section]'),
    ).toBeNull();
  });

  it('ignores matching section titles in navigation outside the article', () => {
    document.body.innerHTML =
      '<aside><h2>Evidence</h2><p id="unrelated">Other material</p></aside><article><h2>Evidence</h2><p id="actual">Article evidence</p></article>';
    expect(highlightRecommendedSections(document, ['Evidence'], 'ru')).toBe(1);
    expect(
      document
        .getElementById('unrelated')
        ?.hasAttribute('data-attention-recommended-section'),
    ).toBe(false);
    expect(
      document
        .getElementById('actual')
        ?.getAttribute('data-attention-recommended-section'),
    ).toBe('content');
    expect(
      document
        .querySelector('article h2')
        ?.getAttribute('data-attention-section-label'),
    ).toContain('рекомендуем');
  });
});
