import type {
  MaterialDecision,
  PersonalizationSignal,
  ProfileFeedbackType,
} from '../shared/types';
import type { PersonalProfile, SourceAttribution } from './schema';
import { updateProfile } from './storage';
import { STORAGE_RETENTION_LIMITS } from '../storage/limits';

export const PROFILE_FEEDBACK_KEY = 'profileEvaluationFeedback';

export interface ProfileFeedbackRecord {
  id: string;
  type: ProfileFeedbackType;
  url: string;
  recommendedAction: MaterialDecision;
  signalId: string | null;
  profileEntryId: string | null;
  createdAt: string;
}

function manualAttribution(now: Date): SourceAttribution {
  return {
    source: 'manual',
    importedAt: now.toISOString(),
    generatedAt: null,
  };
}

function appendManualSource(
  sources: SourceAttribution[],
  now: Date,
): SourceAttribution[] {
  return [...sources, manualAttribution(now)];
}

export function applySignalFeedback(
  profile: PersonalProfile,
  signal: PersonalizationSignal,
  type: Extract<ProfileFeedbackType, 'affirmSignal' | 'ignoreSignal'>,
  now = new Date(),
): PersonalProfile {
  const next = structuredClone(profile);
  next.updatedAt = now.toISOString();
  if (signal.kind === 'historyTopic' || signal.kind === 'historySource') {
    return next;
  }
  if (signal.kind === 'contentPreference') {
    if (type === 'ignoreSignal') next.contentPreferences = null;
    else if (next.contentPreferences) {
      next.contentPreferences.confidence = 1;
      next.contentPreferences.sources = appendManualSource(
        next.contentPreferences.sources,
        now,
      );
    }
    return next;
  }

  if (signal.kind === 'learningArea') {
    const index = next.learningAreas.findIndex(
      (item) => item.id === signal.profileEntryId,
    );
    if (index < 0) return next;
    if (type === 'ignoreSignal') next.learningAreas.splice(index, 1);
    else {
      const item = next.learningAreas[index];
      if (item) {
        item.confidence = 1;
        item.sources = appendManualSource(item.sources, now);
      }
    }
    return next;
  }

  if (signal.kind === 'leisurePreference') {
    const index = next.leisureProfile.preferences.findIndex(
      (item) => item.id === signal.profileEntryId,
    );
    if (index < 0) return next;
    if (type === 'ignoreSignal') {
      next.leisureProfile.preferences.splice(index, 1);
      if (next.leisureProfile.preferences.length === 0) {
        next.leisureProfile.status = 'insufficient_data';
        next.leisureProfile.confidence = 0;
      }
    } else {
      const item = next.leisureProfile.preferences[index];
      if (item) {
        item.confidence = 1;
        item.sources = appendManualSource(item.sources, now);
        next.leisureProfile.status = 'available';
        next.leisureProfile.confidence = Math.max(
          next.leisureProfile.confidence,
          1,
        );
      }
    }
    return next;
  }

  const collection =
    signal.kind === 'interest'
      ? next.interests
      : signal.kind === 'goal'
        ? next.goals
        : signal.kind === 'expertise'
          ? next.expertise
          : next.lowValueTopics;
  const index = collection.findIndex(
    (item) => item.id === signal.profileEntryId,
  );
  if (index < 0) return next;
  if (type === 'ignoreSignal') {
    collection.splice(index, 1);
    return next;
  }
  const item = collection[index];
  if (item) {
    item.confidence = 1;
    item.sources = appendManualSource(item.sources, now);
  }
  return next;
}

function isFeedbackRecord(value: unknown): value is ProfileFeedbackRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    ['affirmSignal', 'ignoreSignal', 'wrongRecommendation'].includes(
      String(item.type),
    ) &&
    typeof item.url === 'string' &&
    ['read', 'skim', 'save', 'skip'].includes(String(item.recommendedAction)) &&
    (typeof item.signalId === 'string' || item.signalId === null) &&
    (typeof item.profileEntryId === 'string' || item.profileEntryId === null) &&
    typeof item.createdAt === 'string'
  );
}

export async function recordProfileFeedback(
  record: Omit<ProfileFeedbackRecord, 'id' | 'createdAt'>,
): Promise<void> {
  const stored = await chrome.storage.local.get(PROFILE_FEEDBACK_KEY);
  const value: unknown = stored[PROFILE_FEEDBACK_KEY];
  const records = Array.isArray(value) ? value.filter(isFeedbackRecord) : [];
  const next: ProfileFeedbackRecord = {
    ...record,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({
    [PROFILE_FEEDBACK_KEY]: [next, ...records].slice(
      0,
      STORAGE_RETENTION_LIMITS.profileFeedback,
    ),
  });
}

export async function applyAndStoreSignalFeedback(
  profile: PersonalProfile,
  signal: PersonalizationSignal,
  type: Extract<ProfileFeedbackType, 'affirmSignal' | 'ignoreSignal'>,
): Promise<PersonalProfile> {
  const next = applySignalFeedback(profile, signal, type);
  await updateProfile(next);
  return next;
}
