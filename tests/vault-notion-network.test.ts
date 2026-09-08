import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exchangeNotionCode,
  loadNotionOAuthClientId,
  refreshNotionToken,
  revokeNotionToken,
} from '../src/notion/oauth';
import { NotionApiClient } from '../src/notion/client';
import { DataOperationCancelledError } from '../src/privacy/data-operations';

vi.mock('../src/notion/config', () => ({
  NOTION_API_VERSION: '2026-03-11',
  NOTION_OAUTH_BROKER_URL: 'https://broker.example/notion-oauth',
  notionOAuthConfigured: () => true,
}));

afterEach(() => vi.unstubAllGlobals());

const token = {
  access_token: 'test-only-access-token',
  refresh_token: 'test-only-refresh-token',
  bot_id: 'test-bot',
  workspace_id: 'test-workspace',
  workspace_name: 'Private workspace',
};
const auth = {
  accessToken: token.access_token,
  refreshToken: token.refresh_token,
  botId: token.bot_id,
  workspaceId: token.workspace_id,
  workspaceName: token.workspace_name,
  updatedAt: '2026-09-06T00:00:00Z',
};
const brokerActions = [
  {
    name: 'configuration',
    call: (signal?: AbortSignal) => loadNotionOAuthClientId(signal),
    payload: { clientId: 'test-client-id' },
  },
  {
    name: 'code exchange',
    call: (signal?: AbortSignal) =>
      exchangeNotionCode(
        'test-code',
        'https://extension.chromiumapp.org/notion',
        signal,
      ),
    payload: token,
  },
  {
    name: 'token refresh',
    call: (signal?: AbortSignal) =>
      refreshNotionToken('test-refresh-token', signal),
    payload: token,
  },
  {
    name: 'revocation',
    call: (signal?: AbortSignal) =>
      revokeNotionToken('test-access-token', signal),
    payload: { ok: true },
  },
];

describe('Notion vault cancellation', () => {
  it.each(brokerActions)(
    'blocks $name before network access when the vault operation is already cancelled',
    async ({ call }) => {
      const controller = new AbortController();
      controller.abort();
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      await expect(call(controller.signal)).rejects.toBeInstanceOf(
        DataOperationCancelledError,
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(brokerActions)(
    'forwards the cancellation signal for $name',
    async ({ call, payload }) => {
      const controller = new AbortController();
      const fetcher = vi.fn(async () => new Response(JSON.stringify(payload)));
      vi.stubGlobal('fetch', fetcher);
      await call(controller.signal);
      expect(fetcher).toHaveBeenCalledWith(
        'https://broker.example/notion-oauth',
        expect.objectContaining({ signal: controller.signal }),
      );
    },
  );

  it('aborts an in-flight token exchange through fetch', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = exchangeNotionCode(
      'test-code',
      'https://extension.chromiumapp.org/notion',
      controller.signal,
    );
    const rejected = expect(result).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await rejected;
  });

  it('does not return credentials after cancellation during response parsing', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          controller.abort();
          return token;
        },
      })),
    );
    await expect(
      refreshNotionToken('test-refresh-token', controller.signal),
    ).rejects.toBeInstanceOf(DataOperationCancelledError);
  });

  it('does not return page content after cancellation during response parsing', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          controller.abort();
          return { id: 'private-page', title: 'Private title' };
        },
      })),
    );
    await expect(
      new NotionApiClient(auth, async () => null, {
        signal: controller.signal,
      }).retrievePage('private-page'),
    ).rejects.toBeInstanceOf(DataOperationCancelledError);
  });
});

describe('Notion diagnostic error boundary', () => {
  it.each([
    'Private title https://private.example/?token=secret-token',
    { access_token: 'secret-token' },
    null,
  ])(
    'excludes unrecognized broker error payloads from thrown codes and messages: %j',
    async (error) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () => new Response(JSON.stringify({ error }), { status: 400 }),
        ),
      );
      await expect(loadNotionOAuthClientId()).rejects.toMatchObject({
        message: 'broker_request_failed',
        code: 'broker_request_failed',
      });
    },
  );

  it('preserves a recognized broker configuration error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'oauth_not_configured' }), {
            status: 503,
          }),
      ),
    );
    await expect(loadNotionOAuthClientId()).rejects.toMatchObject({
      message: 'oauth_not_configured',
      code: 'oauth_not_configured',
    });
  });

  it.each([
    'Private title https://private.example/?token=secret-token',
    { access_token: 'secret-token' },
    null,
  ])(
    'excludes unrecognized Notion API error payloads from thrown codes and messages: %j',
    async (code) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () => new Response(JSON.stringify({ code }), { status: 400 }),
        ),
      );
      await expect(
        new NotionApiClient(auth, async () => null).retrievePage(
          'private-page',
        ),
      ).rejects.toMatchObject({
        message: 'notion_request_failed',
        code: 'notion_request_failed',
      });
    },
  );

  it.each(['restricted_resource', 'object_not_found'])(
    'preserves %s so indexing can still check missing/inaccessible pages',
    async (code) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () => new Response(JSON.stringify({ code }), { status: 404 }),
        ),
      );
      await expect(
        new NotionApiClient(auth, async () => null).retrievePage(
          'private-page',
        ),
      ).rejects.toMatchObject({ message: code, code });
    },
  );
});
