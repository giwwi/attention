import { describe, expect, it } from 'vitest';
import { mergeProfiles, resolveMerge } from '../src/profile/merge';
import {
  normalizePortableProfile,
  removeProfileEntry,
} from '../src/profile/normalize';
import {
  createEmptyProfile,
  type PersonalProfile,
  type PortableProfile,
} from '../src/profile/schema';
import { PROFILE_PROVIDERS } from '../src/profile/providers';
import { validatePortableProfile } from '../src/profile/validator';

const validJson = JSON.stringify({
  schema_version: '1.0',
  generated_at: '2026-08-25T10:00:00Z',
  source: 'chatgpt',
  interests: [
    { topic: 'Large language models', strength: 0.95, confidence: 0.9 },
  ],
  goals: [
    {
      goal: 'Follow AI agent research',
      priority: 'high',
      status: 'active',
      confidence: 0.85,
    },
  ],
  expertise: [
    {
      topic: 'Economics',
      level: 'advanced',
      confidence: 0.9,
      basis: ['Repeated advanced discussions'],
    },
  ],
  demonstrated_knowledge: [
    {
      topic: 'Economics',
      statement: 'Can explain the difference between nominal and real rates',
      evidence_type: 'demonstrated',
      confidence: 0.88,
      basis: ['Applied the distinction in prior reasoning'],
    },
  ],
  learning_areas: [
    { topic: 'AI evaluation', focus: 'agent benchmarks', confidence: 0.8 },
  ],
  uncertainties: [
    {
      topic: 'Causal inference',
      note: 'Exact depth is not established',
      confidence: 0.7,
    },
  ],
  content_preferences: {
    preferred_depth: 'high',
    novelty_preference: 'high',
    avoid_repetition: true,
    preferred_formats: ['research paper'],
    confidence: 0.8,
  },
  low_value_topics: [
    { topic: 'Generic beginner AI tutorials', confidence: 0.75 },
  ],
});

function portable(overrides: Partial<PortableProfile> = {}): PortableProfile {
  return {
    schemaVersion: '2.0',
    generatedAt: null,
    interests: [],
    goals: [],
    expertise: [],
    contentPreferences: null,
    lowValueTopics: [],
    demonstratedKnowledge: [],
    learningAreas: [],
    leisureProfile: {
      status: 'insufficient_data',
      preferences: [],
      noveltyPreference: null,
      effortPreference: null,
      typicalSessionMinutes: null,
      confidence: 0,
    },
    uncertainties: [],
    ...overrides,
  };
}

function normalized(
  value: PortableProfile,
  source: 'chatgpt' | 'claude' = 'chatgpt',
): PersonalProfile {
  return normalizePortableProfile(
    value,
    source,
    new Date(
      source === 'chatgpt' ? '2026-08-25T10:00:00Z' : '2026-08-26T10:00:00Z',
    ),
  );
}

describe('portable profile validation', () => {
  it('accepts a valid profile', () => {
    const result = validatePortableProfile(validJson);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.expertise[0]?.level).toBe('advanced');
      expect(result.value.demonstratedKnowledge[0]?.evidenceType).toBe(
        'demonstrated',
      );
      expect(result.value.learningAreas[0]?.focus).toBe('agent benchmarks');
      expect(result.value.generatedAt).toBe('2026-08-25T10:00:00.000Z');
    }
  });

  it('accepts missing optional categories and fenced JSON', () => {
    const result = validatePortableProfile(`\`\`\`json
      {"schema_version":"1.0","interests":[{"topic":"AI","strength":0.8,"confidence":0.7}]}
    \`\`\``);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.goals).toEqual([]);
  });

  it('requires an explicit leisure section in profile v2', () => {
    const missing = validatePortableProfile(
      JSON.stringify({
        schema_version: '2.0',
        interests: [{ topic: 'AI', strength: 0.8, confidence: 0.7 }],
      }),
    );
    expect(missing.ok).toBe(false);

    const explicitUnknown = validatePortableProfile(
      JSON.stringify({
        schema_version: '2.0',
        interests: [{ topic: 'AI', strength: 0.8, confidence: 0.7 }],
        leisure_profile: {
          status: 'insufficient_data',
          preferences: [],
          novelty_preference: null,
          effort_preference: null,
          typical_session_minutes: null,
          confidence: 0,
        },
      }),
    );
    expect(explicitUnknown.ok).toBe(true);
  });

  it('asks every external AI provider for evidence-based leisure data', () => {
    for (const provider of Object.values(PROFILE_PROVIDERS)) {
      expect(provider.prompt).toContain('leisure_profile is mandatory');
      expect(provider.prompt).toContain(
        'Work interest does not imply leisure interest',
      );
      expect(provider.prompt).toContain(
        'make a separate evidence pass devoted only to leisure',
      );
      expect(provider.prompt).toContain(
        'Repeated voluntary selection, repeated engagement',
      );
      expect(provider.prompt).toContain(
        'Professional work involving books is not evidence',
      );
      expect(provider.prompt).toContain(
        'If at least one leisure preference has real evidence',
      );
      expect(provider.prompt).toContain('insufficient_data');
    }
  });

  it('rejects invalid confidence and expertise level', () => {
    const result = validatePortableProfile(
      JSON.stringify({
        schema_version: '1.0',
        expertise: [
          { topic: 'AI', level: 'omniscient', confidence: 1.4, basis: [] },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('expertise[0].level');
      expect(result.errors.join(' ')).toContain('expertise[0].confidence');
    }
  });

  it('rejects malformed JSON and an empty profile', () => {
    expect(validatePortableProfile('{bad json').ok).toBe(false);
    const empty = validatePortableProfile(
      JSON.stringify({ schema_version: '1.0' }),
    );
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors.join(' ')).toContain('Профиль пуст');
  });

  it('strips unexpected fields from the validated result', () => {
    const parsed = JSON.parse(validJson) as Record<string, unknown>;
    parsed.password = 'must-not-persist';
    parsed.interests = [
      {
        topic: 'AI',
        strength: 0.8,
        confidence: 0.7,
        private_notes: 'must-not-persist',
      },
    ];
    const result = validatePortableProfile(JSON.stringify(parsed));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const serialized = JSON.stringify(result.value);
      expect(serialized).not.toContain('password');
      expect(serialized).not.toContain('private_notes');
      expect(serialized).not.toContain('must-not-persist');
    }
  });

  it('renders imported HTML-like text as inert text', () => {
    const result = validatePortableProfile(
      JSON.stringify({
        schema_version: '1.0',
        interests: [
          {
            topic: '<img src=x onerror="globalThis.pwned=true">',
            strength: 0.8,
            confidence: 0.7,
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const target = document.createElement('div');
    target.textContent = result.value.interests[0]?.topic ?? '';
    expect(target.querySelector('img')).toBeNull();
    expect(target.textContent).toContain('<img');
  });
});

describe('profile normalization', () => {
  it('normalizes whitespace, duplicates, confidence, and source attribution', () => {
    const profile = normalized(
      portable({
        interests: [
          { topic: '  AI   Agents ', strength: 0.8, confidence: 0.754 },
          { topic: 'ai agents', strength: 0.9, confidence: 0.8 },
        ],
        goals: [
          {
            goal: ' Follow research ',
            priority: 'medium',
            status: 'active',
            confidence: 0.6,
          },
          {
            goal: 'follow research',
            priority: 'high',
            status: 'active',
            confidence: 0.9,
          },
        ],
      }),
    );
    expect(profile.interests).toHaveLength(1);
    expect(profile.interests[0]).toMatchObject({
      topic: 'AI Agents',
      strength: 0.9,
      confidence: 0.8,
    });
    expect(profile.goals).toHaveLength(1);
    expect(profile.goals[0]?.priority).toBe('high');
    expect(profile.interests[0]?.sources[0]?.source).toBe('chatgpt');
    expect(profile.interests[0]?.sources[0]?.importedAt).toBe(
      '2026-08-25T10:00:00.000Z',
    );
  });

  it('normalizes imported leisure taste without inventing missing data', () => {
    const profile = normalized(
      portable({
        leisureProfile: {
          status: 'available',
          preferences: [
            {
              kind: 'genre',
              category: ' Historical documentaries ',
              preference: 'high',
              confidence: 0.87,
              evidenceType: 'demonstrated',
              basis: 'Repeated voluntary viewing',
            },
          ],
          noveltyPreference: 'balanced',
          effortPreference: 'medium',
          typicalSessionMinutes: 40,
          confidence: 0.8,
        },
      }),
    );

    expect(profile.leisureProfile).toMatchObject({
      status: 'available',
      noveltyPreference: 'balanced',
      effortPreference: 'medium',
      typicalSessionMinutes: 40,
    });
    expect(profile.leisureProfile.preferences[0]).toMatchObject({
      category: 'Historical documentaries',
      preference: 'high',
      confidence: 0.87,
    });
    expect(normalized(portable()).leisureProfile.status).toBe(
      'insufficient_data',
    );
  });
});

describe('profile merge', () => {
  it('adds new entries and merges identical entries conservatively', () => {
    const existing = normalized(
      portable({
        interests: [{ topic: 'Economics', strength: 0.8, confidence: 0.7 }],
      }),
    );
    const incoming = normalized(
      portable({
        interests: [
          { topic: 'economics', strength: 0.85, confidence: 0.9 },
          { topic: 'AI agents', strength: 0.9, confidence: 0.8 },
        ],
      }),
      'claude',
    );
    const result = mergeProfiles(existing, incoming);
    expect(result.conflicts).toHaveLength(0);
    expect(result.merged.interests).toHaveLength(2);
    expect(result.merged.interests[0]?.confidence).toBe(0.9);
    expect(result.merged.interests[0]?.sources).toHaveLength(2);
  });

  it('merges leisure preferences as first-class profile data', () => {
    const existing = normalized(portable());
    const incoming = normalized(
      portable({
        leisureProfile: {
          status: 'available',
          preferences: [
            {
              kind: 'format',
              category: 'Short comedy videos',
              preference: 'high',
              confidence: 0.9,
              evidenceType: 'explicitly_stated',
              basis: 'User stated this directly',
            },
          ],
          noveltyPreference: 'familiar',
          effortPreference: 'low',
          typicalSessionMinutes: 15,
          confidence: 0.9,
        },
      }),
      'claude',
    );
    const merged = mergeProfiles(existing, incoming).merged;

    expect(merged.leisureProfile.status).toBe('available');
    expect(merged.leisureProfile.preferences[0]?.category).toBe(
      'Short comedy videos',
    );
    expect(merged.leisureProfile.effortPreference).toBe('low');
  });

  it('shows conflicting expertise and applies an explicit resolution', () => {
    const existing = normalized(
      portable({
        expertise: [
          {
            topic: 'Machine learning',
            level: 'advanced',
            confidence: 0.9,
            basis: [],
          },
        ],
      }),
    );
    const incoming = normalized(
      portable({
        expertise: [
          {
            topic: 'Machine learning',
            level: 'intermediate',
            confidence: 0.55,
            basis: [],
          },
        ],
      }),
      'claude',
    );
    const result = mergeProfiles(existing, incoming);
    expect(result.conflicts).toHaveLength(1);
    expect(result.merged.expertise[0]?.level).toBe('advanced');
    const resolved = resolveMerge(result, {
      [result.conflicts[0]?.id ?? '']: 'incoming',
    });
    expect(resolved.expertise[0]?.level).toBe('intermediate');
  });

  it('does not add an imported entry removed during review', () => {
    const incoming = normalized(
      portable({
        interests: [{ topic: 'Remove me', strength: 0.5, confidence: 0.5 }],
      }),
    );
    const reviewed = removeProfileEntry(
      incoming,
      'interests',
      incoming.interests[0]?.id ?? '',
    );
    const result = mergeProfiles(createEmptyProfile(), reviewed);
    expect(result.merged.interests).toEqual([]);
  });
});
