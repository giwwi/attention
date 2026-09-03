const NOTION_VERSION = '2026-03-11';
const TOKEN_ENDPOINT = 'https://api.notion.com/v1/oauth/token';
const REVOKE_ENDPOINT = 'https://api.notion.com/v1/oauth/revoke';

function environment(name: string): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.process?.env?.[name];
}

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (!origin?.startsWith('chrome-extension://')) return null;
  const configured = environment('ATTENTION_EXTENSION_ORIGINS')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!configured?.length || !configured.includes(origin)) return null;
  return origin;
}

function json(body: unknown, status: number, origin: string | null): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      ...(origin
        ? {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Headers': 'content-type',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          }
        : {}),
    },
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length >= minimum && normalized.length <= maximum
    ? normalized
    : null;
}

function safeTokenResponse(value: unknown): Record<string, unknown> | null {
  const item = record(value);
  const accessToken = boundedString(item?.access_token, 20, 2_048);
  const botId = boundedString(item?.bot_id, 8, 120);
  const workspaceId = boundedString(item?.workspace_id, 8, 120);
  if (!item || !accessToken || !botId || !workspaceId) return null;
  return {
    access_token: accessToken,
    refresh_token: boundedString(item.refresh_token, 20, 2_048),
    bot_id: botId,
    workspace_id: workspaceId,
    workspace_name: boundedString(item.workspace_name, 1, 300),
  };
}

async function notionRequest(
  url: string,
  clientId: string,
  clientSecret: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify(body),
  });
}

async function handler(request: Request): Promise<Response> {
  const origin = allowedOrigin(request);
  if (!origin) return json({ error: 'Forbidden' }, 403, null);
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Cache-Control': 'no-store',
        Vary: 'Origin',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
    });
  }

  const clientId = environment('NOTION_CLIENT_ID');
  const clientSecret = environment('NOTION_CLIENT_SECRET');
  const registeredRedirectUri = environment('NOTION_REDIRECT_URI');
  if (!clientId || !clientSecret || !registeredRedirectUri) {
    return json({ error: 'oauth_not_configured' }, 503, origin);
  }
  if (request.method === 'GET') {
    return json({ clientId }, 200, origin);
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, origin);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400, origin);
  }
  const item = record(body);
  if (!item) {
    return json({ error: 'invalid_request' }, 400, origin);
  }
  const action = item?.action;
  let upstream: Response;

  if (action === 'exchange') {
    const code = boundedString(item.code, 8, 1_024);
    const redirectUri = boundedString(item.redirectUri, 12, 1_024);
    if (!code || redirectUri !== registeredRedirectUri) {
      return json({ error: 'invalid_request' }, 400, origin);
    }
    upstream = await notionRequest(TOKEN_ENDPOINT, clientId, clientSecret, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
  } else if (action === 'refresh') {
    const refreshToken = boundedString(item.refreshToken, 20, 2_048);
    if (!refreshToken) {
      return json({ error: 'invalid_request' }, 400, origin);
    }
    upstream = await notionRequest(TOKEN_ENDPOINT, clientId, clientSecret, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  } else if (action === 'revoke') {
    const accessToken = boundedString(item.accessToken, 20, 2_048);
    if (!accessToken) {
      return json({ error: 'invalid_request' }, 400, origin);
    }
    upstream = await notionRequest(REVOKE_ENDPOINT, clientId, clientSecret, {
      token: accessToken,
    });
    if (!upstream.ok) {
      return json({ error: 'notion_revoke_failed' }, 502, origin);
    }
    return json({ ok: true }, 200, origin);
  } else {
    return json({ error: 'invalid_request' }, 400, origin);
  }

  const payload: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    return json({ error: 'notion_oauth_failed' }, 502, origin);
  }
  const safe = safeTokenResponse(payload);
  return safe
    ? json(safe, 200, origin)
    : json({ error: 'invalid_notion_response' }, 502, origin);
}

export default { fetch: handler };

export { handler };
