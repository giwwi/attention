import { describe, expect, it } from 'vitest';
import {
  currentReadingProgress,
  findReadingEndTarget,
  findReadingRoot,
  quantizeReadingProgress,
  readingProgressFromBounds,
} from '../src/content/reading-progress';

describe('on-page reading progress', () => {
  it('uses the article containing the primary heading as the reading root', () => {
    document.body.innerHTML = `
      <header><h1>Publication name</h1></header>
      <main>
        <article data-testid="post">
          <h1>Article title</h1>
          <p>Article body.</p>
        </article>
      </main>
    `;

    expect(findReadingRoot(document)?.tagName).toBe('ARTICLE');
  });

  it('skips a Substack post header and tracks the separate article body', () => {
    document.body.innerHTML = `
      <main>
        <section data-testid="post-header">
          <h1>Article title outside the body</h1>
        </section>
        <article data-testid="post-body">
          <p>${'A substantive opening paragraph in the article body. '.repeat(4)}</p>
          <h1>First section</h1>
          <p>${'More substantive article text for reading progress. '.repeat(4)}</p>
        </article>
      </main>
    `;

    expect(findReadingRoot(document)).toBe(
      document.querySelector('[data-testid="post-body"]'),
    );
  });

  it('uses the final substantive article block as the reading-end signal', () => {
    document.body.innerHTML = `
      <article>
        <p>${'Opening article text. '.repeat(5)}</p>
        <h2>A final section</h2>
        <p data-final>${'The actual conclusion of the material. '.repeat(5)}</p>
        <form><button>Subscribe</button></form>
      </article>
    `;
    const root = document.querySelector<HTMLElement>('article');

    expect(findReadingEndTarget(root)).toBe(
      document.querySelector('[data-final]'),
    );
  });

  it('measures progress from article geometry inside any scroll container', () => {
    expect(readingProgressFromBounds(300, 4_300, 1_000)).toBe(18);
    expect(readingProgressFromBounds(-3_100, 900, 1_000)).toBe(100);
  });

  it('uses scroll position when the reading root is its own scroll container', () => {
    const root = document.createElement('article');
    Object.defineProperties(root, {
      clientHeight: { configurable: true, value: 800 },
      scrollHeight: { configurable: true, value: 4_000 },
      scrollTop: { configurable: true, value: 2_800 },
    });

    expect(currentReadingProgress(root)).toBe(90);
  });

  it('quantizes near-end progress as completed reading depth', () => {
    expect(quantizeReadingProgress(74)).toBe(50);
    expect(quantizeReadingProgress(75)).toBe(75);
    expect(quantizeReadingProgress(96)).toBe(100);
  });
});
