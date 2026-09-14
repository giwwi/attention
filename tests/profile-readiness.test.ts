import { describe, expect, it } from 'vitest';
import { createEmptyProfile } from '../src/profile/schema';
import { isProfileReady } from '../src/profile/readiness';
import {
  nextProfileQuestion,
  addProfileAnswer,
} from '../src/onboarding/profile-basics';
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
describe('first profile guided setup', () => {
  it('asks for actual purpose, interests and experience in sequence', () => {
    const profile = createEmptyProfile();
    expect(nextProfileQuestion(profile)).toBe('goal');
    addProfileAnswer(profile, 'goal', 'Choose testing tools for my team');
    expect(nextProfileQuestion(profile)).toBe('interests');
    addProfileAnswer(
      profile,
      'interests',
      'AI evaluation\nSoftware quality\nAI evaluation',
    );
    expect(profile.interests).toHaveLength(2);
    expect(nextProfileQuestion(profile)).toBe('knowledge');
    addProfileAnswer(profile, 'knowledge', 'I can design pairwise tests', {
      topic: 'AI evaluation',
    });
    expect(nextProfileQuestion(profile)).toBeNull();
    expect(profile.demonstratedKnowledge[0]?.evidenceType).toBe(
      'explicitly_stated',
    );
    expect(profile.expertise).toHaveLength(0);
  });
  it('records beginner topics as learning, without pretending they are knowledge', () => {
    const profile = createEmptyProfile();
    addProfileAnswer(profile, 'goal', 'Read about gardening for enjoyment');
    addProfileAnswer(profile, 'interests', 'Growing herbs');
    addProfileAnswer(profile, 'knowledge', '', { beginner: true });
    expect(profile.learningAreas[0]?.topic).toBe('Growing herbs');
    expect(profile.demonstratedKnowledge).toEqual([]);
    expect(profile.expertise).toEqual([]);
    expect(nextProfileQuestion(profile)).toBeNull();
  });
  it('does not revoke readiness from existing sparse profiles', () => {
    const profile = createEmptyProfile();
    addProfileAnswer(profile, 'interests', 'History');
    expect(isProfileReady(profile)).toBe(true);
    expect(nextProfileQuestion(profile)).toBe('goal');
  });
  it('does not count completed goals or dislikes as positive reading context', () => {
    const profile = createEmptyProfile();
    addProfileAnswer(profile, 'goal', 'Past project');
    profile.goals[0]!.status = 'completed';
    expect(nextProfileQuestion(profile)).toBe('goal');
    profile.goals[0]!.status = 'active';
    profile.leisureProfile.preferences.push({
      id: 'dislike',
      kind: 'dislike',
      category: 'Sports',
      preference: 'low',
      confidence: 1,
      evidenceType: 'explicitly_stated',
      basis: '',
      sources: [],
    });
    expect(nextProfileQuestion(profile)).toBe('interests');
  });
});
