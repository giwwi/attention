import { privateStorage } from '../vault/storage';
import {
  EMPTY_OBSIDIAN_SETTINGS,
  OBSIDIAN_SETTINGS_KEY,
  type ObsidianSettings,
} from './types';
import {
  measuredStorageGet,
  measuredStorageRemove,
  measuredStorageSet,
} from '../storage/measured-storage';

function isSettings(value: unknown): value is ObsidianSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<ObsidianSettings>;
  return (
    typeof settings.connected === 'boolean' &&
    (settings.vaultName === null || typeof settings.vaultName === 'string') &&
    (settings.lastIndexedAt === null ||
      typeof settings.lastIndexedAt === 'string') &&
    (settings.evidenceUpdatedAt === undefined ||
      settings.evidenceUpdatedAt === null ||
      typeof settings.evidenceUpdatedAt === 'string') &&
    typeof settings.noteCount === 'number' &&
    typeof settings.fragmentCount === 'number' &&
    typeof settings.skippedFileCount === 'number'
  );
}

export async function loadObsidianSettings(): Promise<ObsidianSettings> {
  const stored = await measuredStorageGet(
    privateStorage,
    'obsidian-settings',
    OBSIDIAN_SETTINGS_KEY,
  );
  const value = stored[OBSIDIAN_SETTINGS_KEY];
  return isSettings(value)
    ? {
        ...value,
        evidenceUpdatedAt: value.evidenceUpdatedAt ?? value.lastIndexedAt,
      }
    : { ...EMPTY_OBSIDIAN_SETTINGS };
}

export async function saveObsidianSettings(
  settings: ObsidianSettings,
): Promise<void> {
  await measuredStorageSet(privateStorage, 'obsidian-settings', {
    [OBSIDIAN_SETTINGS_KEY]: settings,
  });
}

export async function clearObsidianSettings(): Promise<void> {
  await measuredStorageRemove(
    privateStorage,
    'obsidian-settings',
    OBSIDIAN_SETTINGS_KEY,
  );
}
