import { describe, expect, it } from 'vitest';
import { buildReadwiseEvidence } from '../src/readwise/evidence';
import {
  applyReadwiseEvidenceToClaim,
  selectRelevantReadwiseEvidence,
} from '../src/readwise/relevance';
import type { KeyClaimAssessment, PageCapture } from '../src/shared/types';

const material: PageCapture = {
  title: 'How to evaluate production AI systems',
  url: 'https://example.com/production-ai-evaluation',
  content:
    'Production AI evaluation requires representative benchmarks and explicit failure analysis. '.repeat(
      60,
    ),
  excerpt:
    'Production benchmarks and failure analysis for reliable AI systems.',
  byline: null,
  siteName: 'Example',
  publishedTime: null,
  language: 'en',
  wordCount: 600,
  readingTimeMinutes: 3,
  headings: ['Benchmarks', 'Failure analysis'],
  isArticle: true,
  extractionMethod: 'readability',
  capturedAt: '2026-08-27T10:00:00.000Z',
};

describe('Readwise relevance', () => {
  it('uses a matching highlight as bounded familiarity evidence', async () => {
    const library = await buildReadwiseEvidence([
      {
        user_book_id: 1,
        title: material.title,
        source_url: material.url,
        highlights: [
          {
            id: 2,
            text: 'Production AI evaluation requires representative benchmarks and explicit failure analysis.',
            note: 'Add this to the reliability checklist.',
          },
        ],
      },
    ]);
    const evidence = await selectRelevantReadwiseEvidence(library, material);
    const claim: KeyClaimAssessment = {
      claim:
        'Production AI evaluation requires representative benchmarks and explicit failure analysis.',
      type: 'recommendation',
      importance: 'primary',
      novelty: 'likely-new',
      knownProbability: 0.25,
      reason: 'No prior evidence.',
      confidence: 0.55,
    };
    const adjusted = applyReadwiseEvidenceToClaim(claim, evidence ?? undefined);

    expect(evidence).toMatchObject({
      exactSourceMatched: true,
      matchingHighlightCount: 1,
    });
    expect(adjusted.knownProbability).toBeGreaterThan(claim.knownProbability);
    expect(adjusted.knownProbability).toBeLessThanOrEqual(0.86);
    expect(adjusted.reason).toContain('Readwise');
  });

  it('does not invent evidence for an unrelated material', async () => {
    const library = await buildReadwiseEvidence([
      {
        user_book_id: 1,
        title: 'French cooking',
        source_url: 'https://example.org/cooking',
        highlights: [{ id: 2, text: 'Butter temperature changes pastry.' }],
      },
    ]);

    await expect(
      selectRelevantReadwiseEvidence(library, material),
    ).resolves.toBeNull();
  });
});
