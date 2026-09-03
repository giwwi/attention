import {
  LEGACY_PROFILE_SCHEMA_VERSION,
  PROFILE_SCHEMA_VERSION,
  type PersonalProfile,
  type ProfileSource,
} from './schema';
import type { AttentionScenario, MaterialOutcome } from '../shared/types';
import { STORAGE_RETENTION_LIMITS } from '../storage/limits';

export const PERSONAL_PROFILE_KEY = 'personalProfile';
export const PROFILE_IMPORT_HISTORY_KEY = 'profileImportHistory';
export const PROFILE_ONBOARDING_KEY = 'profileOnboardingComplete';

export interface ProfileImportRecord {
  id: string;
  source: ProfileSource;
  importedAt: string;
  generatedAt: string | null;
  counts: {
    interests: number;
    goals: number;
    expertise: number;
    lowValueTopics: number;
    demonstratedKnowledge: number;
    learningAreas: number;
    uncertainties: number;
    leisurePreferences: number;
  };
}

interface StorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function storedProfile(value: unknown): PersonalProfile | null {
  if (!value || typeof value !== 'object') return null;
  const profile = value as Record<string, unknown>;
  const valid =
    (profile.schemaVersion === PROFILE_SCHEMA_VERSION ||
      profile.schemaVersion === LEGACY_PROFILE_SCHEMA_VERSION) &&
    typeof profile.updatedAt === 'string' &&
    Array.isArray(profile.interests) &&
    Array.isArray(profile.goals) &&
    Array.isArray(profile.expertise) &&
    Array.isArray(profile.lowValueTopics) &&
    (profile.contentPreferences === null ||
      typeof profile.contentPreferences === 'object');
  if (!valid) return null;
  const leisureValue =
    profile.leisureProfile && typeof profile.leisureProfile === 'object'
      ? (profile.leisureProfile as Record<string, unknown>)
      : null;
  return {
    ...(profile as unknown as PersonalProfile),
    schemaVersion: PROFILE_SCHEMA_VERSION,
    demonstratedKnowledge: Array.isArray(profile.demonstratedKnowledge)
      ? (profile.demonstratedKnowledge as PersonalProfile['demonstratedKnowledge'])
      : [],
    learningAreas: Array.isArray(profile.learningAreas)
      ? (profile.learningAreas as PersonalProfile['learningAreas'])
      : [],
    leisureProfile: {
      status:
        leisureValue?.status === 'available'
          ? 'available'
          : 'insufficient_data',
      preferences: Array.isArray(leisureValue?.preferences)
        ? (leisureValue.preferences as PersonalProfile['leisureProfile']['preferences'])
        : [],
      noveltyPreference:
        leisureValue?.noveltyPreference === 'familiar' ||
        leisureValue?.noveltyPreference === 'balanced' ||
        leisureValue?.noveltyPreference === 'novel'
          ? leisureValue.noveltyPreference
          : null,
      effortPreference:
        leisureValue?.effortPreference === 'low' ||
        leisureValue?.effortPreference === 'medium' ||
        leisureValue?.effortPreference === 'high'
          ? leisureValue.effortPreference
          : null,
      typicalSessionMinutes:
        typeof leisureValue?.typicalSessionMinutes === 'number'
          ? leisureValue.typicalSessionMinutes
          : null,
      confidence:
        typeof leisureValue?.confidence === 'number'
          ? leisureValue.confidence
          : 0,
    },
    uncertainties: Array.isArray(profile.uncertainties)
      ? (profile.uncertainties as PersonalProfile['uncertainties'])
      : [],
  };
}

function isImportRecord(value: unknown): value is ProfileImportRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    ['chatgpt', 'claude', 'other', 'manual', 'quick_ai'].includes(
      String(item.source),
    ) &&
    typeof item.importedAt === 'string' &&
    (typeof item.generatedAt === 'string' || item.generatedAt === null) &&
    typeof item.counts === 'object' &&
    item.counts !== null
  );
}

export async function loadProfile(
  storage: StorageArea = chrome.storage.local,
): Promise<PersonalProfile | null> {
  const stored = await storage.get(PERSONAL_PROFILE_KEY);
  const value = stored[PERSONAL_PROFILE_KEY];
  const profile = storedProfile(value);
  if (
    profile &&
    value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).schemaVersion !== PROFILE_SCHEMA_VERSION
  ) {
    await storage.set({ [PERSONAL_PROFILE_KEY]: profile });
  }
  return profile;
}

export async function saveProfile(
  profile: PersonalProfile,
  source: ProfileSource,
  importedProfile: PersonalProfile = profile,
  storage: StorageArea = chrome.storage.local,
): Promise<void> {
  const stored = await storage.get(PROFILE_IMPORT_HISTORY_KEY);
  const historyValue = stored[PROFILE_IMPORT_HISTORY_KEY];
  const history = Array.isArray(historyValue)
    ? historyValue.filter(isImportRecord)
    : [];
  const firstSource =
    profile.interests[0]?.sources[0] ??
    profile.goals[0]?.sources[0] ??
    profile.expertise[0]?.sources[0] ??
    profile.lowValueTopics[0]?.sources[0] ??
    profile.demonstratedKnowledge[0]?.sources[0] ??
    profile.learningAreas[0]?.sources[0] ??
    profile.uncertainties[0]?.sources[0] ??
    profile.leisureProfile.preferences[0]?.sources[0] ??
    profile.contentPreferences?.sources[0];
  const record: ProfileImportRecord = {
    id: crypto.randomUUID(),
    source,
    importedAt: profile.updatedAt,
    generatedAt: firstSource?.generatedAt ?? null,
    counts: {
      interests: importedProfile.interests.length,
      goals: importedProfile.goals.length,
      expertise: importedProfile.expertise.length,
      lowValueTopics: importedProfile.lowValueTopics.length,
      demonstratedKnowledge: importedProfile.demonstratedKnowledge.length,
      learningAreas: importedProfile.learningAreas.length,
      uncertainties: importedProfile.uncertainties.length,
      leisurePreferences: importedProfile.leisureProfile.preferences.length,
    },
  };
  await storage.set({
    [PERSONAL_PROFILE_KEY]: profile,
    [PROFILE_IMPORT_HISTORY_KEY]: [record, ...history].slice(
      0,
      STORAGE_RETENTION_LIMITS.profileImports,
    ),
    [PROFILE_ONBOARDING_KEY]: true,
  });
}

export async function updateProfile(
  profile: PersonalProfile,
  storage: StorageArea = chrome.storage.local,
): Promise<void> {
  await storage.set({ [PERSONAL_PROFILE_KEY]: profile });
}

/**
 * Passive feedback only adjusts evidence already present in the matching
 * scenario. It never creates a taste preference from a single click.
 */
export async function applyScenarioOutcomeToProfileSignals(
  scenario: AttentionScenario,
  signalIds: readonly string[],
  outcome: MaterialOutcome,
  storage: Pick<StorageArea, 'get' | 'set'> = chrome.storage.local,
  now = new Date(),
): Promise<void> {
  if (scenario !== 'relax' || outcome === 'partial') return;
  const leisureIds = new Set(
    signalIds
      .filter((id) => id.startsWith('leisurePreference:'))
      .map((id) => id.slice('leisurePreference:'.length)),
  );
  if (leisureIds.size === 0) return;

  const stored = await storage.get(PERSONAL_PROFILE_KEY);
  const profile = storedProfile(stored[PERSONAL_PROFILE_KEY]);
  if (!profile) return;
  let changed = false;
  for (const preference of profile.leisureProfile.preferences) {
    if (!leisureIds.has(preference.id)) continue;
    const delta = outcome === 'yes' ? 0.05 : -0.03;
    preference.confidence = Math.min(
      1,
      Math.max(0.05, Math.round((preference.confidence + delta) * 100) / 100),
    );
    changed = true;
  }
  if (!changed) return;
  profile.updatedAt = now.toISOString();
  profile.leisureProfile.status = 'available';
  profile.leisureProfile.confidence = Math.max(
    profile.leisureProfile.confidence,
    ...profile.leisureProfile.preferences.map((item) => item.confidence),
  );
  await storage.set({ [PERSONAL_PROFILE_KEY]: profile });
}

export async function completeProfileOnboarding(
  storage: StorageArea = chrome.storage.local,
): Promise<void> {
  await storage.set({ [PROFILE_ONBOARDING_KEY]: true });
}

export async function deleteProfile(
  storage: StorageArea = chrome.storage.local,
): Promise<void> {
  await storage.remove([PERSONAL_PROFILE_KEY, PROFILE_IMPORT_HISTORY_KEY]);
}
