import { describe, expect, it } from 'vitest';
import { LocalAnalyzer } from '../src/analyzer/local-analyzer';
import {
  createAttentionSession,
  loadAttentionSessions,
} from '../src/attention/storage';
import { recordQuickOutcome } from '../src/attention/quick-feedback';
import {
  createEmptyProfile,
  type LeisurePreferenceKind,
  type LeisurePreferenceLevel,
} from '../src/profile/schema';
import {
  applyScenarioOutcomeToProfileSignals,
  PERSONAL_PROFILE_KEY,
} from '../src/profile/storage';
import { loadMaterialMemory } from '../src/memory/material-memory';
import {
  buildUtilityCalibration,
  calibrateMaterialEvaluation,
  calibrateUtilityScore,
} from '../src/utility/calibration';
import {
  createRawUtilityPrediction,
  RAW_UTILITY_SCORE_VERSION,
  UTILITY_CALIBRATION_VERSION,
} from '../src/utility/prediction';
import {
  loadUtilityCalibration,
  loadUtilityFeedback,
  recordActualUtility,
  type UtilityFeedbackRecord,
} from '../src/utility/storage';
import type { AttentionScenario, PageCapture } from '../src/shared/types';

class MemoryStorage {
  data: Record<string, unknown> = {};
  async get() {
    return structuredClone(this.data);
  }
  async set(items: Record<string, unknown>) {
    Object.assign(this.data, structuredClone(items));
  }
}

function feedback(
  index: number,
  raw = 80,
  display = 80,
  actual = 20,
  scenario: AttentionScenario = 'work',
): UtilityFeedbackRecord {
  return {
    id: `f-${index}`,
    sessionId: `s-${index}`,
    url: `https://example.com/${index}`,
    title: 'Article',
    predictedUtility: display,
    prediction: {
      ...createRawUtilityPrediction(raw, scenario, 'local-test-v1'),
      displayedUtility: display,
    },
    actualUtility: actual,
    components: { relevance: 80, novelty: 80, actionability: 80, quality: 80 },
    evaluatedAt: '2026-09-05T10:00:00.000Z',
    recordedAt: `2026-09-05T10:${String(index).padStart(2, '0')}:00.000Z`,
    source: 'quick',
    scenario,
    scenarioContext: { intent: '', availableMinutes: 15 },
  };
}
const material: PageCapture = {
  title: 'Technical evidence',
  url: 'https://example.com/technical',
  content:
    'A careful technical analysis with evidence and practical methods. '.repeat(
      100,
    ),
  excerpt: 'Technical evidence',
  byline: null,
  siteName: 'Example',
  publishedTime: null,
  language: 'en',
  wordCount: 1000,
  readingTimeMinutes: 5,
  headings: ['Evidence'],
  isArticle: true,
  extractionMethod: 'semantic',
  capturedAt: '2026-09-05T10:00:00.000Z',
};
const context = {
  scenario: 'work' as const,
  intent: 'technical evidence',
  availableMinutes: 15 as const,
};

describe('calibration provenance and isolation', () => {
  it('never uses eight negative Work outcomes as Relax/Learn/Explore evidence', () => {
    const model = buildUtilityCalibration(
      Array.from({ length: 8 }, (_, i) => feedback(i)),
    );
    expect(model.global).not.toBeNull();
    expect(calibrateUtilityScore(80, 'work', model)).toBeLessThan(80);
    for (const scenario of ['relax', 'learn', 'explore'] as const)
      expect(calibrateUtilityScore(80, scenario, model)).toBe(80);
  });

  it('fits raw errors even when readers saw previously corrected scores', () => {
    const raw = buildUtilityCalibration(
      Array.from({ length: 8 }, (_, i) => feedback(i, 80, 80, 60)),
    );
    const corrected = buildUtilityCalibration(
      Array.from({ length: 8 }, (_, i) => feedback(i, 80, 65, 60)),
    );
    expect(corrected.byScenario.work).toEqual(raw.byScenario.work);
    expect(corrected.byScenario.work?.meanPredicted).toBe(80);
  });

  it('excludes unknown raw scores and incompatible scoring policies from training', () => {
    const records = Array.from({ length: 8 }, (_, i) => ({
      ...feedback(i),
      prediction: undefined,
    }));
    const incompatible = Array.from({ length: 8 }, (_, i) => {
      const record = feedback(i + 8);
      record.prediction!.rawScoreVersion = 'future-incompatible-policy';
      return record;
    });
    const unattributed = Array.from({ length: 8 }, (_, i) => ({
      ...feedback(i + 16),
      source: 'legacy-unknown' as const,
    }));
    const model = buildUtilityCalibration([
      ...records,
      ...incompatible,
      ...unattributed,
    ]);
    expect(model.sampleSize).toBe(0);
    expect(calibrateUtilityScore(80, 'work', model)).toBe(80);
  });

  it('preserves an analyzer hard Skip and never compounds a correction', async () => {
    const weak = await new LocalAnalyzer().analyze(
      {
        ...material,
        wordCount: 15,
        content: 'Too little article content.',
        isArticle: false,
      },
      context,
    );
    expect(weak.recommendedAction).toBe('skip');
    expect(weak.recommendationConstraint).toBe('skip');
    const model = buildUtilityCalibration(
      Array.from({ length: 8 }, (_, i) =>
        feedback(i, weak.utilityScore, weak.utilityScore, 95),
      ),
    );
    const displayed = calibrateMaterialEvaluation(weak, 1, model);
    expect(displayed.utilityScore).toBeGreaterThan(weak.utilityScore);
    expect(displayed.recommendedAction).toBe('skip');
    expect(displayed.reason).toBe(weak.reason);
    expect(calibrateMaterialEvaluation(displayed, 1, model)).toEqual(displayed);
  });

  it('leaves legacy display-only evaluations unchanged and marks their raw value unknown', async () => {
    const evaluation = await new LocalAnalyzer().analyze(material, context);
    const legacy = { ...evaluation, prediction: undefined };
    const model = buildUtilityCalibration(
      Array.from({ length: 8 }, (_, i) =>
        feedback(i, evaluation.utilityScore, evaluation.utilityScore, 0),
      ),
    );
    const result = calibrateMaterialEvaluation(legacy, 5, model);
    expect(result.utilityScore).toBe(legacy.utilityScore);
    expect(result.prediction).toMatchObject({
      rawUtility: null,
      displayedUtility: legacy.utilityScore,
      provenance: 'legacy-display-only',
    });
  });

  it('keeps raw/display versions from analysis through the reading session and explicit outcome', async () => {
    const storage = new MemoryStorage();
    const raw = await new LocalAnalyzer().analyze(material, context);
    const model = buildUtilityCalibration(
      Array.from({ length: 8 }, (_, i) =>
        feedback(i, raw.utilityScore, raw.utilityScore, 0),
      ),
    );
    const displayed = calibrateMaterialEvaluation(
      raw,
      material.readingTimeMinutes,
      model,
    );
    const session = await createAttentionSession(
      material,
      'read',
      displayed,
      storage,
      new Date('2026-09-05T10:00:00Z'),
      context,
    );
    expect(session.expected.prediction).toMatchObject({
      rawUtility: raw.utilityScore,
      displayedUtility: displayed.utilityScore,
      analyzerVersion: raw.analyzerId,
      rawScoreVersion: RAW_UTILITY_SCORE_VERSION,
      calibrationVersion: UTILITY_CALIBRATION_VERSION,
      scenario: 'work',
      provenance: 'captured',
    });
    await recordQuickOutcome(session, 'yes', storage);
    const [record] = await loadUtilityFeedback(storage);
    expect(record).toMatchObject({
      prediction: session.expected.prediction,
      source: 'quick',
      outcome: 'yes',
      scenario: 'work',
    });
    expect((await loadAttentionSessions(storage))[0]).toMatchObject({
      outcome: 'yes',
      outcomeSource: 'quick',
    });
    expect((await loadMaterialMemory(storage))[0]).toMatchObject({
      actualUtilitySource: 'quick',
      actualOutcome: 'yes',
      actualUtilityPrediction: session.expected.prediction,
    });
    const slider = await recordActualUtility(session, 90, storage);
    expect(slider).toMatchObject({
      source: 'slider',
      outcome: 'yes',
      prediction: session.expected.prediction,
    });
  });

  it('does not relabel migrated display-only history as raw or fabricate its outcome source', async () => {
    const storage = new MemoryStorage();
    storage.data.utilityFeedback = Array.from({ length: 8 }, (_, i) => ({
      ...feedback(i),
      prediction: undefined,
      source: undefined,
    }));
    storage.data.utilityCalibration = {
      schemaVersion: 1,
      updatedAt: 'old',
      sampleSize: 8,
      global: { meanPredicted: 80, meanActual: 20, slope: 1, strength: 0.8 },
      byScenario: {},
    };
    const before = structuredClone(storage.data);
    const records = await loadUtilityFeedback(storage);
    expect(records[0]).toMatchObject({
      source: 'legacy-unknown',
      prediction: { rawUtility: null, provenance: 'legacy-display-only' },
    });
    expect(await loadUtilityCalibration(storage)).toBeNull();
    expect(storage.data).toEqual(before);
  });
});

describe('direction of preference evidence', () => {
  it.each<[LeisurePreferenceKind, LeisurePreferenceLevel, number, number]>([
    ['genre', 'high', 0.85, 0.77],
    ['genre', 'medium', 0.85, 0.77],
    ['genre', 'low', 0.77, 0.85],
    ['dislike', 'high', 0.77, 0.85],
    ['dislike', 'low', 0.77, 0.85],
    ['genre', 'unknown', 0.8, 0.8],
  ])(
    '%s/%s learns from the sign of the preference',
    async (kind, preference, yesConfidence, noConfidence) => {
      for (const [outcome, expected] of [
        ['yes', yesConfidence],
        ['no', noConfidence],
      ] as const) {
        const storage = new MemoryStorage();
        const profile = createEmptyProfile();
        profile.leisureProfile.preferences = [
          {
            id: 'horror',
            kind,
            preference,
            category: 'horror',
            confidence: 0.8,
            evidenceType: 'explicitly_stated',
            basis: 'Reader preference',
            sources: [],
          },
        ];
        storage.data[PERSONAL_PROFILE_KEY] = profile;
        await applyScenarioOutcomeToProfileSignals(
          'relax',
          ['leisurePreference:horror'],
          outcome,
          storage,
        );
        expect(
          (storage.data[PERSONAL_PROFILE_KEY] as typeof profile).leisureProfile
            .preferences[0]?.confidence,
        ).toBe(expected);
      }
    },
  );
});
