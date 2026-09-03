import { describe, expect, it } from 'vitest';
import { LocalAnalyzer } from '../src/analyzer/local-analyzer';
import { recordQuickOutcome } from '../src/attention/quick-feedback';
import {
  buildScenarioSignals,
  calculateScenarioUtility,
} from '../src/analyzer/scenario-scoring';
import {
  changeScenario,
  createDefaultScenarioState,
  loadScenarioState,
  normalizeAnalysisContext,
  saveScenarioState,
} from '../src/scenario/scenario';
import { createEmptyProfile } from '../src/profile/schema';
import { extractCefrRange } from '../src/scenario/material-activity';
import { PERSONAL_PROFILE_KEY } from '../src/profile/storage';
import {
  getUtilityFeedbackStats,
  recordActualUtility,
} from '../src/utility/storage';
import type {
  AnalysisContext,
  AttentionSessionRecord,
  PageCapture,
  RelevantProfileContext,
  ScenarioUtilitySignals,
} from '../src/shared/types';

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

function context(
  scenario: AnalysisContext['scenario'],
  overrides: Partial<AnalysisContext> = {},
): AnalysisContext {
  return {
    scenario,
    intent: '',
    availableMinutes: 15,
    ...overrides,
  };
}

function signals(
  overrides: Partial<ScenarioUtilitySignals> = {},
): ScenarioUtilitySignals {
  return {
    relevance: 50,
    novelty: 50,
    quality: 70,
    actionability: 50,
    knowledgeFit: 60,
    timeFit: 80,
    effortFit: 80,
    tasteFit: 50,
    serendipity: 50,
    enjoymentFit: 50,
    ...overrides,
  };
}

function material(overrides: Partial<PageCapture> = {}): PageCapture {
  return {
    title: 'An interesting history story',
    url: 'https://example.com/story',
    content: 'A coherent and engaging story. '.repeat(200),
    excerpt: 'An interesting story with a clear narrative.',
    byline: null,
    siteName: 'Example',
    publishedTime: null,
    language: 'en',
    wordCount: 1_000,
    readingTimeMinutes: 6,
    headings: ['The story', 'What happened next'],
    isArticle: true,
    extractionMethod: 'readability',
    capturedAt: '2026-08-26T10:00:00.000Z',
    ...overrides,
  };
}

function profileContext(
  overrides: Partial<RelevantProfileContext> = {},
): RelevantProfileContext {
  return {
    profileUpdatedAt: '2026-08-26T10:00:00.000Z',
    signals: [],
    knowledgeSignals: [],
    ...overrides,
  };
}

describe('scenario state', () => {
  it('migrates missing scenario data to Work and persists a one-action switch', async () => {
    const storage = new MemoryStorage();
    expect(
      normalizeAnalysisContext({ intent: '', availableMinutes: 15 }).scenario,
    ).toBe('work');

    const initial = await loadScenarioState(storage);
    expect(initial.scenario).toBe('work');

    const changed = changeScenario(
      createDefaultScenarioState(new Date('2026-08-26T10:00:00Z')),
      'relax',
      'manual',
      new Date('2026-08-26T11:00:00Z'),
    );
    await saveScenarioState(changed, storage);

    expect(await loadScenarioState(storage)).toMatchObject({
      scenario: 'relax',
      scenarioSource: 'manual',
      scenarioUpdatedAt: '2026-08-26T11:00:00.000Z',
    });
  });
});

describe('learning material level ranges', () => {
  it('keeps a broad A1-C1 course as a range instead of treating it as C1', () => {
    expect(extractCefrRange('Kompletter Deutschkurs Niveau A1–C1')).toEqual({
      levels: ['A1', 'C1'],
      minimum: 'A1',
      maximum: 'C1',
      span: 4,
    });
  });
});

describe('scenario-specific utility', () => {
  it('scores a technical paper high for Work and low for Relax', () => {
    const technical = signals({
      relevance: 95,
      novelty: 70,
      quality: 85,
      actionability: 95,
      knowledgeFit: 75,
      timeFit: 40,
      effortFit: 18,
      tasteFit: 10,
      serendipity: 40,
      enjoymentFit: 10,
    });

    expect(
      calculateScenarioUtility(technical, context('work')),
    ).toBeGreaterThan(75);
    expect(calculateScenarioUtility(technical, context('relax'))).toBeLessThan(
      40,
    );
  });

  it('scores entertainment low for Work and high for Relax', () => {
    const comedy = signals({
      relevance: 5,
      novelty: 50,
      quality: 75,
      actionability: 5,
      knowledgeFit: 20,
      timeFit: 100,
      effortFit: 100,
      tasteFit: 95,
      serendipity: 60,
      enjoymentFit: 100,
    });

    expect(calculateScenarioUtility(comedy, context('work'))).toBeLessThan(40);
    expect(calculateScenarioUtility(comedy, context('relax'))).toBeGreaterThan(
      90,
    );
  });

  it('keeps a familiar but directly useful Work reference valuable', () => {
    const familiarReference = signals({
      relevance: 96,
      novelty: 8,
      quality: 90,
      actionability: 96,
      knowledgeFit: 88,
      timeFit: 100,
      effortFit: 90,
    });

    expect(
      calculateScenarioUtility(familiarReference, context('work')),
    ).toBeGreaterThan(75);
  });

  it('rewards appropriate novelty in Learn and penalizes level mismatch', () => {
    const appropriate = signals({
      relevance: 70,
      novelty: 90,
      quality: 90,
      actionability: 20,
      knowledgeFit: 95,
      timeFit: 85,
      effortFit: 95,
    });
    const tooBasic = signals({
      ...appropriate,
      novelty: 10,
      knowledgeFit: 25,
    });
    const tooAdvanced = signals({
      ...appropriate,
      knowledgeFit: 10,
      effortFit: 20,
    });

    const good = calculateScenarioUtility(appropriate, context('learn'));
    expect(good).toBeGreaterThan(80);
    expect(calculateScenarioUtility(tooBasic, context('learn'))).toBeLessThan(
      good - 20,
    );
    expect(
      calculateScenarioUtility(tooAdvanced, context('learn')),
    ).toBeLessThan(good - 20);
  });

  it('rewards serendipity in Explore instead of pure similarity', () => {
    const adjacentDiscovery = signals({
      relevance: 45,
      novelty: 90,
      quality: 85,
      serendipity: 95,
      tasteFit: 70,
      enjoymentFit: 75,
    });
    const obviousSimilarity = signals({
      relevance: 95,
      novelty: 20,
      quality: 80,
      serendipity: 20,
      tasteFit: 70,
      enjoymentFit: 65,
    });

    expect(
      calculateScenarioUtility(adjacentDiscovery, context('explore')),
    ).toBeGreaterThan(
      calculateScenarioUtility(obviousSimilarity, context('explore')) + 20,
    );
  });
});

describe('Relax is not productivity scoring', () => {
  it('does not use actionability in Relax Utility', () => {
    const lowActionability = signals({ actionability: 0 });
    const highActionability = signals({ actionability: 100 });

    expect(calculateScenarioUtility(lowActionability, context('relax'))).toBe(
      calculateScenarioUtility(highActionability, context('relax')),
    );
  });

  it('allows familiar, low-novelty entertainment to have very high Utility', () => {
    const favourite = signals({
      novelty: 5,
      quality: 90,
      timeFit: 100,
      effortFit: 100,
      tasteFit: 100,
      enjoymentFit: 100,
    });

    expect(
      calculateScenarioUtility(
        favourite,
        context('relax', { relaxIntent: 'familiar' }),
      ),
    ).toBeGreaterThan(90);
  });

  it('uses the current mood rather than treating it as a permanent trait', () => {
    const components = {
      relevance: 10,
      novelty: 55,
      actionability: 0,
      quality: 60,
    };
    const funny = buildScenarioSignals(
      components,
      material({ title: 'A funny comedy story', excerpt: 'Humor and jokes.' }),
      context('relax', { relaxIntent: 'funny' }),
      null,
    );
    const chill = buildScenarioSignals(
      components,
      material({ title: 'A funny comedy story', excerpt: 'Humor and jokes.' }),
      context('relax', { relaxIntent: 'chill' }),
      null,
    );

    expect(
      calculateScenarioUtility(
        funny,
        context('relax', { relaxIntent: 'funny' }),
      ),
    ).toBeGreaterThan(
      calculateScenarioUtility(
        chill,
        context('relax', { relaxIntent: 'chill' }),
      ) + 5,
    );
  });

  it('penalizes heavy material for low effort and rewards a matching high-effort choice', () => {
    const components = {
      relevance: 20,
      novelty: 70,
      actionability: 10,
      quality: 85,
    };
    const lecture = material({
      title: 'An interesting technical philosophy lecture',
      excerpt: 'A demanding research lecture.',
      wordCount: 5_000,
      readingTimeMinutes: 22,
    });
    const lowContext = context('relax', {
      relaxIntent: 'interesting',
      desiredEffort: 'low',
      availableMinutes: 30,
    });
    const highContext = context('relax', {
      relaxIntent: 'interesting',
      desiredEffort: 'high',
      availableMinutes: 30,
    });
    const low = buildScenarioSignals(components, lecture, lowContext, null);
    const high = buildScenarioSignals(components, lecture, highContext, null);

    expect(calculateScenarioUtility(high, highContext)).toBeGreaterThan(
      calculateScenarioUtility(low, lowContext) + 10,
    );
  });

  it('does not let an available-time preference change material utility', () => {
    const base = signals({ tasteFit: 90, enjoymentFit: 90, effortFit: 90 });
    expect(
      calculateScenarioUtility({ ...base, timeFit: 100 }, context('relax')),
    ).toBe(
      calculateScenarioUtility({ ...base, timeFit: 20 }, context('relax')),
    );
  });

  it('keeps the same score for the same article at 5 and 30 minutes', () => {
    const article = material({
      wordCount: 4_200,
      readingTimeMinutes: 24,
    });
    const components = {
      relevance: 78,
      novelty: 64,
      actionability: 71,
      quality: 82,
    };
    const fiveMinutes = context('work', { availableMinutes: 5 });
    const thirtyMinutes = context('work', { availableMinutes: 30 });

    expect(
      calculateScenarioUtility(
        buildScenarioSignals(components, article, fiveMinutes, null),
        fiveMinutes,
      ),
    ).toBe(
      calculateScenarioUtility(
        buildScenarioSignals(components, article, thirtyMinutes, null),
        thirtyMinutes,
      ),
    );
  });

  it('caps Work fit for an explicit lesson while leaving Learn scoring intact', () => {
    const lesson = material({
      title: 'Deutsch lernen: Grammatik und Übungen A2/B1',
      excerpt: 'Eine Lektion mit Wortschatz und Sprachpraxis.',
      language: 'de',
    });
    const components = {
      relevance: 92,
      novelty: 72,
      actionability: 88,
      quality: 84,
    };
    const workSignals = buildScenarioSignals(
      components,
      lesson,
      context('work'),
      null,
    );
    const learnSignals = buildScenarioSignals(
      components,
      lesson,
      context('learn'),
      null,
    );

    expect(workSignals.relevance).toBe(44);
    expect(workSignals.actionability).toBe(45);
    expect(learnSignals.relevance).toBe(92);
    expect(learnSignals.actionability).toBe(88);
    expect(calculateScenarioUtility(workSignals, context('work'))).toBeLessThan(
      70,
    );
  });

  it('marks the full Work evaluation as better suited to Learn', async () => {
    const analyzer = new LocalAnalyzer();
    const evaluation = await analyzer.analyze(
      material({
        title: 'Deutsch lernen: Grammatik und Übungen A2/B1',
        excerpt: 'Eine Lektion mit Wortschatz und Sprachpraxis.',
        language: 'de',
      }),
      context('work'),
      profileContext({
        signals: [
          {
            id: 'goal:german',
            profileEntryId: 'german',
            kind: 'goal',
            effect: 'positive',
            label: 'Improve professional German beyond B2',
            explanation: 'Career goal.',
            confidence: 0.95,
            matchScore: 0.85,
          },
        ],
      }),
    );

    expect(evaluation.suggestedScenario).toBe('learn');
    expect(evaluation.recommendedAction).not.toBe('read');
    expect(evaluation.reason).toContain('учебный материал');
  });

  it('keeps confidence low with no leisure evidence and uses imported taste when present', async () => {
    const analyzer = new LocalAnalyzer();
    const relaxContext = context('relax', {
      relaxIntent: 'funny',
      desiredEffort: 'low',
    });
    const comedy = material({
      title: 'A funny comedy story',
      excerpt: 'Humor and jokes for a short break.',
      wordCount: 600,
      readingTimeMinutes: 4,
    });
    const unknown = await analyzer.analyze(comedy, relaxContext, null);
    const known = await analyzer.analyze(
      comedy,
      relaxContext,
      profileContext({
        signals: [
          {
            id: 'leisurePreference:comedy',
            profileEntryId: 'comedy',
            kind: 'leisurePreference',
            effect: 'positive',
            label: 'comedy',
            explanation: 'Repeatedly enjoyed comedy.',
            confidence: 0.95,
            matchScore: 1,
          },
        ],
      }),
    );

    expect(unknown.confidence).toBeLessThanOrEqual(0.48);
    expect(unknown.reason).toContain('мало данных');
    expect(known.scenarioSignals.tasteFit).toBeGreaterThan(
      unknown.scenarioSignals.tasteFit,
    );
    expect(known.utilityScore).toBeGreaterThan(unknown.utilityScore);
  });

  it('uses matching history as bounded Relax taste when explicit taste is absent', async () => {
    const analyzer = new LocalAnalyzer();
    const relaxContext = context('relax', {
      relaxIntent: 'funny',
      desiredEffort: 'low',
    });
    const comedy = material({
      title: 'A funny medieval comedy adventure',
      excerpt: 'A short humorous episode.',
      wordCount: 600,
      readingTimeMinutes: 4,
    });
    const unknown = await analyzer.analyze(comedy, relaxContext, null);
    const withHistory = await analyzer.analyze(
      comedy,
      relaxContext,
      profileContext({
        signals: [
          {
            id: 'historyTopic:medieval-comedy',
            profileEntryId: null,
            kind: 'historyTopic',
            effect: 'positive',
            label: 'medieval comedy',
            explanation: 'Repeatedly selected in recent history.',
            confidence: 0.34,
            matchScore: 0.8,
          },
        ],
      }),
    );

    expect(withHistory.scenarioSignals.tasteFit).toBeGreaterThan(50);
    expect(withHistory.scenarioSignals.tasteFit).toBeLessThanOrEqual(74);
    expect(withHistory.utilityScore).toBeGreaterThan(unknown.utilityScore);
    expect(withHistory.confidence).toBeLessThanOrEqual(0.62);
  });

  it('keeps feedback calibration isolated by scenario', async () => {
    const storage = new MemoryStorage();
    const session: AttentionSessionRecord = {
      id: 'relax-session',
      url: 'https://example.com/comedy',
      title: 'Comedy',
      decision: 'read',
      scenario: 'relax',
      scenarioContext: {
        intent: '',
        availableMinutes: 15,
        relaxIntent: 'funny',
        desiredEffort: 'low',
      },
      expected: {
        analyzerId: 'local',
        recommendedAction: 'read',
        expectedValue: 'A light funny break',
        confidence: 0.7,
        profileSignalIds: ['leisurePreference:comedy'],
        predictedUtility: 88,
        components: {
          relevance: 5,
          novelty: 40,
          actionability: 0,
          quality: 75,
        },
      },
      estimatedReadingSeconds: 300,
      startedAt: '2026-08-26T10:00:00.000Z',
      updatedAt: '2026-08-26T10:05:00.000Z',
      endedAt: null,
      visibleSeconds: 180,
      maxScrollDepth: 75,
      sampledForOutcome: true,
      promptShownCount: 1,
      outcome: null,
      outcomeReason: null,
      outcomeAt: null,
    };

    await recordActualUtility(session, 92, storage);
    const stats = await getUtilityFeedbackStats(storage);

    expect(stats.byScenario.relax.total).toBe(1);
    expect(stats.byScenario.work.total).toBe(0);
    expect(stats.byScenario.learn.total).toBe(0);
    expect(stats.byScenario.explore.total).toBe(0);
  });

  it('lets Relax feedback adjust only existing Relax taste evidence', async () => {
    const storage = new MemoryStorage();
    const profile = createEmptyProfile(new Date('2026-08-26T09:00:00Z'));
    profile.leisureProfile = {
      status: 'available',
      preferences: [
        {
          id: 'pref-comedy',
          kind: 'genre',
          category: 'comedy',
          preference: 'high',
          confidence: 0.5,
          evidenceType: 'inferred',
          basis: 'Repeated voluntary viewing.',
          sources: [],
        },
      ],
      noveltyPreference: 'balanced',
      effortPreference: 'low',
      typicalSessionMinutes: 15,
      confidence: 0.5,
    };
    storage.data[PERSONAL_PROFILE_KEY] = profile;
    const baseSession: AttentionSessionRecord = {
      id: 'relax-learning',
      url: 'https://example.com/comedy-learning',
      title: 'Comedy',
      decision: 'read',
      scenario: 'relax',
      scenarioContext: {
        intent: '',
        availableMinutes: 15,
        relaxIntent: 'funny',
        desiredEffort: 'low',
      },
      expected: {
        analyzerId: 'local',
        recommendedAction: 'read',
        expectedValue: 'Funny break',
        confidence: 0.7,
        profileSignalIds: ['leisurePreference:pref-comedy'],
        predictedUtility: 85,
        components: {
          relevance: 5,
          novelty: 40,
          actionability: 0,
          quality: 75,
        },
      },
      estimatedReadingSeconds: 300,
      startedAt: '2026-08-26T10:00:00.000Z',
      updatedAt: '2026-08-26T10:05:00.000Z',
      endedAt: null,
      visibleSeconds: 180,
      maxScrollDepth: 75,
      sampledForOutcome: true,
      promptShownCount: 1,
      outcome: null,
      outcomeReason: null,
      outcomeAt: null,
    };

    await recordQuickOutcome(baseSession, 'yes', storage);
    const afterRelax = storage.data[PERSONAL_PROFILE_KEY] as typeof profile;
    expect(afterRelax.leisureProfile.preferences[0]?.confidence).toBe(0.55);

    await recordQuickOutcome(
      {
        ...baseSession,
        id: 'work-learning',
        url: 'https://example.com/work-learning',
        scenario: 'work',
      },
      'no',
      storage,
    );
    const afterWork = storage.data[PERSONAL_PROFILE_KEY] as typeof profile;
    expect(afterWork.leisureProfile.preferences[0]?.confidence).toBe(0.55);
  });
});
