import type { NotionSourceMode } from './types';

export const NOTION_CONFIG_TYPE = 'attention:notion-config' as const;
export const NOTION_CONNECT_TYPE = 'attention:notion-connect' as const;
export const NOTION_SYNC_TYPE = 'attention:notion-sync' as const;
export const NOTION_DISCONNECT_TYPE = 'attention:notion-disconnect' as const;

export interface NotionConfigRequest {
  type: typeof NOTION_CONFIG_TYPE;
}

export interface NotionConnectRequest {
  type: typeof NOTION_CONNECT_TYPE;
  code: string;
  redirectUri: string;
  sourceMode: NotionSourceMode;
}

export interface NotionSyncRequest {
  type: typeof NOTION_SYNC_TYPE;
  sourceMode: NotionSourceMode;
}

export interface NotionDisconnectRequest {
  type: typeof NOTION_DISCONNECT_TYPE;
}

export type NotionRequest =
  | NotionConfigRequest
  | NotionConnectRequest
  | NotionSyncRequest
  | NotionDisconnectRequest;

export interface NotionResponse {
  ok: boolean;
  clientId?: string;
  pageCount?: number;
  fragmentCount?: number;
  excludedPageCount?: number;
  workspaceName?: string | null;
  error?: string;
}

function sourceMode(value: unknown): value is NotionSourceMode {
  return (
    value === 'own-notes' || value === 'saved-materials' || value === 'mixed'
  );
}

export function isNotionRequest(value: unknown): value is NotionRequest {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (
    item.type === NOTION_CONFIG_TYPE ||
    item.type === NOTION_DISCONNECT_TYPE
  ) {
    return true;
  }
  if (item.type === NOTION_SYNC_TYPE) return sourceMode(item.sourceMode);
  return (
    item.type === NOTION_CONNECT_TYPE &&
    typeof item.code === 'string' &&
    item.code.length >= 8 &&
    item.code.length <= 1_024 &&
    typeof item.redirectUri === 'string' &&
    item.redirectUri.length <= 1_024 &&
    sourceMode(item.sourceMode)
  );
}
