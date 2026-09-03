import { describe, expect, it } from 'vitest';
import type { PageCapture, SavedMaterial } from '../src/shared/types';
import {
  MAX_SAVED_MATERIALS,
  isOpenableMaterialUrl,
  removeSavedMaterial,
  upsertSavedMaterial,
} from '../src/popup/saved-materials';

function capture(url: string, title = url): PageCapture {
  return {
    title,
    url,
    content: 'Article content',
    excerpt: 'Article excerpt',
    byline: null,
    siteName: 'Example',
    publishedTime: null,
    language: 'en',
    wordCount: 2,
    readingTimeMinutes: 1,
    headings: ['Section'],
    isArticle: true,
    extractionMethod: 'semantic',
    capturedAt: '2026-08-25T10:00:00.000Z',
  };
}

describe('saved materials', () => {
  it('adds the newest material first and replaces the same URL', () => {
    const existing: SavedMaterial[] = [
      {
        capture: capture('https://example.com/a', 'Old title'),
        savedAt: 'old',
      },
    ];

    const next = upsertSavedMaterial(
      existing,
      capture('https://example.com/a', 'New title'),
      'new',
    );

    expect(next).toHaveLength(1);
    expect(next[0]?.capture.title).toBe('New title');
    expect(next[0]?.savedAt).toBe('new');
  });

  it('keeps the local list deliberately small', () => {
    const existing = Array.from(
      { length: MAX_SAVED_MATERIALS },
      (_, index) => ({
        capture: capture(`https://example.com/${index}`),
        savedAt: String(index),
      }),
    );

    const next = upsertSavedMaterial(
      existing,
      capture('https://example.com/new'),
      'new',
    );

    expect(next).toHaveLength(MAX_SAVED_MATERIALS);
    expect(next[0]?.capture.url).toBe('https://example.com/new');
  });

  it('removes one material without touching the others', () => {
    const saved = [
      { capture: capture('https://example.com/a'), savedAt: 'a' },
      { capture: capture('https://example.com/b'), savedAt: 'b' },
    ];

    expect(removeSavedMaterial(saved, 'https://example.com/a')).toEqual([
      saved[1],
    ]);
  });

  it('opens only regular web URLs', () => {
    expect(isOpenableMaterialUrl('https://example.com/article')).toBe(true);
    expect(isOpenableMaterialUrl('http://example.com/article')).toBe(true);
    expect(isOpenableMaterialUrl('javascript:alert(1)')).toBe(false);
    expect(isOpenableMaterialUrl('not a URL')).toBe(false);
  });
});
