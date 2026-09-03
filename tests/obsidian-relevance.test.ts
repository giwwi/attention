import { describe, expect, it } from 'vitest';
import { parseObsidianNote } from '../src/obsidian/markdown';
import {
  applyObsidianEvidenceToClaim,
  selectRelevantObsidianEvidence,
} from '../src/obsidian/relevance';
import type { ObsidianIndex } from '../src/obsidian/types';
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

function index(markdown: string): ObsidianIndex {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-27T10:00:00.000Z',
    vaultName: 'Knowledge',
    notes: [
      parseObsidianNote({
        path: 'AI evaluation.md',
        markdown,
        modifiedAt: new Date('2026-08-20T10:00:00.000Z').getTime(),
        size: markdown.length,
      }),
    ],
  };
}

describe('Obsidian relevance', () => {
  it('uses matching own writing as strong local familiarity evidence', () => {
    const evidence = selectRelevantObsidianEvidence(
      index(`# Production readiness

## Evaluation method

Production AI evaluation requires representative benchmarks and explicit failure analysis before deployment decisions can be trusted. I use both as release gates.
`),
      material,
    );
    const adjusted = applyObsidianEvidenceToClaim(claim, evidence ?? undefined);

    expect(evidence).toMatchObject({
      matchingNoteCount: 1,
      matchingFragmentCount: 1,
    });
    expect(adjusted.knownProbability).toBeGreaterThan(claim.knownProbability);
    expect(adjusted.knownProbability).toBeLessThanOrEqual(0.92);
    expect(adjusted.reason).toContain('вашей заметке');
    expect(adjusted.reason).toContain('Production readiness');
  });

  it('caps imported text below own-note evidence and ignores unrelated notes', () => {
    const imported = selectRelevantObsidianEvidence(
      index(`---
source: https://example.com/imported
---
Production AI evaluation requires representative benchmarks and explicit failure analysis before deployment decisions can be trusted.
`),
      material,
    );
    const adjusted = applyObsidianEvidenceToClaim(claim, imported ?? undefined);

    expect(adjusted.knownProbability).toBeLessThanOrEqual(0.78);
    expect(adjusted.reason).toContain('импортированной заметке');
    expect(
      selectRelevantObsidianEvidence(
        index(
          'Sourdough fermentation depends on dough temperature and hydration during a long cold proof.',
        ),
        material,
      ),
    ).toBeNull();
  });
});
