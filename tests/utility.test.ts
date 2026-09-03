import { describe, expect, it } from 'vitest';
import {
  calculateUtilityScore,
  utilityRecommendation,
} from '../src/analyzer/utility';
import {
  createFullAnalysisHoverPreview,
  createHoverPreview,
} from '../src/analyzer/preview';
import { textTokens } from '../src/analyzer/text-match';
import { isAnalyzeRequestBody } from '../src/analyzer/api-contract';
import { createEmptyProfile } from '../src/profile/schema';
import type { AttentionSessionRecord } from '../src/shared/types';
import {
  getUtilityFeedbackStats,
  loadUtilityFeedback,
  recordActualUtility,
  UTILITY_FEEDBACK_KEY,
} from '../src/utility/storage';

class MemoryStorage {
  readonly data: Record<string, unknown> = {};

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys == null) return { ...this.data };
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(requested.map((key) => [key, this.data[key]]));
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, structuredClone(items));
  }
}

describe('Utility Score', () => {
  it('validates the single POST /analyze request contract', () => {
    expect(
      isAnalyzeRequestBody({
        profileContext: {
          profileUpdatedAt: '2026-08-25T10:00:00.000Z',
          signals: [
            {
              id: 'goal:1',
              profileEntryId: '1',
              kind: 'goal',
              effect: 'positive',
              label: 'Evaluate AI systems',
              explanation: 'Relevant to the active goal.',
              confidence: 0.9,
              matchScore: 0.8,
            },
          ],
        },
        title: 'A useful article',
        url: 'https://example.com/article',
        articleText: 'Substantive article text. '.repeat(10),
      }),
    ).toBe(true);
    expect(
      isAnalyzeRequestBody({
        profileContext: null,
        title: 'Missing article',
        url: 'javascript:alert(1)',
        articleText: 'short',
      }),
    ).toBe(false);
    expect(
      isAnalyzeRequestBody({
        userProfile: createEmptyProfile(),
        profileContext: null,
        title: 'A useful article',
        url: 'https://example.com/article',
        articleText: 'Substantive article text. '.repeat(10),
      }),
    ).toBe(false);
    expect(
      isAnalyzeRequestBody({
        profileContext: {
          profileUpdatedAt: '2026-08-25T10:00:00.000Z',
          signals: [],
          readwiseEvidence: {
            exactSourceMatched: true,
            matchingSourceCount: 1,
            matchingHighlightCount: 1,
            familiarityConfidence: 0.8,
            matchingHighlights: [],
            evidenceUpdatedAt: '2026-08-25T10:00:00.000Z',
          },
        },
        title: 'A useful article',
        url: 'https://example.com/article',
        articleText: 'Substantive article text. '.repeat(10),
      }),
    ).toBe(false);
    expect(
      isAnalyzeRequestBody({
        profileContext: {
          profileUpdatedAt: '2026-08-25T10:00:00.000Z',
          signals: [],
          obsidianEvidence: {
            matchingNoteCount: 1,
            matchingFragmentCount: 1,
            familiarityConfidence: 0.8,
            matchingFragments: [],
            evidenceUpdatedAt: '2026-08-25T10:00:00.000Z',
          },
        },
        title: 'A useful article',
        url: 'https://example.com/article',
        articleText: 'Substantive article text. '.repeat(10),
      }),
    ).toBe(false);
  });

  it('calculates the final score in code using the configured weights', () => {
    const score = calculateUtilityScore({
      relevance: 85,
      novelty: 70,
      actionability: 55,
      quality: 80,
    });

    expect(score).toBe(74);
    expect(utilityRecommendation(score)).toBe('read');
  });

  it('keeps meaningful short terms such as AI without admitting common words', () => {
    const tokens = textTokens('AI research is relevant to my goal');

    expect(tokens.has('ai')).toBe(true);
    expect(tokens.has('is')).toBe(false);
    expect(tokens.has('to')).toBe(false);
    expect(textTokens('artificial intelligence').has('ai')).toBe(true);
    expect(textTokens('training LLMs from scratch').has('ai')).toBe(true);
  });

  it('creates a title-only preview without fetching the linked page', async () => {
    const profile = createEmptyProfile(new Date('2026-08-25T10:00:00Z'));
    profile.goals.push({
      id: 'goal-1',
      goal: 'Evaluate AI systems and research',
      priority: 'high',
      status: 'active',
      confidence: 0.95,
      sources: [],
    });

    const preview = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://example.com/ai-evaluation',
        title: 'A rigorous framework for evaluating AI systems',
        snippet: 'New research methods and practical benchmarks.',
      },
      profile,
    );

    expect(preview.source).toBe('title-preview');
    expect(preview.utilityScore).toBeNull();
    expect(preview.recommendedAction).toBe('open');
    expect(preview.reason).toContain('активной целью');
    expect(preview.expectedValue).toBe('Связь с активной целью');
    expect(preview.risk).toContain('Новизна');
    expect(preview.confidence).toBe('medium');
  });

  it('shows an exact score only for a stored full-text analysis', () => {
    const preview = createFullAnalysisHoverPreview({
      scenario: 'work',
      recommendedAction: 'read',
      utilityScore: 82,
      components: {
        relevance: 91,
        novelty: 74,
        actionability: 63,
        quality: 80,
      },
      scenarioSignals: {
        relevance: 91,
        novelty: 74,
        quality: 80,
        actionability: 63,
        knowledgeFit: 70,
        timeFit: 80,
        effortFit: 75,
        tasteFit: 50,
        serendipity: 50,
        enjoymentFit: 50,
      },
      estimatedUsefulMinutes: 7,
      reason: 'Материал напрямую поддерживает активную цель.',
      expectedValue: 'Два новых практических подхода.',
      recommendedSections: [],
      profileSignals: [],
      insights: {
        keyClaims: [],
        likelyNewClaims: ['Новый способ распределять внимание.'],
        familiarClaims: [],
        noveltySummary: 'Главный подход, вероятно, новый.',
        noveltyConfidence: 0.75,
        qualityBreakdown: {
          evidence: 80,
          reasoning: 82,
          specificity: 76,
          calibration: 70,
        },
        qualitySummary: 'Аргументация выглядит достаточно сильной.',
        qualityStrengths: ['Есть конкретные примеры.'],
        qualityLimitations: ['Источники не проверялись независимо.'],
        qualityConfidence: 0.72,
      },
      confidence: 0.82,
      analyzerId: 'ai-test',
      analyzedAt: '2026-08-25T10:00:00.000Z',
    });

    expect(preview).toMatchObject({
      source: 'full-analysis',
      utilityScore: 82,
      recommendedAction: 'open',
      confidence: 'high',
      estimatedUsefulMinutes: 7,
      components: {
        relevance: 91,
        novelty: 74,
        actionability: 63,
        quality: 80,
      },
      insights: expect.objectContaining({
        likelyNewClaims: ['Новый способ распределять внимание.'],
        qualityLimitations: ['Источники не проверялись независимо.'],
      }),
    });
  });

  it('recommends skipping a title that strongly matches a low-value topic', async () => {
    const profile = createEmptyProfile(new Date('2026-08-25T10:00:00Z'));
    profile.lowValueTopics.push({
      id: 'low-value-1',
      topic: 'generic productivity advice',
      confidence: 0.95,
      sources: [],
    });

    const preview = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://example.com/productivity',
        title: 'Generic productivity advice for getting more done',
        snippet: 'Ten familiar habits used by successful people.',
      },
      profile,
    );

    expect(preview).toMatchObject({
      utilityScore: null,
      recommendedAction: 'skip',
      expectedValue: 'Новая персональная ценность маловероятна',
      confidence: 'medium',
    });
    expect(preview.reason).toContain('малоценную тему');
  });

  it('admits uncertainty when a title has no profile match', async () => {
    const preview = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://example.com/unrelated',
        title: 'An unrelated subject with no matching context',
        snippet: 'There is not enough evidence before opening the article.',
      },
      createEmptyProfile(),
    );

    expect(preview).toMatchObject({
      utilityScore: null,
      recommendedAction: 'maybe',
      confidence: 'low',
      expectedValue: 'Персональная ценность пока неясна',
    });
  });

  it('treats one distinctive active-goal match as enough to open', async () => {
    const profile = createEmptyProfile();
    profile.goals.push({
      id: 'goal-ai-research',
      goal: 'Find rigorous and actionable AI research',
      priority: 'high',
      status: 'active',
      confidence: 0.95,
      sources: [],
    });

    const preview = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://example.com/llm-security',
        title: 'A new security model for LLMs',
        snippet: '',
      },
      profile,
    );

    expect(preview).toMatchObject({
      recommendedAction: 'open',
      expectedValue: 'Связь с активной целью',
      confidence: 'medium',
    });
  });

  it('does not present an explicit language lesson as Work just because the skill supports a career goal', async () => {
    const profile = createEmptyProfile();
    profile.goals.push({
      id: 'goal-german-career',
      goal: 'Improve professional German beyond B2',
      priority: 'high',
      status: 'active',
      confidence: 0.95,
      sources: [],
    });
    profile.expertise.push({
      id: 'expertise-german',
      topic: 'German professional communication',
      level: 'intermediate',
      confidence: 0.98,
      basis: ['Completed B2 professional German'],
      sources: [],
    });

    const preview = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://www.youtube.com/watch?v=german-a2-b1',
        title: 'Die beste Art, Deutsch zu lernen (A2/B1)',
        snippet: 'Deutsch lernen mit Übungen und Grammatik.',
      },
      profile,
      undefined,
      { scenario: 'work', intent: '', availableMinutes: 15 },
    );

    expect(preview).toMatchObject({
      recommendedAction: 'maybe',
      suggestedScenario: 'learn',
      expectedValue: 'Подходит скорее для сценария «Учёба»',
    });
    expect(preview.reason).toContain('учебный материал');
  });

  it('recommends a matching language lesson in the Learn scenario', async () => {
    const profile = createEmptyProfile();
    profile.learningAreas.push({
      id: 'learning-german',
      topic: 'German language',
      focus: 'Professional conversation and progression from B2 toward C1',
      confidence: 0.91,
      sources: [],
    });
    profile.expertise.push({
      id: 'expertise-german',
      topic: 'German professional communication',
      level: 'intermediate',
      confidence: 0.98,
      basis: ['Completed B2 professional German'],
      sources: [],
    });

    const preview = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://www.youtube.com/watch?v=german-b1-c1',
        title:
          'Deutsch lernen im Schlaf | 2000 wichtige Wörter für Alltag, Arbeit & Gespräche (B1–B2–C1)',
        snippet:
          'In diesem Video lernst du wichtige deutsche Wörter und Gespräche.',
      },
      profile,
      undefined,
      { scenario: 'learn', intent: '', availableMinutes: 15 },
    );

    expect(preview).toMatchObject({
      scenario: 'learn',
      recommendedAction: 'skip',
      expectedValue: 'Сомнительная учебная отдача',
    });
    expect(preview.suggestedScenario).toBeUndefined();
  });

  it('distinguishes useful, broad and weak German learning formats', async () => {
    const profile = createEmptyProfile();
    profile.learningAreas.push({
      id: 'learning-german',
      topic: 'German language',
      focus: 'Spontaneous conversation and progression from B2 toward C1',
      confidence: 0.91,
      sources: [],
    });
    profile.expertise.push({
      id: 'expertise-german',
      topic: 'German language',
      level: 'intermediate',
      confidence: 0.98,
      basis: ['Completed B2 German'],
      sources: [],
    });
    const learnContext = {
      scenario: 'learn' as const,
      intent: '',
      availableMinutes: 15 as const,
    };

    const streetPractice = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://www.youtube.com/watch?v=street-german',
        title: 'Learn German from the Streets of Cologne',
        snippet:
          'Authentic conversations and listening practice with people in Cologne.',
      },
      profile,
      undefined,
      learnContext,
    );
    const verbs = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://www.youtube.com/watch?v=verbs-b1-c1',
        title: 'Deutsche Verben B1 B2 C1 einfach erklärt',
        snippet: 'Wichtige deutsche Verben mit Beispielen und Übungen.',
      },
      profile,
      undefined,
      learnContext,
    );
    const broadCourse = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://www.youtube.com/playlist?list=a1-c1',
        title: 'Deutsch lernen mit Dialogen – kompletter Deutschkurs A1–C1',
        snippet: '214 Lektionen vom Anfänger bis zum fortgeschrittenen Niveau.',
      },
      profile,
      undefined,
      learnContext,
    );
    const sleepCourse = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://www.youtube.com/watch?v=sleep-german',
        title: 'Deutsch lernen im Schlaf | 3000 Wörter B1–B2–C1',
        snippet: 'Lerne deutsche Wörter im Schlaf ohne Anstrengung.',
      },
      profile,
      undefined,
      learnContext,
    );

    expect(streetPractice).toMatchObject({
      recommendedAction: 'open',
      expectedValue: 'Практика навыка из вашего профиля',
    });
    expect(verbs).toMatchObject({
      recommendedAction: 'open',
      expectedValue: 'Практика на подходящем уровне',
    });
    expect(broadCourse).toMatchObject({
      recommendedAction: 'maybe',
      expectedValue: 'Ищите раздел своего уровня',
    });
    expect(sleepCourse).toMatchObject({
      recommendedAction: 'skip',
      expectedValue: 'Сомнительная учебная отдача',
    });
  });

  it('allows an explicit current Work task to override the learning-format suggestion', async () => {
    const profile = createEmptyProfile();
    profile.goals.push({
      id: 'goal-german-career',
      goal: 'Improve professional German beyond B2',
      priority: 'high',
      status: 'active',
      confidence: 0.95,
      sources: [],
    });

    const preview = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://www.youtube.com/watch?v=german-b1-client',
        title: 'Deutsch B1: Bewerbungsgespräch üben',
        snippet: 'Übungen für ein deutsches Vorstellungsgespräch.',
      },
      profile,
      undefined,
      {
        scenario: 'work',
        intent: 'Prepare a B1 German job interview',
        availableMinutes: 15,
      },
    );

    expect(preview.suggestedScenario).toBeUndefined();
  });

  it('can make the same weak goal match neutral after local calibration', async () => {
    const profile = createEmptyProfile();
    profile.goals.push({
      id: 'goal-ai-research',
      goal: 'Find rigorous and actionable AI research',
      priority: 'high',
      status: 'active',
      confidence: 0.95,
      sources: [],
    });

    const preview = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://example.com/ai-opinion',
        title: 'Another opinion about AI',
        snippet: '',
      },
      profile,
      {
        version: 'hover-calibration-v1',
        sampleSize: 5,
        positiveThreshold: 0.6,
        negativeThreshold: 0.5,
      },
    );

    expect(preview.recommendedAction).toBe('maybe');
    expect(preview.calibrationSampleSize).toBe(5);
  });

  it('does not infer a depth mismatch from a short hover snippet', async () => {
    const profile = createEmptyProfile();
    profile.contentPreferences = {
      preferredDepth: 'high',
      noveltyPreference: 'high',
      avoidRepetition: true,
      preferredFormats: ['research'],
      confidence: 0.95,
      sources: [],
    };
    const preview = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://example.com/deep-research',
        title: 'A potentially substantial research article',
        snippet: 'Only a short card snippet is visible before opening.',
      },
      profile,
    );

    expect(preview.recommendedAction).toBe('maybe');
    expect(preview.signalIds).not.toContain('contentPreference:global');
  });

  it('stores predicted vs actual utility and reports average error', async () => {
    const storage = new MemoryStorage();
    const session: AttentionSessionRecord = {
      id: 'session-1',
      url: 'https://example.com/article',
      title: 'Article',
      decision: 'read',
      scenario: 'work',
      scenarioContext: {
        intent: '',
        availableMinutes: 15,
        relaxIntent: null,
        desiredEffort: null,
      },
      expected: {
        analyzerId: 'ai-v2',
        recommendedAction: 'read',
        expectedValue: null,
        confidence: 0.8,
        profileSignalIds: [],
        predictedUtility: 82,
        components: {
          relevance: 91,
          novelty: 74,
          actionability: 63,
          quality: 80,
        },
      },
      estimatedReadingSeconds: 600,
      startedAt: '2026-08-25T10:00:00.000Z',
      updatedAt: '2026-08-25T10:10:00.000Z',
      endedAt: null,
      visibleSeconds: 120,
      maxScrollDepth: 75,
      sampledForOutcome: true,
      promptShownCount: 1,
      outcome: null,
      outcomeReason: null,
      outcomeAt: null,
    };

    const record = await recordActualUtility(
      session,
      90,
      storage,
      new Date('2026-08-25T10:15:00Z'),
    );
    const stats = await getUtilityFeedbackStats(storage);

    expect(record).toMatchObject({ predictedUtility: 82, actualUtility: 90 });
    expect(stats).toEqual({
      total: 1,
      averageError: 8,
      byScenario: {
        work: { total: 1, averageError: 8 },
        learn: { total: 0, averageError: null },
        explore: { total: 0, averageError: null },
        relax: { total: 0, averageError: null },
      },
    });
  });

  it('migrates pre-scenario utility feedback to Work and keeps calibration data', async () => {
    const storage = new MemoryStorage();
    storage.data[UTILITY_FEEDBACK_KEY] = [
      {
        id: 'legacy-feedback',
        sessionId: 'legacy-session',
        url: 'https://example.com/legacy',
        title: 'Legacy article',
        predictedUtility: 70,
        actualUtility: 85,
        components: {
          relevance: 80,
          novelty: 60,
          actionability: 65,
          quality: 75,
        },
        evaluatedAt: '2026-08-24T10:00:00.000Z',
        recordedAt: '2026-08-24T10:10:00.000Z',
      },
    ];

    const [migrated] = await loadUtilityFeedback(storage);
    const stats = await getUtilityFeedbackStats(storage);

    expect(migrated).toMatchObject({
      source: 'slider',
      scenario: 'work',
      scenarioContext: {
        intent: '',
        availableMinutes: 15,
        relaxIntent: null,
        desiredEffort: null,
      },
    });
    expect(stats.byScenario.work).toEqual({ total: 1, averageError: 15 });
    expect(storage.data[UTILITY_FEEDBACK_KEY]).toEqual([
      expect.objectContaining({ scenario: 'work', source: 'slider' }),
    ]);
  });
});
