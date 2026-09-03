import { clearObsidianDatabase } from '../obsidian/database';
import { clearNotionDatabase } from '../notion/database';

async function clearAttentionDatabases(): Promise<void> {
  await Promise.all([clearObsidianDatabase(), clearNotionDatabase()]);
}

export async function deleteAllAttentionData(
  localStorage: chrome.storage.StorageArea = chrome.storage.local,
  sessionStorage: chrome.storage.StorageArea = chrome.storage.session,
  clearLocalDatabases: () => Promise<void> = clearAttentionDatabases,
): Promise<void> {
  await Promise.all([
    localStorage.clear(),
    sessionStorage.clear(),
    clearLocalDatabases(),
  ]);
}
