import { describe, expect, it } from 'vitest';
import {
  buildLocalSearchIndex,
  searchLocalIndex,
  updateLocalSearchIndex,
} from '../src/evidence/local-search-index';
import { textTokens } from '../src/analyzer/text-match';

describe('local connector search index', () => {
  it('returns only documents sharing meaningful query tokens', () => {
    const index = buildLocalSearchIndex(
      [
        {
          id: 'ai',
          text: 'Representative production AI benchmarks and failure analysis.',
        },
        {
          id: 'cooking',
          text: 'Sourdough fermentation temperature and flour hydration.',
        },
      ],
      'sync-1',
    );

    expect([
      ...searchLocalIndex(index, textTokens('AI production benchmarks')),
    ]).toEqual(['ai']);
    expect(index.documentCount).toBe(2);
    expect(index.builtForVersion).toBe('sync-1');
  });

  it('updates only changed postings and removes stale documents', () => {
    const initial = buildLocalSearchIndex(
      [
        { id: 'keep', text: 'climate policy evidence' },
        { id: 'change', text: 'software release notes' },
        { id: 'remove', text: 'finance market outlook' },
      ],
      'sync-1',
    );
    const updated = updateLocalSearchIndex(
      initial,
      ['remove'],
      [{ id: 'change', text: 'machine learning benchmarks' }],
      'sync-2',
    );

    expect(updated.documentIds.sort()).toEqual(['change', 'keep']);
    expect([
      ...searchLocalIndex(updated, textTokens('machine learning benchmarks')),
    ]).toEqual(['change']);
    expect([
      ...searchLocalIndex(updated, textTokens('finance market outlook')),
    ]).toEqual([]);
  });
});
