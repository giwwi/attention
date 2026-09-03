import {
  BROWSER_HISTORY_EVIDENCE_KEY,
  BROWSER_HISTORY_SETTINGS_KEY,
  isBrowserHistoryEvidence,
  type BrowserHistoryEvidence,
  type BrowserHistorySettings,
  type HistoryLookbackDays,
} from './evidence';

export async function loadBrowserHistoryEvidence(): Promise<BrowserHistoryEvidence | null> {
  const stored = await chrome.storage.local.get(BROWSER_HISTORY_EVIDENCE_KEY);
  const value: unknown = stored[BROWSER_HISTORY_EVIDENCE_KEY];
  return isBrowserHistoryEvidence(value) ? value : null;
}

export async function saveBrowserHistoryEvidence(
  evidence: BrowserHistoryEvidence,
  lookbackDays: HistoryLookbackDays,
  permissionRetained = false,
): Promise<void> {
  const settings: BrowserHistorySettings = {
    lookbackDays,
    lastProcessedAt: evidence.generatedAt,
    processedUrlCount: evidence.processedUrlCount,
    totalVisitCount: evidence.totalVisitCount,
    excludedUrlCount: evidence.excludedUrlCount,
    permissionRetained,
  };
  await chrome.storage.local.set({
    [BROWSER_HISTORY_EVIDENCE_KEY]: evidence,
    [BROWSER_HISTORY_SETTINGS_KEY]: settings,
  });
}

export async function loadBrowserHistorySettings(): Promise<BrowserHistorySettings | null> {
  const stored = await chrome.storage.local.get(BROWSER_HISTORY_SETTINGS_KEY);
  const value: unknown = stored[BROWSER_HISTORY_SETTINGS_KEY];
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<BrowserHistorySettings>;
  if (
    ![7, 30, 90].includes(Number(item.lookbackDays)) ||
    typeof item.processedUrlCount !== 'number' ||
    typeof item.totalVisitCount !== 'number' ||
    typeof item.excludedUrlCount !== 'number' ||
    typeof item.permissionRetained !== 'boolean'
  ) {
    return null;
  }
  return item as BrowserHistorySettings;
}

export async function clearBrowserHistoryEvidence(): Promise<void> {
  await chrome.storage.local.remove([
    BROWSER_HISTORY_EVIDENCE_KEY,
    BROWSER_HISTORY_SETTINGS_KEY,
  ]);
}
