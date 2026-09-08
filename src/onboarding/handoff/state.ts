import { privateStorage } from '../../vault/storage';
import type { ExternalProfileSource } from '../../profile/schema';

export const PROFILE_IMPORT_HANDOFF_KEY = 'profileImportHandoff';
export const PROFILE_IMPORT_HANDOFF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ProfileHandoffProviderId = ExternalProfileSource;
export type ProfileHandoffMethod = 'deep-link' | 'clipboard-and-web' | 'manual';

export interface ProfileHandoffState {
  /** Snapshot of the import generation, so reopening a popup cannot revive erased data. */
  generation?: string;
  vaultEpoch?: string;
  profileImportProvider: ProfileHandoffProviderId;
  profileImportStage: 'waiting-for-response';
  startedAt: string;
  method?: ProfileHandoffMethod;
  promptCopied?: boolean;
  providerOpened?: boolean;
}

interface StorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function isProfileHandoffState(value: unknown): value is ProfileHandoffState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return (
    ['chatgpt', 'claude', 'other'].includes(
      String(state.profileImportProvider),
    ) &&
    (state.generation === undefined || typeof state.generation === 'string') &&
    (state.vaultEpoch === undefined || typeof state.vaultEpoch === 'string') &&
    state.profileImportStage === 'waiting-for-response' &&
    typeof state.startedAt === 'string' &&
    Number.isFinite(Date.parse(state.startedAt)) &&
    (state.method === undefined ||
      ['deep-link', 'clipboard-and-web', 'manual'].includes(
        String(state.method),
      )) &&
    (state.promptCopied === undefined ||
      typeof state.promptCopied === 'boolean') &&
    (state.providerOpened === undefined ||
      typeof state.providerOpened === 'boolean')
  );
}

export function createProfileHandoffState(
  provider: ProfileHandoffProviderId,
  now = new Date(),
): ProfileHandoffState {
  return {
    profileImportProvider: provider,
    profileImportStage: 'waiting-for-response',
    startedAt: now.toISOString(),
  };
}

export async function saveProfileHandoffState(
  state: ProfileHandoffState,
  storage: StorageArea = privateStorage,
): Promise<void> {
  await storage.set({ [PROFILE_IMPORT_HANDOFF_KEY]: state });
}

export async function loadProfileHandoffState(
  storage: StorageArea = privateStorage,
  now = new Date(),
): Promise<ProfileHandoffState | null> {
  // A stale read must not remove a newer handoff created in another popup.
  // Explicit user actions clear this key under the shared data-operation lock.
  const stored = await storage.get(PROFILE_IMPORT_HANDOFF_KEY);
  const state = stored[PROFILE_IMPORT_HANDOFF_KEY];
  if (!isProfileHandoffState(state)) {
    return null;
  }
  const age = now.getTime() - Date.parse(state.startedAt);
  if (age < 0 || age > PROFILE_IMPORT_HANDOFF_MAX_AGE_MS) {
    return null;
  }
  return state;
}

export async function clearProfileHandoffState(
  storage: StorageArea = privateStorage,
): Promise<void> {
  await storage.remove(PROFILE_IMPORT_HANDOFF_KEY);
}
