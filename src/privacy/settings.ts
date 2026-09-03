export const PRIVACY_SETTINGS_KEY = 'privacySettings';

export interface PrivacySettings {
  /** When enabled, no Attention feature may start a network AI request. */
  localOnly: boolean;
  updatedAt: string;
}

export const DEFAULT_PRIVACY_SETTINGS: Readonly<PrivacySettings> = {
  localOnly: true,
  updatedAt: '',
};

export class LocalOnlyModeError extends Error {
  constructor() {
    super('Включён режим «Только локально». Облачные AI-запросы запрещены.');
    this.name = 'LocalOnlyModeError';
  }
}

function isPrivacySettings(value: unknown): value is PrivacySettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Record<string, unknown>;
  return (
    typeof settings.localOnly === 'boolean' &&
    typeof settings.updatedAt === 'string'
  );
}

function extensionLocalStorage(): chrome.storage.StorageArea | null {
  const runtime = globalThis as typeof globalThis & {
    chrome?: Partial<typeof chrome>;
  };
  return runtime.chrome?.storage?.local ?? null;
}

export async function loadPrivacySettings(
  storage: chrome.storage.StorageArea = chrome.storage.local,
): Promise<PrivacySettings> {
  const stored = await storage.get(PRIVACY_SETTINGS_KEY);
  const value: unknown = stored[PRIVACY_SETTINGS_KEY];
  return isPrivacySettings(value) ? value : { ...DEFAULT_PRIVACY_SETTINGS };
}

export async function saveLocalOnlyMode(
  localOnly: boolean,
  storage: chrome.storage.StorageArea = chrome.storage.local,
  now = new Date(),
): Promise<PrivacySettings> {
  const settings: PrivacySettings = {
    localOnly,
    updatedAt: now.toISOString(),
  };
  await storage.set({ [PRIVACY_SETTINGS_KEY]: settings });
  return settings;
}

/**
 * Central network boundary used by every direct browser-side AI client.
 * Server runtimes have no chrome.storage and are validated separately.
 */
export async function assertExtensionCloudAiAllowed(): Promise<void> {
  const storage = extensionLocalStorage();
  if (!storage) return;
  const settings = await loadPrivacySettings(storage);
  if (settings.localOnly) throw new LocalOnlyModeError();
}
