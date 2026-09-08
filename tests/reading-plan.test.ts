import { describe, expect, it } from 'vitest';
import { buildReadingPlan } from '../src/attention/reading-plan';
import type { MaterialEvaluation, PageCapture } from '../src/shared/types';
import { SUPPORTED_UI_LANGUAGES } from '../src/i18n/ui';

const material: PageCapture = {
  title: 'A long article',
  url: 'https://example.com/article',
  content: 'Article text '.repeat(500),
  excerpt: 'An article.',
  byline: null,
  siteName: 'Example',
  publishedTime: null,
  language: 'en',
  wordCount: 2400,
  readingTimeMinutes: 12,
  headings: [
    'Introduction',
    'Background',
    'Main idea',
    'Evidence',
    'Practical method',
    'Conclusion',
  ],
  isArticle: true,
  extractionMethod: 'readability',
  capturedAt: '2026-09-04T10:00:00.000Z',
};

const evaluation: MaterialEvaluation = {
  scenario: 'work',
  recommendedAction: 'skim',
  utilityScore: 72,
  recommendedSections: ['Main idea', 'Practical method', 'Invented section'],
  profileSignals: [],
  components: { relevance: 80, novelty: 70, actionability: 75, quality: 70 },
  scenarioSignals: {
    relevance: 80,
    novelty: 70,
    quality: 70,
    actionability: 75,
    knowledgeFit: 70,
    timeFit: 80,
    effortFit: 70,
    tasteFit: 50,
    serendipity: 50,
    enjoymentFit: 50,
  },
  estimatedUsefulMinutes: 8,
  reason: 'Useful sections are available.',
  expectedValue: 'A practical method.',
  insights: {
    keyClaims: [],
    likelyNewClaims: ['A new idea'],
    familiarClaims: [],
    noveltySummary: 'Some novelty.',
    noveltyConfidence: 0.7,
    qualityBreakdown: {
      evidence: 70,
      reasoning: 70,
      specificity: 70,
      calibration: 70,
    },
    qualitySummary: 'Good enough.',
    qualityStrengths: [],
    qualityLimitations: [],
    qualityConfidence: 0.7,
  },
  confidence: 0.7,
  analyzerId: 'test',
  analyzedAt: '2026-09-04T10:00:00.000Z',
};

describe('reading plan', () => {
  it('localizes the plan for every supported interface language', () => {
    for (const language of SUPPORTED_UI_LANGUAGES) {
      const plan = buildReadingPlan(material, evaluation, language)!;
      expect(plan.title).not.toMatch(/\{\w+\}/);
      expect(plan.note).toContain('Introduction');
      if (language !== 'en') expect(plan.title).not.toContain('min article');
    }
  });
  it('turns exact recommended headings into a time-saving plan', () => {
    const plan = buildReadingPlan(material, evaluation);

    expect(plan?.title).toBe('12 min article. Read 2 sections in ~4 min.');
    expect(plan?.sections.map((section) => section.heading)).toEqual([
      'Main idea',
      'Practical method',
    ]);
    expect(plan?.note).toContain('Introduction');
  });

  it('refuses hallucinated or stale section names', () => {
    expect(
      buildReadingPlan(material, {
        ...evaluation,
        recommendedSections: ['Invented section'],
      }),
    ).toBeNull();
  });
});
