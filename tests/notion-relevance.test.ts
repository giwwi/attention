import { describe, expect, it } from 'vitest';
import {
  applyNotionEvidenceToClaim,
  selectRelevantNotionEvidence,
} from '../src/notion/relevance';
import type { NotionIndex } from '../src/notion/types';
import type { KeyClaimAssessment, PageCapture } from '../src/shared/types';

const material: PageCapture = {
  title: 'How to evaluate production AI systems',
  url: 'https://example.com/production-ai-evaluation',
  content:
    'Production AI evaluation requires representative benchmarks and explicit failure analysis. '.repeat(
      50,
    ),
  excerpt:
    'Production benchmarks and failure analysis for reliable AI systems.',
  byline: null,
  siteName: 'Example',
  publishedTime: null,
  language: 'en',
  wordCount: 500,
  readingTimeMinutes: 3,
  headings: ['Benchmarks', 'Failure analysis'],
  isArticle: true,
  extractionMethod: 'readability',
  capturedAt: '2026-08-27T10:00:00.000Z',
};

const claim: KeyClaimAssessment = {
  claim:
    'Production AI evaluation requires representative benchmarks and explicit failure analysis.',
  type: 'recommendation',
  importance: 'primary',
  novelty: 'likely-new',
  knownProbability: 0.24,
  reason: 'No prior evidence.',
  confidence: 0.55,
};

function index(kind: 'own-note' | 'imported'): NotionIndex {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-27T10:00:00.000Z',
    workspaceName: 'Knowledge',
    pages: [
      {
        id: 'page-1',
        title: 'Production readiness',
        notionUrl: 'https://notion.so/page-1',
        sourceUrlFingerprint: null,
        editedAt: new Date('2026-08-20T10:00:00.000Z').getTime(),
        sourceMode: kind === 'own-note' ? 'own-notes' : 'saved-materials',
        fragments: [
          {
            id: 'page-1:0',
            pageId: 'page-1',
            pageTitle: 'Production readiness',
            heading: 'Evaluation method',
            text: `${claim.claim} I use both as release gates.`,
            kind,
            attentionStrength: kind === 'own-note' ? 0.88 : 0.56,
            editedAt: new Date('2026-08-20T10:00:00.000Z').getTime(),
          },
        ],
      },
    ],
  };
}

describe('Notion relevance', () => {
  it('uses matching own writing as bounded local familiarity evidence', async () => {
    const evidence = await selectRelevantNotionEvidence(
      index('own-note'),
      material,
    );
    const adjusted = applyNotionEvidenceToClaim(claim, evidence ?? undefined);

    expect(evidence).toMatchObject({
      matchingPageCount: 1,
      matchingFragmentCount: 1,
    });
    expect(adjusted.knownProbability).toBeGreaterThan(claim.knownProbability);
    expect(adjusted.knownProbability).toBeLessThanOrEqual(0.92);
    expect(adjusted.reason).toContain('вашей заметке Notion');
  });

  it('treats saved material as weaker evidence than own writing', async () => {
    const ownEvidence = await selectRelevantNotionEvidence(
      index('own-note'),
      material,
    );
    const importedEvidence = await selectRelevantNotionEvidence(
      index('imported'),
      material,
    );
    const own = applyNotionEvidenceToClaim(claim, ownEvidence ?? undefined);
    const imported = applyNotionEvidenceToClaim(
      claim,
      importedEvidence ?? undefined,
    );

    expect(imported.knownProbability).toBeLessThan(own.knownProbability);
    expect(imported.knownProbability).toBeLessThanOrEqual(0.78);
    expect(imported.reason).toContain('сохранённом материале Notion');
  });

  it('ignores unrelated Notion pages', async () => {
    const unrelated = index('own-note');
    unrelated.pages[0]!.fragments[0]!.text =
      'Sourdough fermentation depends on temperature and hydration.';

    await expect(
      selectRelevantNotionEvidence(unrelated, material),
    ).resolves.toBeNull();
  });
});
