import { loadNotionIndex } from './database';
import { loadNotionSettings } from './storage';
import type { NotionIndex } from './types';

export async function loadNotionEvidence(): Promise<NotionIndex | null> {
  const settings = await loadNotionSettings();
  if (
    !settings.connected ||
    !settings.workspaceName ||
    !settings.lastSyncedAt
  ) {
    return null;
  }
  return loadNotionIndex(
    settings.workspaceName,
    settings.evidenceUpdatedAt ?? settings.lastSyncedAt,
  );
}
