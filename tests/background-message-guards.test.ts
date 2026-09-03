import { describe, expect, it } from 'vitest';
import { isHoverPreviewRequest } from '../src/background/message-guards';
import {
  HOVER_PREVIEW_REQUEST_TYPE,
  type PageCapture,
} from '../src/shared/types';

const capture: PageCapture = {
  title: 'Article title',
  url: 'https://example.com/article',
  content: 'Article text '.repeat(100),
  excerpt: 'Article text',
  byline: 'Author',
  siteName: 'Example',
  publishedTime: null,
  language: 'en',
  wordCount: 200,
  readingTimeMinutes: 1,
  headings: ['Introduction'],
  isArticle: true,
  extractionMethod: 'readability',
  capturedAt: '2026-08-28T10:00:00.000Z',
};

describe('background message guards', () => {
  const request = {
    type: HOVER_PREVIEW_REQUEST_TYPE,
    url: capture.url,
    title: capture.title,
    snippet: capture.excerpt,
  };

  it('accepts an explicit AI request only with the captured page', () => {
    expect(
      isHoverPreviewRequest({
        ...request,
        analysisMode: 'ai',
        capture,
      }),
    ).toBe(true);
    expect(
      isHoverPreviewRequest({
        ...request,
        analysisMode: 'ai',
      }),
    ).toBe(false);
  });

  it('keeps title-only local previews valid', () => {
    expect(isHoverPreviewRequest(request)).toBe(true);
    expect(
      isHoverPreviewRequest({
        ...request,
        analysisMode: 'local',
      }),
    ).toBe(true);
  });
});
