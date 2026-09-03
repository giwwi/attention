import { describe, expect, it } from 'vitest';
import {
  ATTENTION_SESSIONS_KEY,
  applyAttentionProgress,
  cancelAttentionSession,
  createAttentionSession,
  getEligibleOutcomeSession,
  getOpenAttentionSession,
  getOutcomeStats,
  isOutcomePromptEligible,
  loadAttentionSessions,
  markOutcomePromptShown,
  recordMaterialOutcome,
  recordMaterialOutcomeReason,
} from '../src/attention/storage';
import { recordQuickOutcome } from '../src/attention/quick-feedback';
import { readingEngagementThreshold } from '../src/attention/eligibility';
import { MATERIAL_MEMORY_KEY } from '../src/memory/material-memory';
import { UTILITY_FEEDBACK_KEY } from '../src/utility/storage';
import type { MaterialEvaluation, PageCapture } from '../src/shared/types';

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

function capture(overrides: Partial<PageCapture> = {}): PageCapture {
  return {
    title: 'Материал о внимании',
    url: 'https://example.com/article#section',
    content: 'Содержательный текст '.repeat(500),
    excerpt: 'Описание',
    byline: null,
    siteName: 'Example',
    publishedTime: null,
    language: 'ru',
    wordCount: 1_000,
    readingTimeMinutes: 5,
    headings: ['Раздел'],
    isArticle: true,
    extractionMethod: 'readability',
    capturedAt: '2026-08-25T10:00:00.000Z',
    ...overrides,
  };
}

function evaluation(
  overrides: Partial<MaterialEvaluation> = {},
): MaterialEvaluation {
  return {
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
    estimatedUsefulMinutes: 4,
    reason: 'Причина',
    expectedValue: 'Ожидаемая польза',
    recommendedSections: [],
    profileSignals: [
      {
        id: 'goal:one',
        profileEntryId: 'one',
        kind: 'goal',
        effect: 'positive',
        label: 'Цель',
        explanation: 'Объяснение',
        confidence: 0.9,
        matchScore: 1,
      },
    ],
    confidence: 0.8,
    analyzerId: 'local-heuristic-v2',
    analyzedAt: '2026-08-25T10:00:00.000Z',
    ...overrides,
  };
}

describe('attention sessions', () => {
  it('clamps the reading-time gate between 30 seconds and two minutes', () => {
    expect(readingEngagementThreshold(30)).toBe(30);
    expect(readingEngagementThreshold(600)).toBe(90);
    expect(readingEngagementThreshold(3_600)).toBe(120);
  });

  it('stores the expected result and minimal profile attribution', async () => {
    const storage = new MemoryStorage();
    const session = await createAttentionSession(
      capture(),
      'read',
      evaluation(),
      storage,
      new Date('2026-08-25T10:00:00Z'),
    );

    expect(session.url).toBe('https://example.com/article');
    expect(session.expected).toMatchObject({
      analyzerId: 'local-heuristic-v2',
      recommendedAction: 'read',
      confidence: 0.8,
      profileSignalIds: ['goal:one'],
      predictedUtility: 82,
    });
    expect(session.sampledForOutcome).toBe(true);
    expect(JSON.stringify(session.expected)).not.toContain('Объяснение');
  });

  it('collects actual utility after every analyzed reading session', async () => {
    const storage = new MemoryStorage();
    const first = await createAttentionSession(
      capture({ url: 'https://example.com/one' }),
      'read',
      evaluation(),
      storage,
    );
    const second = await createAttentionSession(
      capture({ url: 'https://example.com/two' }),
      'read',
      evaluation(),
      storage,
    );

    expect(first.sampledForOutcome).toBe(true);
    expect(second.sampledForOutcome).toBe(true);
  });

  it('samples low-confidence and disagreement cases', async () => {
    const storage = new MemoryStorage();
    await createAttentionSession(
      capture({ url: 'https://example.com/one' }),
      'read',
      evaluation(),
      storage,
    );
    const lowConfidence = await createAttentionSession(
      capture({ url: 'https://example.com/two' }),
      'read',
      evaluation({ confidence: 0.5 }),
      storage,
    );
    const disagreement = await createAttentionSession(
      capture({ url: 'https://example.com/three' }),
      'skim',
      evaluation({ recommendedAction: 'read' }),
      storage,
    );

    expect(lowConfidence.sampledForOutcome).toBe(true);
    expect(disagreement.sampledForOutcome).toBe(true);
  });

  it('requires both meaningful visible time and reading depth', () => {
    const base = {
      id: 'one',
      url: 'https://example.com/article',
      title: 'Article',
      decision: 'read' as const,
      scenario: 'work' as const,
      scenarioContext: {
        intent: '',
        availableMinutes: 15 as const,
        relaxIntent: null,
        desiredEffort: null,
      },
      expected: {
        analyzerId: 'local',
        recommendedAction: 'read' as const,
        expectedValue: null,
        confidence: 0.7,
        profileSignalIds: [],
        predictedUtility: 75,
        components: {
          relevance: 80,
          novelty: 70,
          actionability: 65,
          quality: 85,
        },
      },
      estimatedReadingSeconds: 600,
      startedAt: '2026-08-25T10:00:00.000Z',
      updatedAt: '2026-08-25T10:01:00.000Z',
      endedAt: null,
      visibleSeconds: 19,
      maxScrollDepth: 75 as const,
      sampledForOutcome: true,
      promptShownCount: 0,
      outcome: null,
      outcomeReason: null,
      outcomeAt: null,
    };

    expect(
      isOutcomePromptEligible(base, new Date('2026-08-25T10:02:00Z')),
    ).toBe(false);
    expect(
      isOutcomePromptEligible(
        { ...base, visibleSeconds: 20 },
        new Date('2026-08-25T10:02:00Z'),
      ),
    ).toBe(false);
    expect(
      isOutcomePromptEligible(
        { ...base, maxScrollDepth: 25, visibleSeconds: 180 },
        new Date('2026-08-25T10:03:00Z'),
      ),
    ).toBe(false);
    expect(
      isOutcomePromptEligible(
        { ...base, maxScrollDepth: 75, visibleSeconds: 180 },
        new Date('2026-08-25T10:03:00Z'),
      ),
    ).toBe(true);
  });

  it('merges progress monotonically and finds the matching prompt', async () => {
    const storage = new MemoryStorage();
    const session = await createAttentionSession(
      capture(),
      'read',
      evaluation(),
      storage,
      new Date('2026-08-25T10:00:00Z'),
    );
    await applyAttentionProgress(
      {
        sessionId: session.id,
        url: 'https://example.com/article',
        visibleSeconds: 180,
        maxScrollDepth: 75,
        ended: false,
        recordedAt: '2026-08-25T10:01:00.000Z',
      },
      storage,
    );
    await applyAttentionProgress(
      {
        sessionId: session.id,
        url: 'https://example.com/article',
        visibleSeconds: 10,
        maxScrollDepth: 25,
        ended: false,
        recordedAt: '2026-08-25T10:01:10.000Z',
      },
      storage,
    );

    const stored = await loadAttentionSessions(storage);
    expect(stored[0]).toMatchObject({
      visibleSeconds: 180,
      maxScrollDepth: 75,
    });
    const eligible = await getEligibleOutcomeSession(
      'https://example.com/article#later',
      storage,
      new Date('2026-08-25T10:03:00Z'),
    );
    expect(eligible?.id).toBe(session.id);
  });

  it('limits repeated prompts and stores an optional negative reason', async () => {
    const storage = new MemoryStorage();
    const session = await createAttentionSession(
      capture(),
      'read',
      evaluation(),
      storage,
      new Date('2026-08-25T10:00:00Z'),
    );
    await applyAttentionProgress(
      {
        sessionId: session.id,
        url: session.url,
        visibleSeconds: 120,
        maxScrollDepth: 75,
        ended: true,
        recordedAt: '2026-08-25T10:03:00.000Z',
      },
      storage,
    );
    await markOutcomePromptShown(session.id, storage);
    expect(
      await getEligibleOutcomeSession(
        session.url,
        storage,
        new Date('2026-08-25T10:04:00Z'),
      ),
    ).toBeNull();

    await recordMaterialOutcome(
      session.id,
      'no',
      storage,
      new Date('2026-08-25T10:05:00Z'),
    );
    await recordMaterialOutcomeReason(session.id, 'nothingNew', storage);
    const stored = await loadAttentionSessions(storage);
    expect(stored[0]).toMatchObject({
      outcome: 'no',
      outcomeReason: 'nothingNew',
    });
    expect(await getOutcomeStats(storage)).toEqual({
      total: 1,
      yes: 0,
      partial: 0,
      no: 1,
    });
  });

  it('cancels an unfinished session when the decision changes', async () => {
    const storage = new MemoryStorage();
    await createAttentionSession(capture(), 'read', evaluation(), storage);
    await cancelAttentionSession('https://example.com/article', storage);
    expect(storage.data[ATTENTION_SESSIONS_KEY]).toEqual([]);
  });

  it('reuses the current open session for the same material', async () => {
    const storage = new MemoryStorage();
    const session = await createAttentionSession(
      capture(),
      'read',
      evaluation(),
      storage,
    );

    expect(
      await getOpenAttentionSession(
        'https://example.com/article#another-section',
        storage,
      ),
    ).toMatchObject({ id: session.id });
  });

  it('stores one-tap feedback as raw outcome and approximate utility', async () => {
    const storage = new MemoryStorage();
    const session = await createAttentionSession(
      capture(),
      'read',
      evaluation(),
      storage,
      new Date('2026-08-25T10:00:00Z'),
    );

    const actualUtility = await recordQuickOutcome(
      session,
      'partial',
      storage,
      new Date('2026-08-25T10:04:00Z'),
    );

    expect(actualUtility).toBe(50);
    expect(storage.data[UTILITY_FEEDBACK_KEY]).toEqual([
      expect.objectContaining({
        sessionId: session.id,
        actualUtility: 50,
        source: 'quick',
      }),
    ]);
    expect(storage.data[ATTENTION_SESSIONS_KEY]).toEqual([
      expect.objectContaining({ outcome: 'partial' }),
    ]);
    expect(storage.data[MATERIAL_MEMORY_KEY]).toEqual([
      expect.objectContaining({ actualUtility: 50 }),
    ]);
  });

  it('migrates pre-scenario reading sessions to Work without losing progress', async () => {
    const storage = new MemoryStorage();
    await createAttentionSession(
      capture(),
      'read',
      evaluation(),
      storage,
      new Date('2026-08-25T10:00:00Z'),
    );
    const legacy = structuredClone(
      storage.data[ATTENTION_SESSIONS_KEY],
    ) as Array<Record<string, unknown>>;
    const legacySession = legacy[0];
    if (!legacySession) throw new Error('Expected a stored attention session');
    delete legacySession.scenario;
    delete legacySession.scenarioContext;
    legacySession.visibleSeconds = 75;
    storage.data[ATTENTION_SESSIONS_KEY] = legacy;

    const [migrated] = await loadAttentionSessions(storage);

    expect(migrated).toMatchObject({
      scenario: 'work',
      scenarioContext: {
        intent: '',
        availableMinutes: 15,
        relaxIntent: null,
        desiredEffort: null,
      },
      visibleSeconds: 75,
    });
    expect(storage.data[ATTENTION_SESSIONS_KEY]).toEqual([
      expect.objectContaining({ scenario: 'work', visibleSeconds: 75 }),
    ]);
  });
});
