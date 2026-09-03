export const READWISE_CONNECT_TYPE = 'attention:readwise-connect' as const;
export const READWISE_SYNC_TYPE = 'attention:readwise-sync' as const;

export interface ReadwiseConnectRequest {
  type: typeof READWISE_CONNECT_TYPE;
  token: string;
}

export interface ReadwiseSyncRequest {
  type: typeof READWISE_SYNC_TYPE;
}

export type ReadwiseRequest = ReadwiseConnectRequest | ReadwiseSyncRequest;

export interface ReadwiseSyncResponse {
  ok: boolean;
  sourceCount?: number;
  highlightCount?: number;
  noteCount?: number;
  excludedSourceCount?: number;
  error?: string;
}

export function isReadwiseRequest(value: unknown): value is ReadwiseRequest {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (item.type === READWISE_SYNC_TYPE) return true;
  return (
    item.type === READWISE_CONNECT_TYPE &&
    typeof item.token === 'string' &&
    item.token.length <= 512
  );
}
