import { describe, expect, it } from 'vitest';
import {
  applyUnifiedLocalEvidenceToClaim,
  mergeUnifiedLocalEvidence,
} from '../src/evidence/unified-evidence';
import type {
  KeyClaimAssessment,
  RelevantNotionEvidence,
  RelevantReadwiseEvidence,
} from '../src/shared/types';

const updatedAt = '2026-08-28T10:00:00.000Z';
const excerpt =
  'Production AI evaluation requires representative benchmarks and explicit failure analysis.';

const readwise: RelevantReadwiseEvidence = {
  exactSourceMatched: true,
  matchingSourceCount: 1,
  matchingHighlightCount: 1,
  familiarityConfidence: 0.8,
  matchingHighlights: [
    {
      id: 'highlight-1',
      sourceId: 'book-1',
      sourceTitle: 'Production AI evaluation',
      excerpt,
      notePresent: false,
      tags: [],
      attentionStrength: 0.72,
      matchScore: 0.9,
      materialKey: 'url:same-article',
      exactSource: true,
    },
  ],
  exactSources: [],
  evidenceUpdatedAt: updatedAt,
};

const notion: RelevantNotionEvidence = {
  exactSourceMatched: true,
  matchingPageCount: 1,
  matchingFragmentCount: 1,
  familiarityConfidence: 0.8,
  matchingFragments: [
    {
      id: 'fragment-1',
      pageId: 'page-1',
      pageTitle: 'Production AI evaluation',
      heading: null,
      excerpt,
      kind: 'imported',
      attentionStrength: 0.56,
      matchScore: 0.9,
      materialKey: 'url:same-article',
      exactSource: true,
    },
  ],
  exactPages: [],
  evidenceUpdatedAt: updatedAt,
};

const claim: KeyClaimAssessment = {
  claim: excerpt,
  type: 'recommendation',
  importance: 'primary',
  novelty: 'likely-new',
  knownProbability: 0.2,
  reason: 'No prior evidence.',
  confidence: 0.5,
};

describe('unified local evidence', () => {
  it.each(['highlight', 'own-note', 'imported'] as const)(
    'does not convert changed quantities into known claims from %s',
    (kind) => {
      const text =
        'A field experiment found that structured review reduced errors by 90 percent.';
      const merged = mergeUnifiedLocalEvidence({ readwise })!;
      const item = {
        ...merged.items[0]!,
        kind,
        excerpt: text,
        attentionStrength: 1,
      };
      const evidence = { ...merged, items: [item] };
      const same = { ...claim, claim: text, sourceExcerpt: text };
      const changed = {
        ...claim,
        claim: text.replace('90', '10'),
        sourceExcerpt: text.replace('90', '10'),
      };
      expect(
        applyUnifiedLocalEvidenceToClaim(same, evidence).knownProbability,
      ).toBeGreaterThan(claim.knownProbability);
      expect(applyUnifiedLocalEvidenceToClaim(changed, evidence)).toEqual(
        changed,
      );
      expect(
        applyUnifiedLocalEvidenceToClaim(
          { ...changed, sourceExcerpt: text },
          evidence,
        ).knownProbability,
      ).toBe(claim.knownProbability);
    },
  );
  it('deduplicates one material stored in multiple connectors', () => {
    const merged = mergeUnifiedLocalEvidence({ readwise, notion });

    expect(merged?.materialCount).toBe(1);
    expect(merged?.items).toHaveLength(1);
    expect(merged?.items[0]?.sources).toEqual(
      expect.arrayContaining(['readwise', 'notion']),
    );
  });

  it('applies the centralized weight rule only once', () => {
    const readwiseOnly = mergeUnifiedLocalEvidence({ readwise });
    const duplicated = mergeUnifiedLocalEvidence({ readwise, notion });
    const singleResult = applyUnifiedLocalEvidenceToClaim(
      claim,
      readwiseOnly ?? undefined,
    );
    const duplicateResult = applyUnifiedLocalEvidenceToClaim(
      claim,
      duplicated ?? undefined,
    );

    expect(duplicateResult.knownProbability).toBe(
      singleResult.knownProbability,
    );
    expect(duplicateResult.confidence).toBe(singleResult.confidence);
  });
});
