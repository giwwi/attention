import { describe, expect, it } from 'vitest';
import {
  createEvaluationCacheVersion,
  isEvaluationCacheCurrent,
  type EvaluationSourceVersions,
} from '../src/analyzer/evaluation-cache';
import { buildMaterialFeatures } from '../src/analyzer/material-features';
import type {
  AnalysisContext,
  PageCapture,
  StoredEvaluation,
} from '../src/shared/types';

const context: AnalysisContext = {
  scenario: 'work',
  intent: 'Find evidence for a product decision',
  availableMinutes: 15,
};

const sourceVersions: EvaluationSourceVersions = {
  profile: 'profile-1',
  history: 'history-1',
  readwise: 'readwise-1',
  obsidian: 'obsidian-1',
  notion: 'notion-1',
  claimMemory: 'claims-1',
  utilityCalibration: 'calibration-1',
};

function capture(content = 'Evidence about a product decision.'): PageCapture {
  return {
    title: 'Product decision evidence',
    url: 'https://example.com/article?utm_source=test#intro',
    content,
    excerpt: 'A practical review of the evidence.',
    byline: 'Author',
    siteName: 'Example',
    publishedTime: null,
    language: 'en',
    wordCount: 250,
    readingTimeMinutes: 2,
    headings: ['Evidence', 'Conclusion'],
    isArticle: true,
    extractionMethod: 'readability',
    capturedAt: '2026-08-28T08:00:00.000Z',
  };
}

function stored(
  cacheVersion: StoredEvaluation['cacheVersion'],
): StoredEvaluation {
  return {
    url: 'https://example.com/article',
    context,
    cacheVersion,
    evaluation: {} as StoredEvaluation['evaluation'],
  };
}

describe('evaluation cache versioning', () => {
  it('reuses an evaluation only for the same profile, sources, context and article text', async () => {
    const features = await buildMaterialFeatures(capture());
    const value = stored(
      createEvaluationCacheVersion(features, context, sourceVersions),
    );

    expect(
      isEvaluationCacheCurrent(value, sourceVersions, context, features),
    ).toBe(true);
  });

  it('invalidates the cache when any personal evidence source changes', async () => {
    const features = await buildMaterialFeatures(capture());
    const value = stored(
      createEvaluationCacheVersion(features, context, sourceVersions),
    );

    for (const key of Object.keys(
      sourceVersions,
    ) as (keyof EvaluationSourceVersions)[]) {
      expect(
        isEvaluationCacheCurrent(
          value,
          { ...sourceVersions, [key]: `${key}-2` },
          context,
          features,
        ),
      ).toBe(false);
    }
  });

  it('invalidates the cache when the extracted article text or scenario context changes', async () => {
    const features = await buildMaterialFeatures(capture());
    const changedFeatures = await buildMaterialFeatures(
      capture('A materially different version of the article.'),
    );
    const value = stored(
      createEvaluationCacheVersion(features, context, sourceVersions),
    );

    expect(
      isEvaluationCacheCurrent(value, sourceVersions, context, changedFeatures),
    ).toBe(false);
    expect(
      isEvaluationCacheCurrent(
        value,
        sourceVersions,
        { ...context, scenario: 'learn' },
        features,
      ),
    ).toBe(false);
  });

  it('treats legacy cache entries without version metadata as stale', async () => {
    const features = await buildMaterialFeatures(capture());
    expect(
      isEvaluationCacheCurrent(
        stored(undefined),
        sourceVersions,
        context,
        features,
      ),
    ).toBe(false);
  });
});
