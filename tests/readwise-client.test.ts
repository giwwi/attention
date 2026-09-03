import { describe, expect, it, vi } from 'vitest';
import {
  saveReadwiseHighlight,
  syncReadwiseLibrary,
  validateReadwiseToken,
} from '../src/readwise/client';

describe('Readwise API client', () => {
  it('validates the token and follows export pagination', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ user_book_id: 1, title: 'First', highlights: [] }],
            nextPageCursor: 'next-cursor',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                user_book_id: 2,
                title: 'Second',
                highlights: [{ id: 3, text: 'A useful saved claim.' }],
              },
            ],
            nextPageCursor: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const result = await syncReadwiseLibrary(
      'readwise-test-token',
      fetchImpl,
      new Date('2026-08-27T10:00:00.000Z'),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(fetchImpl.mock.calls[2]?.[0])).toContain(
      'pageCursor=next-cursor',
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Token readwise-test-token' },
      credentials: 'omit',
      cache: 'no-store',
    });
    expect(result.evidence).toMatchObject({
      sourceCount: 2,
      highlightCount: 1,
    });
  });

  it('reports rejected credentials without persisting anything', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      validateReadwiseToken('readwise-test-token', fetchImpl),
    ).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });

  it('requests and merges only records changed after the previous sync', async () => {
    const initialFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                user_book_id: 1,
                title: 'Keep this source',
                highlights: [{ id: 11, text: 'A retained useful claim.' }],
              },
              {
                user_book_id: 2,
                title: 'Changed source',
                highlights: [{ id: 21, text: 'The old saved claim.' }],
              },
            ],
            nextPageCursor: null,
          }),
          { status: 200 },
        ),
      );
    const initial = await syncReadwiseLibrary(
      'readwise-test-token',
      initialFetch,
      new Date('2026-08-27T10:00:00.000Z'),
    );

    const deltaFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                user_book_id: 2,
                title: 'Changed source',
                highlights: [{ id: 22, text: 'The new saved claim.' }],
              },
            ],
            nextPageCursor: null,
          }),
          { status: 200 },
        ),
      );
    const updatedAfter = '2026-08-27T10:00:00.000Z';
    const delta = await syncReadwiseLibrary(
      'readwise-test-token',
      deltaFetch,
      new Date('2026-08-28T10:00:00.000Z'),
      initial.evidence,
      updatedAfter,
    );

    expect(String(deltaFetch.mock.calls[1]?.[0])).toContain(
      `updatedAfter=${encodeURIComponent(updatedAfter)}`,
    );
    expect(delta.evidence.sources.map((source) => source.id).sort()).toEqual([
      '1',
      '2',
    ]);
    expect(
      delta.evidence.highlights.map((highlight) => highlight.id).sort(),
    ).toEqual(['11', '22']);
  });

  it('sends only the explicitly selected passage to Readwise', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }));

    await saveReadwiseHighlight(
      'readwise-test-token',
      {
        text: 'The exact passage selected by the user contains a useful fact.',
        title: 'A useful article',
        author: 'Example Author',
        sourceUrl:
          'https://example.com/article?utm_source=feed&view=reader#section',
        highlightedAt: '2026-08-27T18:00:00.000Z',
      },
      fetchImpl,
    );

    const request = fetchImpl.mock.calls[0];
    expect(String(request?.[0])).toBe('https://readwise.io/api/v2/highlights/');
    expect(request?.[1]).toMatchObject({ method: 'POST' });
    const body = JSON.parse(String(request?.[1]?.body)) as {
      highlights: Array<Record<string, unknown>>;
    };
    expect(body.highlights).toEqual([
      expect.objectContaining({
        text: 'The exact passage selected by the user contains a useful fact.',
        title: 'A useful article',
        author: 'Example Author',
        source_url: 'https://example.com/article?view=reader',
        source_type: 'attention',
      }),
    ]);
  });
});
