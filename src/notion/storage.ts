import {
  EMPTY_NOTION_SETTINGS,
  NOTION_AUTH_KEY,
  NOTION_SETTINGS_KEY,
  type NotionAuth,
  type NotionSettings,
  type NotionSourceMode,
} from './types';
import {
  measuredStorageGet,
  measuredStorageRemove,
  measuredStorageSet,
} from '../storage/measured-storage';

function isSourceMode(value: unknown): value is NotionSourceMode {
  return (
    value === 'own-notes' || value === 'saved-materials' || value === 'mixed'
  );
}

function isSettings(value: unknown): value is NotionSettings {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<NotionSettings>;
  return (
    typeof item.connected === 'boolean' &&
    (item.workspaceName === null || typeof item.workspaceName === 'string') &&
    (item.workspaceId === null || typeof item.workspaceId === 'string') &&
    isSourceMode(item.sourceMode) &&
    (item.lastSyncedAt === null || typeof item.lastSyncedAt === 'string') &&
    (item.evidenceUpdatedAt === undefined ||
      item.evidenceUpdatedAt === null ||
      typeof item.evidenceUpdatedAt === 'string') &&
    typeof item.pageCount === 'number' &&
    typeof item.fragmentCount === 'number' &&
    typeof item.excludedPageCount === 'number'
  );
}

function isAuth(value: unknown): value is NotionAuth {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<NotionAuth>;
  return (
    typeof item.accessToken === 'string' &&
    item.accessToken.length > 20 &&
    (item.refreshToken === null || typeof item.refreshToken === 'string') &&
    typeof item.botId === 'string' &&
    typeof item.workspaceId === 'string' &&
    (item.workspaceName === null || typeof item.workspaceName === 'string') &&
    typeof item.updatedAt === 'string'
  );
}

export async function loadNotionSettings(): Promise<NotionSettings> {
  const stored = await measuredStorageGet(
    chrome.storage.local,
    'notion-settings',
    NOTION_SETTINGS_KEY,
  );
  const value = stored[NOTION_SETTINGS_KEY];
  return isSettings(value)
    ? {
        ...value,
        evidenceUpdatedAt: value.evidenceUpdatedAt ?? value.lastSyncedAt,
      }
    : { ...EMPTY_NOTION_SETTINGS };
}

export async function loadNotionAuth(): Promise<NotionAuth | null> {
  const stored = await measuredStorageGet(
    chrome.storage.local,
    'notion-auth',
    NOTION_AUTH_KEY,
  );
  const value = stored[NOTION_AUTH_KEY];
  return isAuth(value) ? value : null;
}

export async function saveNotionConnection(
  auth: NotionAuth,
  settings: NotionSettings,
): Promise<void> {
  await measuredStorageSet(chrome.storage.local, 'notion-connection', {
    [NOTION_AUTH_KEY]: auth,
    [NOTION_SETTINGS_KEY]: settings,
  });
}

export async function saveNotionSettings(
  settings: NotionSettings,
): Promise<void> {
  await measuredStorageSet(chrome.storage.local, 'notion-settings', {
    [NOTION_SETTINGS_KEY]: settings,
  });
}

export async function saveNotionAuth(auth: NotionAuth): Promise<void> {
  await measuredStorageSet(chrome.storage.local, 'notion-auth', {
    [NOTION_AUTH_KEY]: auth,
  });
}

export async function clearNotionConnection(): Promise<void> {
  await measuredStorageRemove(chrome.storage.local, 'notion-connection', [
    NOTION_AUTH_KEY,
    NOTION_SETTINGS_KEY,
  ]);
}
