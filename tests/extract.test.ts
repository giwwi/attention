import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractVisibleText,
  normalizeWhitespace,
} from '../src/content/extract';

describe('normalizeWhitespace', () => {
  it('collapses whitespace and trims the result', () => {
    expect(normalizeWhitespace('  Hello\n\t world  ')).toBe('Hello world');
  });

  it('does not introduce spaces before punctuation', () => {
    expect(normalizeWhitespace('Important context . Next sentence !')).toBe(
      'Important context. Next sentence!',
    );
  });
});

describe('extractVisibleText', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('extracts readable text and excludes non-content elements', () => {
    document.body.innerHTML = `
      <main><h1>Page title</h1><p>Useful content.</p></main>
      <script>ignored()</script><style>.ignored { display: none }</style>
      <p hidden>Secret</p><p aria-hidden="true">Decorative</p>
    `;

    expect(extractVisibleText()).toBe('Page title Useful content.');
  });

  it('excludes elements hidden with CSS', () => {
    document.body.innerHTML = `
      <p>Shown</p>
      <p style="display: none">Hidden</p>
      <div aria-hidden="true"><p>Hidden by ancestor</p></div>
    `;
    expect(extractVisibleText()).toBe('Shown');
  });

  it('extracts the visible reading order from a normal article page', () => {
    document.body.innerHTML = `
      <header><a href="/">Publication</a></header>
      <main>
        <article>
          <h1>A useful article</h1>
          <p>First paragraph with <strong>important context</strong>.</p>
          <figure><figcaption>A visible caption</figcaption></figure>
          <section style="visibility: hidden"><p>Draft notes</p></section>
          <p>Final paragraph.</p>
        </article>
      </main>
      <script type="application/ld+json">{"name":"not visible"}</script>
    `;

    expect(extractVisibleText()).toBe(
      'Publication A useful article First paragraph with important context. A visible caption Final paragraph.',
    );
  });
});
