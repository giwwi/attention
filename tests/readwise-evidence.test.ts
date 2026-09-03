import { describe, expect, it } from 'vitest';
import { buildReadwiseEvidence } from '../src/readwise/evidence';

describe('Readwise evidence', () => {
  it('keeps bounded highlights and fingerprints safe source URLs', async () => {
    const evidence = await buildReadwiseEvidence(
      [
        {
          user_book_id: 10,
          title: 'Practical AI evaluation',
          author: 'A. Researcher',
          source_url: 'https://example.com/ai-evaluation?utm_source=reader',
          book_tags: [{ name: 'AI' }],
          highlights: [
            {
              id: 101,
              text: 'Production benchmarks need explicit failure analysis.',
              note: 'Useful for the evaluation checklist.',
              highlighted_at: '2026-08-20T10:00:00.000Z',
              tags: [{ name: 'methods' }],
            },
          ],
        },
      ],
      new Date('2026-08-27T10:00:00.000Z'),
    );

    expect(evidence).toMatchObject({
      sourceCount: 1,
      highlightCount: 1,
      noteCount: 1,
    });
    expect(evidence.sources[0]?.hostname).toBe('example.com');
    expect(evidence.sources[0]?.urlFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.highlights[0]).toMatchObject({
      note: 'Useful for the evaluation checklist.',
      attentionStrength: 0.9,
    });
    expect(evidence.searchIndex).toMatchObject({
      schemaVersion: 2,
      builtForVersion: '2026-08-27T10:00:00.000Z',
      documentCount: 1,
    });
    expect(JSON.stringify(evidence)).not.toContain('utm_source');
    expect(JSON.stringify(evidence)).not.toContain(
      'https://example.com/ai-evaluation',
    );
  });

  it('does not retain sensitive source URLs or deleted highlights', async () => {
    const evidence = await buildReadwiseEvidence([
      {
        user_book_id: 'mail-source',
        title: 'Inbox item',
        source_url: 'https://gmail.com/mail/u/0/#inbox',
        highlights: [
          { id: 'deleted', text: 'Private text', is_deleted: true },
          { id: 'kept', text: 'A deliberately saved general idea.' },
        ],
      },
    ]);

    expect(evidence.excludedSourceCount).toBe(1);
    expect(evidence.sources[0]?.hostname).toBeNull();
    expect(evidence.sources[0]?.urlFingerprint).toBeNull();
    expect(evidence.highlights.map((highlight) => highlight.id)).toEqual([
      'kept',
    ]);
  });
});
