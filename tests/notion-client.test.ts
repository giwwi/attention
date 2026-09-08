import { afterEach, expect, it, vi } from 'vitest';
import { NotionApiClient } from '../src/notion/client';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const auth = {
  accessToken: 'test-only-notion-access-token',
  refreshToken: null,
  botId: 'bot',
  workspaceId: 'workspace',
  workspaceName: 'Test workspace',
  updatedAt: '2026-09-01T00:00:00Z',
};

it('reports incomplete pagination when the 300-page client cap is reached', async () => {
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 400));
  let page = 0;
  const fetcher = vi.fn(async () => {
    const current = page++;
    return new Response(
      JSON.stringify({
        results: Array.from({ length: 100 }, (_, index) => ({
          id: `page-${current * 100 + index}`,
        })),
        has_more: true,
        next_cursor: `cursor-${page}`,
      }),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  const result = await new NotionApiClient(
    auth,
    async () => null,
  ).searchPages();
  expect(result.pages).toHaveLength(300);
  expect(result.paginationComplete).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('distinguishes an exhausted cursor from a provider-side incomplete response', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ results: [], has_more: false, next_cursor: null }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [],
            has_more: false,
            next_cursor: null,
            request_status: { type: 'incomplete' },
          }),
        ),
      ),
  );
  expect(
    (await new NotionApiClient(auth, async () => null).searchPages())
      .paginationComplete,
  ).toBe(true);
  expect(
    (await new NotionApiClient(auth, async () => null).searchPages())
      .paginationComplete,
  ).toBe(false);
});
