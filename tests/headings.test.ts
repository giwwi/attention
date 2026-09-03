import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findHeadingElement, scrollToHeading } from '../src/content/headings';

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
});
