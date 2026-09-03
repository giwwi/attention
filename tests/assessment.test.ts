import { describe, expect, it } from 'vitest';
import {
  assessLocalQuality,
  buildLocalInsights,
  calculateNoveltyScore,
  calculateQualityScore,
} from '../src/analyzer/assessment';
import { extractKeyClaims } from '../src/analyzer/claims';
import type { PageCapture, RelevantProfileContext } from '../src/shared/types';

function material(content: string): PageCapture {
  return {
    title: 'Новая оценка продуктивности AI-агентов',
    url: 'https://example.com/research',
    content,
    excerpt: content.slice(0, 220),
    byline: null,
    siteName: 'Example',
    publishedTime: null,
    language: 'ru',
    wordCount: content.match(/[\p{L}\p{N}]+/gu)?.length ?? 0,
    readingTimeMinutes: 5,
    headings: ['Метод', 'Результаты', 'Ограничения'],
    isArticle: true,
    extractionMethod: 'readability',
    capturedAt: '2026-08-26T10:00:00.000Z',
  };
}

const article = [
  'Авторы утверждают, что автономные AI-агенты повышают продуктивность только при наличии строгой проверки промежуточных результатов.',
  'В исследовании 2026 года выборка из 420 задач показала рост успешности на 18 процентов по сравнению с базовым подходом.',
  'Эффект возникает потому, что проверка сокращает накопление ошибок между последовательными действиями агента.',
  'Однако исследование проводилось только на программных задачах, поэтому результат может не переноситься на другие области.',
  'Командам следует сначала внедрить проверку критических шагов, а не увеличивать автономность всей системы.',
].join('\n\n');

describe('claim-level novelty and quality assessment', () => {
  it('extracts substantive claims and classifies empirical evidence', () => {
    const claims = extractKeyClaims(article, 'Продуктивность AI-агентов');

    expect(claims.length).toBeGreaterThanOrEqual(4);
    expect(claims.some((claim) => claim.type === 'evidence')).toBe(true);
    expect(claims.some((claim) => claim.importance === 'primary')).toBe(true);
  });

  it('uses concrete knowledge but treats a learning area as likely new', () => {
    const context: RelevantProfileContext = {
      profileUpdatedAt: '2026-08-26T10:00:00.000Z',
      signals: [],
      knowledgeSignals: [
        {
          id: 'known:1',
          profileEntryId: '1',
          kind: 'known',
          topic: 'AI-агенты',
          statement:
            'Проверка промежуточных результатов снижает накопление ошибок AI-агентов',
          evidenceType: 'demonstrated',
          confidence: 0.95,
          matchScore: 1,
        },
        {
          id: 'learning:1',
          profileEntryId: '2',
          kind: 'learning',
          topic: 'Оценка AI-агентов',
          statement: 'Новые эмпирические оценки продуктивности',
          evidenceType: null,
          confidence: 0.9,
          matchScore: 1,
        },
      ],
    };
    const insights = buildLocalInsights(
      material(article),
      extractKeyClaims(article, 'Продуктивность AI-агентов'),
      context,
    );

    expect(
      insights.keyClaims.some(
        (claim) =>
          claim.novelty === 'known' || claim.novelty === 'partially-known',
      ),
    ).toBe(true);
    expect(
      insights.keyClaims.some((claim) => claim.novelty === 'likely-new'),
    ).toBe(true);
    expect(calculateNoveltyScore(insights.keyClaims)).toBeGreaterThan(30);
  });

  it('calculates quality from fixed component weights', () => {
    expect(
      calculateQualityScore({
        evidence: 80,
        reasoning: 70,
        specificity: 60,
        calibration: 50,
      }),
    ).toBe(69);
  });

  it('uses universal structure even when language heuristics are unavailable', () => {
    const base = {
      ...material('Een analyse van besluitvorming en controle. '.repeat(80)),
      language: 'nl',
    };
    const plain = assessLocalQuality(base);
    const structured = assessLocalQuality(
      {
        ...base,
        structure: {
          paragraphCount: 12,
          headingCount: 4,
          linkCount: 7,
          citationLinkCount: 4,
          quoteCount: 2,
          listItemCount: 5,
          tableCount: 1,
        },
      },
      [
        {
          claim:
            'In 2025 verbeterde onafhankelijke controle de uitkomst in 240 projecten met 18 procent.',
          type: 'fact',
          importance: 'primary',
        },
      ],
    );

    expect(structured.breakdown.evidence).toBeGreaterThan(
      plain.breakdown.evidence,
    );
    expect(structured.breakdown.specificity).toBeGreaterThan(
      plain.breakdown.specificity,
    );
  });
});
