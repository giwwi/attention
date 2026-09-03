import { NOTION_OAUTH_BROKER_URL, notionOAuthConfigured } from './config';
import type { NotionAuth } from './types';

interface BrokerConfig {
  clientId: string;
}

interface TokenPayload {
  access_token: string;
  refresh_token: string | null;
  bot_id: string;
  workspace_id: string;
  workspace_name: string | null;
}

function brokerError(status: number, body: unknown): Error {
  const code =
    body && typeof body === 'object' && 'error' in body
      ? String((body as { error: unknown }).error)
      : `broker_${status}`;
  return Object.assign(new Error(code), { code });
}

async function brokerFetch(
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
): Promise<unknown> {
  if (!notionOAuthConfigured()) {
    throw Object.assign(new Error('oauth_not_configured'), {
      code: 'oauth_not_configured',
    });
  }
  const response = await fetch(NOTION_OAUTH_BROKER_URL, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw brokerError(response.status, payload);
  return payload;
}

function tokenPayload(value: unknown): TokenPayload {
  if (!value || typeof value !== 'object') {
    throw Object.assign(new Error('invalid_broker_response'), {
      code: 'invalid_broker_response',
    });
  }
  const item = value as Partial<TokenPayload>;
  if (
    typeof item.access_token !== 'string' ||
    typeof item.bot_id !== 'string' ||
    typeof item.workspace_id !== 'string'
  ) {
    throw Object.assign(new Error('invalid_broker_response'), {
      code: 'invalid_broker_response',
    });
  }
  return {
    access_token: item.access_token,
    refresh_token:
      typeof item.refresh_token === 'string' ? item.refresh_token : null,
    bot_id: item.bot_id,
    workspace_id: item.workspace_id,
    workspace_name:
      typeof item.workspace_name === 'string' ? item.workspace_name : null,
  };
}

function authFromToken(token: TokenPayload): NotionAuth {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    botId: token.bot_id,
    workspaceId: token.workspace_id,
    workspaceName: token.workspace_name,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadNotionOAuthClientId(): Promise<string> {
  const payload = (await brokerFetch('GET')) as Partial<BrokerConfig>;
  if (typeof payload.clientId !== 'string' || payload.clientId.length < 8) {
    throw Object.assign(new Error('invalid_broker_response'), {
      code: 'invalid_broker_response',
    });
  }
  return payload.clientId;
}

export async function exchangeNotionCode(
  code: string,
  redirectUri: string,
): Promise<NotionAuth> {
  const payload = tokenPayload(
    await brokerFetch('POST', {
      action: 'exchange',
      code,
      redirectUri,
    }),
  );
  return authFromToken(payload);
}

export async function refreshNotionToken(
  refreshToken: string,
): Promise<NotionAuth> {
  const payload = tokenPayload(
    await brokerFetch('POST', {
      action: 'refresh',
      refreshToken,
    }),
  );
  return authFromToken(payload);
}

export async function revokeNotionToken(accessToken: string): Promise<void> {
  await brokerFetch('POST', { action: 'revoke', accessToken });
}
