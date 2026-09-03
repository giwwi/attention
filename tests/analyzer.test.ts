import { describe, expect, it } from 'vitest';
import { LocalAnalyzer } from '../src/analyzer/local-analyzer';
import type { PageCapture } from '../src/shared/types';

function material(overrides: Partial<PageCapture> = {}): PageCapture {
  return {
    title: 'Как управлять ограниченным вниманием',
    url: 'https://example.com/attention',
    content: 'Содержательный текст '.repeat(300),
    excerpt: 'Практический разбор распределения внимания.',
    byline: 'Author',
    siteName: 'Example',
    publishedTime: null,
    language: 'ru',
    wordCount: 600,
    readingTimeMinutes: 3,
    headings: [
      'Почему внимание ограничено',
      'Практическая модель выбора',
      'Следующие шаги',
    ],
    isArticle: true,
    extractionMethod: 'readability',
    capturedAt: '2026-08-25T10:00:00.000Z',
    ...overrides,
  };
}

describe('LocalAnalyzer', () => {
  const analyzer = new LocalAnalyzer();

  it('does not equate fitting the time budget with high utility', async () => {
    const result = await analyzer.analyze(material(), {
      intent: '',
      availableMinutes: 5,
      scenario: 'work',
    });

    expect(result.recommendedAction).not.toBe('read');
    expect(result.utilityScore).toBeLessThan(70);
    expect(result.components.quality).toBeLessThan(60);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.analyzerId).toBe('local-claim-assessment-v4');
    expect(result.profileSignals).toEqual([]);
  });

  it('recommends skimming and prioritizes relevant sections', async () => {
    const result = await analyzer.analyze(
      material({ readingTimeMinutes: 22 }),
      {
        intent: 'Понять практическую модель',
        availableMinutes: 5,
        scenario: 'work',
      },
    );

    expect(result.recommendedAction).toBe('skim');
    expect(result.recommendedSections[0]).toBe('Практическая модель выбора');
    expect(result.expectedValue).toContain('выглядит релевантным');
  });

  it('matches common Russian word forms in the stated intent', async () => {
    const result = await analyzer.analyze(material(), {
      intent: 'Понять ограничения внимания',
      availableMinutes: 5,
      scenario: 'work',
    });

    expect(result.expectedValue).toContain('выглядит релевантным');
    expect(result.recommendedSections[0]).toBe('Почему внимание ограничено');
  });

  it('recommends skipping pages without meaningful article content', async () => {
    const result = await analyzer.analyze(
      material({ isArticle: false, wordCount: 25, headings: [] }),
      { intent: '', availableMinutes: 15, scenario: 'work' },
    );

    expect(result.recommendedAction).toBe('skip');
    expect(result.reason).toContain('Не удалось выделить');
  });

  it('uses an active goal to explain personal value', async () => {
    const result = await analyzer.analyze(
      material({
        title: 'Новые исследования AI-агентов',
        excerpt: 'Обзор архитектур автономных AI-агентов.',
      }),
      { intent: '', availableMinutes: 5, scenario: 'work' },
      {
        profileUpdatedAt: '2026-08-25T10:00:00.000Z',
        signals: [
          {
            id: 'goal:1',
            profileEntryId: '1',
            kind: 'goal',
            effect: 'positive',
            label: 'Следить за исследованиями AI-агентов',
            explanation:
              'Материал пересекается с активной целью «Следить за исследованиями AI-агентов».',
            confidence: 0.9,
            matchScore: 0.8,
          },
        ],
      },
    );

    expect(['read', 'skim']).toContain(result.recommendedAction);
    expect(result.reason).toContain('текущей задаче');
    expect(result.expectedValue).toContain('продвинуть активную цель');
    expect(result.profileSignals).toHaveLength(1);
  });

  it('can skip a strongly matching low-value topic', async () => {
    const result = await analyzer.analyze(
      material({ title: 'Основы AI для начинающих' }),
      { intent: '', availableMinutes: 15, scenario: 'work' },
      {
        profileUpdatedAt: '2026-08-25T10:00:00.000Z',
        signals: [
          {
            id: 'low:1',
            profileEntryId: '1',
            kind: 'lowValueTopic',
            effect: 'negative',
            label: 'Основы AI для начинающих',
            explanation:
              'Материал похож на отмеченную малоценную тему «Основы AI для начинающих».',
            confidence: 0.9,
            matchScore: 1,
          },
        ],
      },
    );

    expect(result.recommendedAction).toBe('skip');
    expect(result.reason).toContain('текущей задачей');
    expect(result.expectedValue).toContain('низкая предельная ценность');
  });

  it('caps confidence for unsupported analysis languages', async () => {
    const result = await analyzer.analyze(
      material({
        language: 'nl',
        title: 'Betrouwbare beslissingen',
        content:
          'Een uitvoerige Nederlandse analyse van bronnen en besluitvorming. '.repeat(
            120,
          ),
      }),
      { intent: '', availableMinutes: 15, scenario: 'work' },
    );

    expect(result.confidence).toBeLessThanOrEqual(0.48);
    expect(result.insights?.reliability?.languageSupported).toBe(false);
    expect(result.insights?.reliability?.level).not.toBe('high');
  });

  it('marks weak visible-text extraction as approximate', async () => {
    const result = await analyzer.analyze(
      material({
        extractionMethod: 'visible-text',
        isArticle: false,
        wordCount: 90,
        headings: [],
        structure: {
          paragraphCount: 1,
          headingCount: 0,
          linkCount: 0,
          citationLinkCount: 0,
          quoteCount: 0,
          listItemCount: 0,
          tableCount: 0,
        },
      }),
      { intent: '', availableMinutes: 15, scenario: 'work' },
    );

    expect(result.confidence).toBeLessThanOrEqual(0.42);
    expect(result.insights?.reliability?.weakExtraction).toBe(true);
    expect(result.insights?.qualityConfidence).toBeLessThanOrEqual(0.42);
  });
});
