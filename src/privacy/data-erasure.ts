import { privateStorage, resetVault } from '../vault/storage';
import { clearObsidianDatabase } from '../obsidian/database';
import { clearNotionDatabase } from '../notion/database';
import { NOTION_AUTH_KEY } from '../notion/types';
import { revokeNotionToken } from '../notion/oauth';
import { DATA_GENERATION_KEY, withAttentionDataLock } from './data-operations';

async function clearAttentionDatabases(): Promise<void> {
  const cleared = await Promise.allSettled([
    clearObsidianDatabase(),
    clearNotionDatabase(),
  ]);
  const failed = cleared.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

export async function deleteAllAttentionData(
  localStorage: chrome.storage.StorageArea = privateStorage,
  sessionStorage: chrome.storage.StorageArea = chrome.storage.session,
  clearLocalDatabases: () => Promise<void> = clearAttentionDatabases,
): Promise<void> {
  if (localStorage === privateStorage) {
    // resetVault owns the outer data lock and clears encrypted, legacy and
    // session stores even when no password is available. Do not nest that lock.
    await resetVault();
    return;
  }
  const accessToken = await withAttentionDataLock(async () => {
    const stored = await localStorage.get(NOTION_AUTH_KEY);
    const auth = stored[NOTION_AUTH_KEY] as
      { accessToken?: unknown } | undefined;
    // Change the generation before clearing. If one store fails, old imports
    // must still be invalidated. Keep only this non-personal tombstone.
    const nextGeneration = crypto.randomUUID();
    await localStorage.set({ [DATA_GENERATION_KEY]: nextGeneration });
    const personalKeys = Object.keys(await localStorage.get(null)).filter(
      (key) => key !== DATA_GENERATION_KEY,
    );
    try {
      const cleared = await Promise.allSettled([
        localStorage.remove(personalKeys),
        sessionStorage.clear(),
        clearLocalDatabases(),
      ]);
      const failed = cleared.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    } finally {
      await localStorage.set({ [DATA_GENERATION_KEY]: nextGeneration });
    }
    return typeof auth?.accessToken === 'string' ? auth.accessToken : null;
  });
  // Remote revocation cannot delay local erasure or write diagnostic data back.
  if (accessToken) void revokeNotionToken(accessToken).catch(() => undefined);
}
