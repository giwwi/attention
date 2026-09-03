import { describe, expect, it } from 'vitest';
import { buildMaterialFeatures } from '../src/analyzer/material-features';
import type { PageCapture } from '../src/shared/types';

function capture(content: string): PageCapture {
  return {
    title: 'Reusable article features',
    url: 'https://www.example.com/article/?utm_source=test#section',
    content,
    excerpt: 'Evidence and analysis.',
    byline: null,
    siteName: 'Example',
    publishedTime: null,
    language: 'en',
    wordCount: 200,
    readingTimeMinutes: 1,
    headings: ['Evidence', 'Analysis'],
    isArticle: true,
    extractionMethod: 'readability',
    capturedAt: '2026-08-28T08:00:00.000Z',
  };
}

describe('shared material features', () => {
  it('canonicalizes and tokenizes one immutable feature snapshot', async () => {
    const features = await buildMaterialFeatures(
      capture('Representative benchmarks reveal model failure patterns.'),
    );

    expect(features.canonicalPage?.canonicalUrl).toBe(
      'https://example.com/article',
    );
    expect(features.urlFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(features.matchingTokens.size).toBeGreaterThan(0);
    expect(features.matchingTokens.has('benchmarks')).toBe(true);
  });

  it('keeps the fingerprint stable across capture time but changes it with article text', async () => {
    const first = await buildMaterialFeatures(capture('Original article.'));
    const laterCapture = {
      ...capture('Original article.'),
      capturedAt: '2026-08-28T09:00:00.000Z',
    };
    const sameText = await buildMaterialFeatures(laterCapture);
    const changed = await buildMaterialFeatures(capture('Updated article.'));

    expect(sameText.articleTextFingerprint).toBe(first.articleTextFingerprint);
    expect(changed.articleTextFingerprint).not.toBe(
      first.articleTextFingerprint,
    );
  });
});
