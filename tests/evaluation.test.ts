import { describe, expect, it } from 'vitest';
import {
  classifyClaimNovelty,
  finalizeMaterialEvaluation,
} from '../src/analyzer/evaluation';
import type {
  MaterialEvaluationInsights,
  PageCapture,
} from '../src/shared/types';

const material: PageCapture = {
  title: 'A useful article',
  url: 'https://example.com/article',
  content: 'Evidence and explanation. '.repeat(100),
  excerpt: 'Evidence and explanation.',
  byline: null,
  siteName: 'Example',
  publishedTime: null,
  language: 'en',
  wordCount: 400,
  readingTimeMinutes: 4,
  headings: ['Evidence'],
  isArticle: true,
  extractionMethod: 'readability',
  capturedAt: '2026-08-27T10:00:00.000Z',
};

const insights: MaterialEvaluationInsights = {
  keyClaims: [],
  likelyNewClaims: ['A new claim'],
  familiarClaims: [],
  noveltySummary: 'One claim may be new.',
  noveltyConfidence: 0.7,
  qualityBreakdown: {
    evidence: 70,
    reasoning: 70,
    specificity: 70,
    calibration: 70,
  },
  qualitySummary: 'Reasonably supported.',
  qualityStrengths: ['Explicit evidence.'],
  qualityLimitations: ['Sources were not independently checked.'],
  qualityConfidence: 0.7,
};

describe('shared evaluation policy', () => {
  it.each([
    [0.2, 0.44, 'uncertain'],
    [0.72, 0.45, 'known'],
    [0.42, 0.45, 'partially-known'],
    [0.3, 0.45, 'likely-new'],
    [0.31, 0.45, 'uncertain'],
  ] as const)(
    'classifies probability %s at confidence %s as %s',
    (knownProbability, confidence, expected) => {
      expect(classifyClaimNovelty(knownProbability, confidence)).toBe(expected);
    },
  );

  it('normalizes components and assembles deterministic shared fields', () => {
    const result = finalizeMaterialEvaluation({
      analyzerId: 'test-analyzer',
      material,
      context: { intent: '', availableMinutes: 5, scenario: 'work' },
      profileContext: null,
      components: {
        relevance: 140,
        novelty: 61.2,
        actionability: 72.6,
        quality: -4,
      },
      insights,
      expectedValue: 'One useful idea.',
      recommendedSections: ['Evidence'],
      confidence: 0.73,
      analyzedAt: '2026-08-27T10:00:00.000Z',
    });

    expect(result.components).toEqual({
      relevance: 100,
      novelty: 61,
      actionability: 73,
      quality: 0,
    });
    expect(result.scenario).toBe('work');
    expect(result.recommendedAction).toBeDefined();
    expect(result.estimatedUsefulMinutes).toBeGreaterThan(0);
    expect(result.profileSignals).toEqual([]);
    expect(result.analyzerId).toBe('test-analyzer');
  });

  it('keeps policy overrides and caps unsupported relax confidence', () => {
    const result = finalizeMaterialEvaluation({
      analyzerId: 'test-analyzer',
      material,
      context: { intent: '', availableMinutes: 5, scenario: 'relax' },
      profileContext: null,
      components: {
        relevance: 100,
        novelty: 100,
        actionability: 100,
        quality: 100,
      },
      insights,
      recommendedSections: [],
      confidence: 0.9,
      recommendedActionOverride: 'skip',
      reasonOverride: 'Not enough article content.',
    });

    expect(result.recommendedAction).toBe('skip');
    expect(result.reason).toBe('Not enough article content.');
    expect(result.confidence).toBe(0.48);
  });
});
