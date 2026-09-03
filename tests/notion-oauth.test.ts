import { afterEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../api/notion-oauth';

const extensionOrigin = 'chrome-extension://attention-test-extension';
const redirectUri = 'https://attention-test-extension.chromiumapp.org/notion';

function configureEnvironment(): void {
  process.env.ATTENTION_EXTENSION_ORIGINS = extensionOrigin;
  process.env.NOTION_CLIENT_ID = 'notion-client-id';
  process.env.NOTION_CLIENT_SECRET = 'notion-client-secret';
  process.env.NOTION_REDIRECT_URI = redirectUri;
}

afterEach(() => {
  delete process.env.ATTENTION_EXTENSION_ORIGINS;
  delete process.env.NOTION_CLIENT_ID;
  delete process.env.NOTION_CLIENT_SECRET;
  delete process.env.NOTION_REDIRECT_URI;
  vi.unstubAllGlobals();
});

describe('Notion OAuth broker', () => {
  it('rejects requests from origins outside the configured extension', async () => {
    configureEnvironment();

    const response = await handler(
      new Request('https://attention.example/api/notion-oauth', {
        headers: { Origin: 'chrome-extension://different-extension' },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('returns only the public client id to the configured extension', async () => {
    configureEnvironment();

    const response = await handler(
      new Request('https://attention.example/api/notion-oauth', {
        headers: { Origin: extensionOrigin },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      clientId: 'notion-client-id',
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      extensionOrigin,
    );
  });

  it('rejects a substituted OAuth redirect before contacting Notion', async () => {
    configureEnvironment();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handler(
      new Request('https://attention.example/api/notion-oauth', {
        method: 'POST',
        headers: {
          Origin: extensionOrigin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'exchange',
          code: 'oauth-code-value',
          redirectUri: 'https://attacker.example/callback',
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
