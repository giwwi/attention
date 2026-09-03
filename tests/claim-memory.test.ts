import { describe, expect, it } from 'vitest';
import { buildMaterialFeatures } from '../src/analyzer/material-features';
import {
  applyClaimMemoryToClaim,
  selectRelevantClaimMemoryEvidence,
} from '../src/novelty/claim-memory';
import {
  CLAIM_MEMORY_REVISION_KEY,
  loadClaimMemoryRevision,
  loadNovelPassageFeedback,
  recordNovelPassageFeedback,
  type NovelPassageFeedbackRecord,
} from '../src/novelty/feedback';
import { NOVEL_PASSAGE_FEEDBACK_TYPE } from '../src/novelty/messages';
import type { KeyClaimAssessment, PageCapture } from '../src/shared/types';

class MemoryStorage {
  readonly data: Record<string, unknown> = {};

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys == null) return { ...this.data };
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(requested.map((key) => [key, this.data[key]]));
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, structuredClone(items));
  }
}

const material: PageCapture = {
  title: 'A field experiment on decision quality',
  url: 'https://example.com/decision-quality?utm_source=test#results',
  content:
    'The field experiment found that structured review reduced decision errors by 31 percent.',
  excerpt: 'A field experiment about structured review.',
  byline: 'Author',
  siteName: 'Example',
  publishedTime: null,
  language: 'en',
  wordCount: 180,
  readingTimeMinutes: 1,
  headings: ['Results'],
  isArticle: true,
  extractionMethod: 'readability',
  capturedAt: '2026-08-28T08:00:00.000Z',
};

const claim: KeyClaimAssessment = {
  claim:
    'Structured review reduced decision errors by 31 percent in the field experiment.',
  sourceExcerpt:
    'The field experiment found that structured review reduced decision errors by 31 percent.',
  type: 'fact',
  importance: 'primary',
  novelty: 'likely-new',
  knownProbability: 0.2,
  reason: 'No previous evidence.',
  confidence: 0.72,
};

function feedback(value: 'known' | 'new'): NovelPassageFeedbackRecord {
  return {
    id: `feedback-${value}`,
    url: 'https://example.com/decision-quality',
    title: material.title,
    claim: claim.claim,
    excerpt: claim.sourceExcerpt ?? claim.claim,
    value,
    createdAt: '2026-08-28T08:10:00.000Z',
  };
}

describe('Claim Memory', () => {
  it('updates its revision whenever the user records a novelty answer', async () => {
    const memory = new MemoryStorage();
    const storage = memory as unknown as chrome.storage.StorageArea;

    await recordNovelPassageFeedback(
      {
        type: NOVEL_PASSAGE_FEEDBACK_TYPE,
        url: material.url,
        title: material.title,
        claim: claim.claim,
        excerpt: claim.sourceExcerpt ?? claim.claim,
        value: 'known',
      },
      storage,
    );

    const records = await loadNovelPassageFeedback(storage);
    const revision = await loadClaimMemoryRevision(storage);
    expect(records).toHaveLength(1);
    expect(revision).toBe(records[0]?.createdAt);
    expect(memory.data[CLAIM_MEMORY_REVISION_KEY]).toBe(revision);
  });

  it('uses an "already knew" answer as strong direct knowledge evidence', async () => {
    const features = await buildMaterialFeatures(material);
    const evidence = selectRelevantClaimMemoryEvidence(
      [feedback('known')],
      features,
    );
    const adjusted = applyClaimMemoryToClaim(claim, evidence ?? undefined);

    expect(evidence?.matches[0]).toMatchObject({
      value: 'known',
      exactPage: true,
    });
    expect(adjusted.novelty).toBe('known');
    expect(adjusted.knownProbability).toBeGreaterThan(0.9);
    expect(adjusted.reason).toContain('отметили похожий тезис');
  });

  it('remembers a previously new claim as encountered knowledge on later analyses', async () => {
    const features = await buildMaterialFeatures(material);
    const evidence = selectRelevantClaimMemoryEvidence(
      [feedback('new')],
      features,
    );
    const adjusted = applyClaimMemoryToClaim(claim, evidence ?? undefined);

    expect(adjusted.novelty).not.toBe('likely-new');
    expect(adjusted.knownProbability).toBeGreaterThan(0.7);
    expect(adjusted.reason).toContain('после этого он уже встречался');
  });

  it('does not apply unrelated feedback to a claim', async () => {
    const features = await buildMaterialFeatures(material);
    const unrelated: NovelPassageFeedbackRecord = {
      ...feedback('known'),
      url: 'https://example.org/cooking',
      claim: 'Butter temperature changes the texture of pastry.',
      excerpt: 'Cold butter creates flaky layers in pastry dough.',
    };
    const evidence = selectRelevantClaimMemoryEvidence([unrelated], features);

    expect(evidence).toBeNull();
    expect(applyClaimMemoryToClaim(claim, undefined)).toEqual(claim);
  });
});
