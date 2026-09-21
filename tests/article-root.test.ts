import { afterEach, describe, expect, it } from 'vitest';
import {
  findCurrentArticleRoot,
  findCurrentArticleTitleElement,
} from '../src/content/article-root';

describe('article title identity', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it.each([
    [
      'The AI view of loss of control incidents',
      'The AI view of loss-of-control incidents',
    ],
    [
      'KI gestützte Forschung in der Praxis',
      'KI‑gestützte Forschung in der Praxis',
    ],
    [
      'Научно практический подход к оценке',
      'Научно-практический подход к оценке',
    ],
    ["What's new in model evaluation?", 'What’s new in model evaluation?'],
    [
      'The AI view of loss of control incidents - Publication',
      'The AI view of loss-of-control incidents',
    ],
  ])('matches typographic variants: %s', (metadata, visibleTitle) => {
    document.title = metadata;
    document.body.innerHTML = `<main>Background feed</main><article><a href="/p/current">${visibleTitle}</a><p>Article body</p></article>`;
    expect(findCurrentArticleTitleElement(document)).toBe(
      document.querySelector('article a'),
    );
    expect(findCurrentArticleRoot(document)).toBe(
      document.querySelector('article'),
    );
  });

  it.each([
    ['Why AI is safe to deploy', 'Why AI is not safe to deploy'],
    ['A guide to C++ programming', 'A guide to C programming'],
    ['Loss of control incidents', 'Loss of control incidents explained'],
  ])('does not confuse different titles: %s', (metadata, otherTitle) => {
    document.title = metadata;
    document.body.innerHTML = `<article><a href="/p/other">${otherTitle}</a><p>Article body</p></article>`;
    expect(findCurrentArticleTitleElement(document)).toBeNull();
  });
});
