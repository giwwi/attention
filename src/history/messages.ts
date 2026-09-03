import { isHistoryLookbackDays, type HistoryLookbackDays } from './evidence';

export const BROWSER_HISTORY_IMPORT_TYPE = 'attention:history-import' as const;

export interface BrowserHistoryImportRequest {
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
    isHistoryLookbackDays(item.lookbackDays)
  );
}
