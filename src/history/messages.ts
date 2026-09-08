import { isHistoryLookbackDays, type HistoryLookbackDays } from './evidence';

export const BROWSER_HISTORY_IMPORT_TYPE = 'attention:history-import' as const;

export interface BrowserHistoryImportRequest {
  generation?: string;
  vaultEpoch?: string;
  syncRevision?: string;
  type: typeof BROWSER_HISTORY_IMPORT_TYPE;
  lookbackDays: HistoryLookbackDays;
}

export interface BrowserHistoryImportResponse {
  ok: boolean;
  processedUrlCount?: number;
  totalVisitCount?: number;
  excludedUrlCount?: number;
  permissionRevoked?: boolean;
  error?: string;
}

export function isBrowserHistoryImportRequest(
  value: unknown,
): value is BrowserHistoryImportRequest {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    item.type === BROWSER_HISTORY_IMPORT_TYPE &&
    (item.generation === undefined ||
      (typeof item.generation === 'string' && item.generation.length <= 100)) &&
    (item.vaultEpoch === undefined ||
      (typeof item.vaultEpoch === 'string' && item.vaultEpoch.length <= 100)) &&
    (item.syncRevision === undefined ||
      (typeof item.syncRevision === 'string' &&
        item.syncRevision.length <= 100 &&
        typeof item.generation === 'string')) &&
    isHistoryLookbackDays(item.lookbackDays)
  );
}
