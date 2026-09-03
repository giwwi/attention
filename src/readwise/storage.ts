import {
  READWISE_EVIDENCE_KEY,
  READWISE_SETTINGS_KEY,
  READWISE_TOKEN_KEY,
  ensureReadwiseSearchIndex,
  isReadwiseEvidence,
  type ReadwiseEvidence,
  type ReadwiseSettings,
} from './evidence';
import {
  measuredStorageGet,
  measuredStorageRemove,
  measuredStorageSet,
} from '../storage/measured-storage';

interface StoredReadwiseToken {
  token: string;
  updatedAt: string;
}

function isSettings(value: unknown): value is ReadwiseSettings {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ReadwiseSettings>;
  return (
    typeof item.connected === 'boolean' &&
    (item.lastSyncedAt === null || typeof item.lastSyncedAt === 'string') &&
    (item.evidenceUpdatedAt === undefined ||
      item.evidenceUpdatedAt === null ||
      typeof item.evidenceUpdatedAt === 'string') &&
    typeof item.sourceCount === 'number' &&
    typeof item.highlightCount === 'number' &&
    typeof item.noteCount === 'number' &&
    typeof item.excludedSourceCount === 'number'
  );
}

export async function loadReadwiseEvidence(): Promise<ReadwiseEvidence | null> {
  const stored = await measuredStorageGet(
    chrome.storage.local,
    'readwise-evidence',
    READWISE_EVIDENCE_KEY,
  );
  const value: unknown = stored[READWISE_EVIDENCE_KEY];
  if (!isReadwiseEvidence(value)) return null;
  const indexed = ensureReadwiseSearchIndex(value);
  if (indexed !== value) {
    await measuredStorageSet(chrome.storage.local, 'readwise-index-migration', {
      [READWISE_EVIDENCE_KEY]: indexed,
    });
  }
  return indexed;
}

export async function loadReadwiseSettings(): Promise<ReadwiseSettings> {
  const stored = await measuredStorageGet(
    chrome.storage.local,
    'readwise-settings',
    READWISE_SETTINGS_KEY,
  );
  const value: unknown = stored[READWISE_SETTINGS_KEY];
  return isSettings(value)
    ? {
        ...value,
        evidenceUpdatedAt: value.evidenceUpdatedAt ?? value.lastSyncedAt,
      }
    : {
        connected: false,
        lastSyncedAt: null,
        evidenceUpdatedAt: null,
        sourceCount: 0,
        highlightCount: 0,
        noteCount: 0,
        excludedSourceCount: 0,
      };
}

export async function loadReadwiseToken(): Promise<string | null> {
  const stored = await measuredStorageGet(
    chrome.storage.local,
    'readwise-token',
    READWISE_TOKEN_KEY,
  );
  const value = stored[READWISE_TOKEN_KEY];
  if (!value || typeof value !== 'object') return null;
  const token = (value as Partial<StoredReadwiseToken>).token;
  return typeof token === 'string' && token.length >= 10 ? token : null;
}

export async function saveReadwiseConnection(
  token: string,
  evidence: ReadwiseEvidence,
  syncedAt = evidence.generatedAt,
): Promise<void> {
  const settings: ReadwiseSettings = {
    connected: true,
    lastSyncedAt: syncedAt,
    evidenceUpdatedAt: evidence.generatedAt,
    sourceCount: evidence.sourceCount,
    highlightCount: evidence.highlightCount,
    noteCount: evidence.noteCount,
    excludedSourceCount: evidence.excludedSourceCount,
  };
  await measuredStorageSet(chrome.storage.local, 'readwise', {
    [READWISE_TOKEN_KEY]: {
      token,
      updatedAt: new Date().toISOString(),
    } satisfies StoredReadwiseToken,
    [READWISE_EVIDENCE_KEY]: evidence,
    [READWISE_SETTINGS_KEY]: settings,
  });
}

export async function saveReadwiseEvidence(
  evidence: ReadwiseEvidence,
  syncedAt = new Date().toISOString(),
): Promise<void> {
  const settings: ReadwiseSettings = {
    connected: true,
    lastSyncedAt: syncedAt,
    evidenceUpdatedAt: evidence.generatedAt,
    sourceCount: evidence.sourceCount,
    highlightCount: evidence.highlightCount,
    noteCount: evidence.noteCount,
    excludedSourceCount: evidence.excludedSourceCount,
  };
  await measuredStorageSet(chrome.storage.local, 'readwise', {
    [READWISE_EVIDENCE_KEY]: evidence,
    [READWISE_SETTINGS_KEY]: settings,
  });
}

export async function clearReadwiseConnection(): Promise<void> {
  await measuredStorageRemove(chrome.storage.local, 'readwise', [
    READWISE_TOKEN_KEY,
    READWISE_EVIDENCE_KEY,
    READWISE_SETTINGS_KEY,
  ]);
}
