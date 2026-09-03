import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOVER_CALIBRATION,
  MATERIAL_MEMORY_KEY,
  canonicalMaterialUrl,
  deriveHoverCalibration,
  loadMaterialMemory,
  recordHoverPreviewEvent,
  recordMaterialActualUtility,
  recordMaterialDecision,
  recordMaterialEvaluation,
  type MaterialMemoryRecord,
} from '../src/memory/material-memory';
import type { StoredEvaluation } from '../src/shared/types';

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

function evaluation(url: string): StoredEvaluation {
  return {
    url,
    context: {
      intent: 'Find practical research',
      availableMinutes: 15,
      scenario: 'work',
    },
    evaluation: {
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
      reason: 'Useful for the active goal.',
      expectedValue: 'A practical framework.',
      recommendedSections: [],
      profileSignals: [],
      confidence: 0.8,
      analyzerId: 'ai-test-v1',
      analyzedAt: '2026-08-25T10:10:00.000Z',
    },
  };
}

function confirmedRecord(
  index: number,
  verdict: 'read' | 'skip',
  actualUtility: number,
): MaterialMemoryRecord {
  return {
    url: `https://example.com/article-${index}`,
    title: `Article ${index}`,
    preview: {
      scenario: 'work',
      verdict,
      recommendedAction: verdict === 'read' ? 'open' : 'skip',
      source: 'title-preview',
      signalIds: [],
      shownCount: 1,
      openedCount: 1,
      lastShownAt: '2026-08-25T10:00:00.000Z',
      lastOpenedAt: '2026-08-25T10:01:00.000Z',
    },
    storedEvaluation: null,
    decision: null,
    actualUtility,
    actualUtilityScenario: 'work',
    actualUtilityAt: '2026-08-25T10:20:00.000Z',
    updatedAt: '2026-08-25T10:20:00.000Z',
  };
}

describe('material memory', () => {
  it('links preview, opening, evaluation, decision and actual utility by URL', async () => {
    const storage = new MemoryStorage();
    const rawUrl =
      'https://example.com/research?utm_source=newsletter&id=7#results';
    const canonicalUrl = 'https://example.com/research?id=7';
    const shown = {
      type: 'ATTENTION_PREVIEW/EVENT' as const,
      url: rawUrl,
      title: 'Rigorous research methods',
      verdict: 'read' as const,
      recommendedAction: 'open' as const,
      source: 'title-preview' as const,
      scenario: 'work' as const,
      signalIds: ['goal:research'],
      occurredAt: '2026-08-25T10:00:00.000Z',
    };

    await recordHoverPreviewEvent({ ...shown, event: 'shown' }, storage);
    await recordHoverPreviewEvent(
      {
        ...shown,
        event: 'opened',
        occurredAt: '2026-08-25T10:01:00.000Z',
      },
      storage,
    );
    await recordMaterialEvaluation(
      evaluation(canonicalUrl),
      shown.title,
      storage,
    );
    await recordMaterialDecision(
      {
        url: canonicalUrl,
        title: shown.title,
        decision: 'read',
        decidedAt: '2026-08-25T10:11:00.000Z',
      },
      storage,
    );
    await recordMaterialActualUtility(
      canonicalUrl,
      shown.title,
      88,
      '2026-08-25T10:20:00.000Z',
      storage,
    );

    const records = await loadMaterialMemory(storage);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      url: canonicalUrl,
      actualUtility: 88,
      preview: { shownCount: 1, openedCount: 1, verdict: 'read' },
      decision: { decision: 'read' },
      storedEvaluation: { evaluation: { utilityScore: 82 } },
    });
  });

  it('removes tracking parameters when canonicalizing URLs', () => {
    expect(
      canonicalMaterialUrl(
        'https://example.com/post?utm_medium=email&b=2&a=1#section',
      ),
    ).toBe('https://example.com/post?a=1&b=2');
  });

  it('keeps the preliminary verdict when a later full-analysis hover is shown', async () => {
    const storage = new MemoryStorage();
    const base = {
      type: 'ATTENTION_PREVIEW/EVENT' as const,
      event: 'shown' as const,
      url: 'https://example.com/article',
      title: 'An article worth checking',
      scenario: 'work' as const,
      occurredAt: '2026-08-25T10:00:00.000Z',
    };
    await recordHoverPreviewEvent(
      {
        ...base,
        verdict: 'skip',
        recommendedAction: 'skip',
        source: 'title-preview',
        signalIds: ['lowValueTopic:generic'],
      },
      storage,
    );
    await recordHoverPreviewEvent(
      {
        ...base,
        verdict: 'read',
        recommendedAction: 'open',
        source: 'full-analysis',
        signalIds: ['goal:research'],
        occurredAt: '2026-08-25T10:30:00.000Z',
      },
      storage,
    );

    const records = await loadMaterialMemory(storage);
    expect(records[0]?.preview).toMatchObject({
      verdict: 'skip',
      source: 'title-preview',
      signalIds: ['lowValueTopic:generic'],
      shownCount: 2,
    });
  });

  it('does not calibrate before five confirmed materials', () => {
    const calibration = deriveHoverCalibration([
      confirmedRecord(1, 'read', 30),
      confirmedRecord(2, 'skip', 90),
    ]);

    expect(calibration).toEqual({
      ...DEFAULT_HOVER_CALIBRATION,
      sampleSize: 2,
    });
  });

  it('makes green and red verdicts harder after repeated errors', () => {
    const calibration = deriveHoverCalibration([
      confirmedRecord(1, 'read', 30),
      confirmedRecord(2, 'read', 45),
      confirmedRecord(3, 'read', 50),
      confirmedRecord(4, 'skip', 80),
      confirmedRecord(5, 'skip', 75),
    ]);

    expect(calibration).toMatchObject({
      sampleSize: 5,
      positiveThreshold: 0.6,
      negativeThreshold: 0.65,
    });
  });

  it('migrates pre-scenario material history to Work without losing outcomes', async () => {
    const storage = new MemoryStorage();
    const legacy = confirmedRecord(1, 'read', 88) as unknown as Record<
      string,
      unknown
    >;
    const legacyPreview = legacy.preview as Record<string, unknown>;
    delete legacyPreview.scenario;
    delete legacy.actualUtilityScenario;
    const storedEvaluation = evaluation(legacy.url as string) as unknown as {
      context: Record<string, unknown>;
      evaluation: Record<string, unknown>;
    };
    delete storedEvaluation.context.scenario;
    delete storedEvaluation.evaluation.scenario;
    delete storedEvaluation.evaluation.scenarioSignals;
    legacy.storedEvaluation = storedEvaluation;
    storage.data[MATERIAL_MEMORY_KEY] = [legacy];

    const [migrated] = await loadMaterialMemory(storage);

    expect(migrated).toMatchObject({
      actualUtility: 88,
      actualUtilityScenario: 'work',
      preview: { scenario: 'work' },
      storedEvaluation: {
        context: { scenario: 'work' },
        evaluation: {
          scenario: 'work',
          scenarioSignals: expect.objectContaining({ relevance: 91 }),
        },
      },
    });
    expect(storage.data[MATERIAL_MEMORY_KEY]).toEqual([
      expect.objectContaining({ actualUtilityScenario: 'work' }),
    ]);
  });
});
