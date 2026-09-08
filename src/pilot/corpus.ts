import {
  assessLocalQuality,
  calculateQualityScore,
} from '../analyzer/assessment';
import { applyClaimMemoryToClaim } from '../novelty/claim-memory';
import { extractKeyClaims } from '../analyzer/claims';
import type { KeyClaimAssessment, PageCapture } from '../shared/types';

export interface ChallengeCorpus {
  schemaVersion: 1;
  id: string;
  provenance: string;
  split: string;
  novelty: {
    id: string;
    language: string;
    prior: string;
    claim: string;
    label: 'same' | 'different';
    rationale: string;
  }[];
  qualityPairs: {
    id: string;
    language: string;
    stronger: string;
    weaker: string;
    rationale: string;
  }[];
}

function material(content: string, language: string): PageCapture {
  const count = content.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  return {
    title: 'Technical explanation',
    content,
    excerpt: content.slice(0, 200),
    url: 'https://corpus.invalid/article',
    byline: null,
    siteName: 'Authored challenge',
    publishedTime: null,
    language,
    wordCount: count,
    readingTimeMinutes: Math.max(1, Math.ceil(count / 220)),
    headings: [],
    isArticle: true,
    extractionMethod: 'readability',
    capturedAt: '2026-09-05T00:00:00.000Z',
  };
}

export function evaluateChallengeCorpus(corpus: ChallengeCorpus) {
  const novelty = corpus.novelty.map((item) => {
    const claim: KeyClaimAssessment = {
      claim: item.claim,
      sourceExcerpt: item.claim,
      type: 'fact',
      importance: 'primary',
      novelty: 'uncertain',
      knownProbability: 0.42,
      confidence: 0.36,
      reason: 'No direct evidence',
    };
    const result = applyClaimMemoryToClaim(claim, {
      evidenceUpdatedAt: '2026-09-05',
      matches: [
        {
          id: item.id,
          url: 'https://corpus.invalid/prior',
          claim: item.prior,
          excerpt: item.prior,
          value: 'known',
          matchScore: 1,
          exactPage: false,
          createdAt: '2026-09-04',
        },
      ],
    });
    const predictedKnown =
      result.novelty === 'known' || result.novelty === 'partially-known';
    return {
      id: item.id,
      label: item.label,
      predictedKnown,
      novelty: result.novelty,
      knownProbability: result.knownProbability,
      confidence: result.confidence,
      correct: predictedKnown === (item.label === 'same'),
    };
  });
  const qualityPairs = corpus.qualityPairs.map((item) => {
    const score = (text: string) =>
      calculateQualityScore(
        assessLocalQuality(
          material(text, item.language),
          extractKeyClaims(text, 'Technical explanation', item.language),
        ).breakdown,
      );
    const strongerScore = score(item.stronger);
    const weakerScore = score(item.weaker);
    return {
      id: item.id,
      strongerScore,
      weakerScore,
      correct: strongerScore > weakerScore,
    };
  });
  return {
    corpusId: corpus.id,
    kind: 'synthetic-development-challenge',
    provenance: corpus.provenance,
    limitations: [
      'Not a human pilot or held-out accuracy estimate.',
      'Novelty checks direct local claim memory; quality checks pair ordering, not factual truth.',
      'Never use this development corpus as the independent human test set.',
    ],
    novelty: {
      cases: novelty.length,
      falseKnown: novelty.filter(
        (item) => item.label === 'different' && item.predictedKnown,
      ).length,
      missedSame: novelty.filter(
        (item) => item.label === 'same' && !item.predictedKnown,
      ).length,
      casesDetail: novelty,
    },
    quality: {
      pairs: qualityPairs.length,
      correctlyOrdered: qualityPairs.filter((item) => item.correct).length,
      casesDetail: qualityPairs,
    },
  };
}
