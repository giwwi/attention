import { loadObsidianIndex } from './database';
import { loadObsidianSettings } from './storage';
import type { ObsidianIndex } from './types';

export async function loadObsidianEvidence(): Promise<ObsidianIndex | null> {
  const settings = await loadObsidianSettings();
  if (!settings.connected || !settings.vaultName || !settings.lastIndexedAt) {
    return null;
  }
  return loadObsidianIndex(
    settings.vaultName,
    settings.evidenceUpdatedAt ?? settings.lastIndexedAt,
  );
}
