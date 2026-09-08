import { NOTION_OAUTH_BROKER_URL, notionOAuthConfigured } from './config';
import type { NotionAuth } from './types';
import { DataOperationCancelledError } from '../privacy/data-operations';

const BROKER_ERROR_CODES = new Set([
  'oauth_not_configured',
  'forbidden',
  'method_not_allowed',
  'invalid_json',
  'invalid_request',
  'notion_oauth_failed',
  'notion_revoke_failed',
  'invalid_notion_response',
  'invalid_client',
  'invalid_grant',
  'invalid_scope',
  'unauthorized_client',
  'unsupported_grant_type',
  'access_denied',
  'temporarily_unavailable',
]);

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

function brokerError(body: unknown): Error {
  const remote =
    body && typeof body === 'object' && 'error' in body
      ? (body as { error: unknown }).error
      : undefined;
  const candidate = typeof remote === 'string' ? remote.toLowerCase() : '';
  // Remote error strings can contain credentials or workspace content. Only
  // fixed codes may reach diagnostics or extension responses.
  const code = BROKER_ERROR_CODES.has(candidate)
    ? candidate
    : 'broker_request_failed';
  return Object.assign(new Error(code), { code });
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DataOperationCancelledError();
}

async function brokerFetch(
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  assertNotAborted(signal);
  if (!notionOAuthConfigured()) {
    throw Object.assign(new Error('oauth_not_configured'), {
      code: 'oauth_not_configured',
    });
  }
  const response = await fetch(NOTION_OAUTH_BROKER_URL, {
    method,
    signal,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  assertNotAborted(signal);
  const payload: unknown = await response.json().catch(() => null);
  assertNotAborted(signal);
  if (!response.ok) throw brokerError(payload);
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

export async function loadNotionOAuthClientId(
  signal?: AbortSignal,
): Promise<string> {
  const payload = (await brokerFetch(
    'GET',
    undefined,
    signal,
  )) as Partial<BrokerConfig> | null;
  if (
    !payload ||
    typeof payload.clientId !== 'string' ||
    payload.clientId.length < 8
  ) {
    throw Object.assign(new Error('invalid_broker_response'), {
      code: 'invalid_broker_response',
    });
  }
  return payload.clientId;
}

export async function exchangeNotionCode(
  code: string,
  redirectUri: string,
  signal?: AbortSignal,
): Promise<NotionAuth> {
  const payload = tokenPayload(
    await brokerFetch(
      'POST',
      {
        action: 'exchange',
        code,
        redirectUri,
      },
      signal,
    ),
  );
  return authFromToken(payload);
}

export async function refreshNotionToken(
  refreshToken: string,
  signal?: AbortSignal,
): Promise<NotionAuth> {
  const payload = tokenPayload(
    await brokerFetch(
      'POST',
      {
        action: 'refresh',
        refreshToken,
      },
      signal,
    ),
  );
  return authFromToken(payload);
}

export async function revokeNotionToken(
  accessToken: string,
  signal?: AbortSignal,
): Promise<void> {
  await brokerFetch('POST', { action: 'revoke', accessToken }, signal);
}
