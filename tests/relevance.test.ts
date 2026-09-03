import { describe, expect, it } from 'vitest';
import { applySignalFeedback } from '../src/profile/feedback';
import { normalizePortableProfile } from '../src/profile/normalize';
import { selectRelevantProfileContext } from '../src/profile/relevance';
import type { PortableProfile } from '../src/profile/schema';
import type { PageCapture, PersonalizationSignal } from '../src/shared/types';

function material(overrides: Partial<PageCapture> = {}): PageCapture {
  return {
    title: 'Новые исследования архитектуры AI-агентов',
    url: 'https://example.com/agents',
    content:
      'Исследователи сравнивают архитектуры AI-агентов и способы их оценки. '.repeat(
        100,
      ),
    excerpt: 'Подробный обзор новых исследований автономных агентов.',
    byline: null,
    siteName: 'Example',
    publishedTime: null,
    language: 'ru',
    wordCount: 900,
    readingTimeMinutes: 5,
    headings: ['Архитектура агентов', 'Результаты исследований'],
    isArticle: true,
    extractionMethod: 'readability',
    capturedAt: '2026-08-25T10:00:00.000Z',
    ...overrides,
  };
}

function profile(value: Partial<PortableProfile>) {
  return normalizePortableProfile(
    {
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
      ...value,
    },
    'chatgpt',
    new Date('2026-08-25T10:00:00Z'),
  );
}

describe('relevant profile selection', () => {
  it('selects matching active goals and interests but excludes unrelated data', () => {
    const personalProfile = profile({
      interests: [
        { topic: 'AI-агенты', strength: 0.95, confidence: 0.9 },
        { topic: 'Средневековая история', strength: 0.8, confidence: 0.8 },
      ],
      goals: [
        {
          goal: 'Следить за исследованиями AI-агентов',
          priority: 'high',
          status: 'active',
          confidence: 0.9,
        },
        {
          goal: 'Изучить архитектуру агентов',
          priority: 'high',
          status: 'completed',
          confidence: 0.9,
        },
      ],
      expertise: [
        { topic: 'Экономика', level: 'advanced', confidence: 0.9, basis: [] },
      ],
    });

    const context = selectRelevantProfileContext(personalProfile, material(), {
      intent: '',
      availableMinutes: 15,
      scenario: 'work',
    });

    expect(context?.signals.map((signal) => signal.kind)).toEqual([
      'goal',
      'interest',
    ]);
    expect(context?.signals.map((signal) => signal.label)).not.toContain(
      'Средневековая история',
    );
    expect(context?.signals.map((signal) => signal.label)).not.toContain(
      'Изучить архитектуру агентов',
    );
  });

  it('marks introductory content as possible repetition for broad expertise', () => {
    const personalProfile = profile({
      expertise: [
        {
          topic: 'Экономика',
          level: 'advanced',
          confidence: 0.9,
          basis: [],
        },
      ],
    });
    const context = selectRelevantProfileContext(
      personalProfile,
      material({
        title: 'Экономика для начинающих: основы простыми словами',
        excerpt: 'Вводное объяснение основных экономических понятий.',
      }),
      { intent: '', availableMinutes: 15, scenario: 'work' },
    );

    expect(context?.signals[0]).toMatchObject({
      kind: 'expertise',
      effect: 'negative',
    });
    expect(context?.signals[0]?.explanation).toContain('повторением знакомого');
  });

  it('detects a CEFR level mismatch across German and Deutsch labels', () => {
    const personalProfile = profile({
      expertise: [
        {
          topic: 'German professional communication',
          level: 'intermediate',
          confidence: 0.98,
          basis: ['Completed B2 professional German'],
        },
      ],
    });
    const context = selectRelevantProfileContext(
      personalProfile,
      material({
        title: 'Deutsch lernen mit Übungen (A2/B1)',
        excerpt: 'Grammatik und Wortschatz für Niveau A2 bis B1.',
        language: 'de',
      }),
      { intent: '', availableMinutes: 15, scenario: 'learn' },
    );

    expect(context?.signals[0]).toMatchObject({
      kind: 'expertise',
      effect: 'negative',
    });
    expect(context?.signals[0]?.explanation).toContain('B1');
    expect(context?.signals[0]?.explanation).toContain('B2');
  });

  it('includes global content preferences without exposing the whole profile', () => {
    const personalProfile = profile({
      interests: [{ topic: 'Unrelated topic', strength: 0.9, confidence: 0.9 }],
      contentPreferences: {
        preferredDepth: 'high',
        noveltyPreference: 'high',
        avoidRepetition: true,
        preferredFormats: [],
        confidence: 0.8,
      },
    });
    const context = selectRelevantProfileContext(personalProfile, material(), {
      intent: '',
      availableMinutes: 15,
      scenario: 'work',
    });

    expect(context?.signals).toHaveLength(1);
    expect(context?.signals[0]?.kind).toBe('contentPreference');
    expect(JSON.stringify(context)).not.toContain('Unrelated topic');
  });

  it('retrieves only concrete knowledge and learning areas related to the article', () => {
    const personalProfile = profile({
      demonstratedKnowledge: [
        {
          topic: 'AI-агенты',
          statement: 'Пользователь знает основные архитектуры AI-агентов',
          evidenceType: 'demonstrated',
          confidence: 0.9,
          basis: ['Самостоятельно сравнивал архитектуры'],
        },
        {
          topic: 'Средневековая история',
          statement: 'Пользователь знает устройство феодальных отношений',
          evidenceType: 'explicitly_stated',
          confidence: 0.8,
          basis: [],
        },
      ],
      learningAreas: [
        {
          topic: 'Оценка AI-агентов',
          focus: 'Новые методы оценки автономных агентов',
          confidence: 0.85,
        },
      ],
    });
    const context = selectRelevantProfileContext(personalProfile, material(), {
      intent: '',
      availableMinutes: 15,
      scenario: 'work',
    });

    expect(context?.knowledgeSignals?.map((signal) => signal.kind)).toEqual([
      'known',
      'learning',
    ]);
    expect(JSON.stringify(context)).not.toContain('феодальных');
  });

  it('prioritizes Relax signals without erasing secondary evidence', () => {
    const personalProfile = profile({
      goals: [
        {
          goal: 'Write a professional AI infrastructure report',
          priority: 'high',
          status: 'active',
          confidence: 1,
        },
      ],
      expertise: [
        {
          topic: 'AI infrastructure',
          level: 'expert',
          confidence: 1,
          basis: [],
        },
      ],
      lowValueTopics: [
        {
          topic: 'AI infrastructure',
          confidence: 1,
        },
      ],
      leisureProfile: {
        status: 'available',
        preferences: [
          {
            kind: 'genre',
            category: 'AI workplace comedy',
            preference: 'high',
            confidence: 0.9,
            evidenceType: 'explicitly_stated',
            basis: 'Explicitly chosen for relaxation.',
          },
        ],
        noveltyPreference: 'balanced',
        effortPreference: 'low',
        typicalSessionMinutes: 20,
        confidence: 0.9,
      },
    });

    const context = selectRelevantProfileContext(
      personalProfile,
      material({
        title: 'AI workplace comedy',
        excerpt: 'A light comedy about AI infrastructure at work.',
      }),
      {
        intent: '',
        availableMinutes: 15,
        scenario: 'relax',
        relaxIntent: 'funny',
        desiredEffort: 'low',
        leisureFormats: [],
      },
    );

    expect(context?.signals[0]?.kind).toBe('leisurePreference');
    expect(context?.signals.some((signal) => signal.kind === 'goal')).toBe(
      true,
    );
    expect(context?.signals.some((signal) => signal.kind === 'expertise')).toBe(
      true,
    );
  });
});

describe('profile feedback', () => {
  const signal: PersonalizationSignal = {
    id: 'interest:one',
    profileEntryId: 'interest-one',
    kind: 'interest',
    effect: 'positive',
    label: 'AI-агенты',
    explanation: 'Совпадает с интересом.',
    confidence: 0.6,
    matchScore: 1,
  };

  it('raises confidence when the user confirms a profile signal', () => {
    const personalProfile = profile({
      interests: [{ topic: 'AI-агенты', strength: 0.9, confidence: 0.6 }],
    });
    const actualSignal = {
      ...signal,
      profileEntryId: personalProfile.interests[0]?.id ?? '',
    };
    const updated = applySignalFeedback(
      personalProfile,
      actualSignal,
      'affirmSignal',
      new Date('2026-08-26T10:00:00Z'),
    );

    expect(updated.interests[0]?.confidence).toBe(1);
    expect(updated.interests[0]?.sources.at(-1)?.source).toBe('manual');
    expect(personalProfile.interests[0]?.confidence).toBe(0.6);
  });

  it('removes a signal the user asks not to consider', () => {
    const personalProfile = profile({
      interests: [{ topic: 'AI-агенты', strength: 0.9, confidence: 0.6 }],
    });
    const updated = applySignalFeedback(
      personalProfile,
      {
        ...signal,
        profileEntryId: personalProfile.interests[0]?.id ?? '',
      },
      'ignoreSignal',
    );

    expect(updated.interests).toEqual([]);
  });
});
