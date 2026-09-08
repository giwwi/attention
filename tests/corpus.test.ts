import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluateChallengeCorpus,
  type ChallengeCorpus,
} from '../src/pilot/corpus';

describe('separate authored quality and novelty corpus', () => {
  it('has explicit provenance and stable labels, and reports misses without rewriting labels', () => {
    const corpus = JSON.parse(
      readFileSync('experiments/corpus/seed-v1.json', 'utf8'),
    ) as ChallengeCorpus;
    const before = JSON.stringify(corpus);
    const report = evaluateChallengeCorpus(corpus);
    const cases = [...corpus.novelty, ...corpus.qualityPairs];
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
    expect(cases.every((item) => item.rationale.trim().length > 0)).toBe(true);
    expect(report.kind).toBe('synthetic-development-challenge');
    expect(report.novelty.casesDetail).toHaveLength(corpus.novelty.length);
    expect(report.quality.casesDetail).toHaveLength(corpus.qualityPairs.length);
    expect(JSON.stringify(corpus)).toBe(before);
  });
});
