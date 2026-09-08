import { describe, expect, it } from 'vitest';
import { createEmptyProfile } from '../src/profile/schema';
import { isProfileReady } from '../src/profile/readiness';
import { loadProfile } from '../src/profile/storage';
import { DataTestStorage } from './helpers/data-locks';

describe('profile activation', () => {
  it('rejects a skipped setup, malformed storage and an empty import', async () => {
    const storage = new DataTestStorage();
    for (const personalProfile of [
      undefined,
      {},
      { schemaVersion: '2.0' },
      createEmptyProfile(),
    ]) {
      storage.data = { profileOnboardingComplete: true, personalProfile };
      expect(isProfileReady(await loadProfile(storage.area))).toBe(false);
    }
  });

  it('does not treat format settings or unanswered questions as personal context', () => {
    const profile = createEmptyProfile();
    profile.contentPreferences = {
      preferredDepth: 'high',
      noveltyPreference: 'high',
      avoidRepetition: true,
      preferredFormats: [],
      confidence: 1,
      sources: [],
    };
    profile.uncertainties = [
      {
        id: 'unknown',
        topic: 'Interests',
        note: 'Unknown',
        confidence: 1,
        sources: [],
      },
    ];
    expect(isProfileReady(profile)).toBe(false);
    profile.interests = [
      { id: 'empty', topic: '  ', strength: 1, confidence: 1, sources: [] },
    ];
    expect(isProfileReady(profile)).toBe(false);
  });

  it('uses saved context rather than requiring one provider or an old completion flag', async () => {
    const profile = createEmptyProfile();
    profile.goals = [
      {
        id: 'goal',
        goal: 'Understand software quality',
        priority: 'high',
        status: 'active',
        confidence: 1,
        sources: [],
      },
    ];
    const storage = new DataTestStorage();
    storage.data = { personalProfile: profile };
    expect(isProfileReady(await loadProfile(storage.area))).toBe(true);
    await storage.remove('personalProfile');
    expect(isProfileReady(await loadProfile(storage.area))).toBe(false);
  });
});
