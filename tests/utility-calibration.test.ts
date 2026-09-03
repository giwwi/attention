import { describe, expect, it } from 'vitest';
import {
  buildUtilityCalibration,
  calibrateUtilityScore,
} from '../src/utility/calibration';
import type { UtilityFeedbackRecord } from '../src/utility/storage';

function feedback(
  index: number,
  predictedUtility: number,
  actualUtility: number,
  scenario: UtilityFeedbackRecord['scenario'] = 'work',
): UtilityFeedbackRecord {
  return {
    id: `feedback-${index}`,
    sessionId: `session-${index}`,
    url: `https://example.com/${index}`,
    title: `Article ${index}`,
    predictedUtility,
    actualUtility,
    components: {
      relevance: 70,
      novelty: 60,
      actionability: 50,
      quality: 80,
    },
    evaluatedAt: `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    recordedAt: `2026-08-${String(index + 1).padStart(2, '0')}T11:00:00.000Z`,
    source: 'quick',
    scenario,
    scenarioContext: {
      intent: '',
      availableMinutes: 15,
      relaxIntent: null,
      desiredEffort: null,
    },
  };
}

describe('personal Utility calibration', () => {
  it('waits for enough feedback before changing a prediction', () => {
    const model = buildUtilityCalibration(
      Array.from({ length: 4 }, (_, index) => feedback(index, 80, 55)),
    );
    expect(calibrateUtilityScore(80, 'work', model)).toBe(80);
  });

  it('learns a conservative per-scenario correction', () => {
    const model = buildUtilityCalibration(
      Array.from({ length: 6 }, (_, index) =>
        feedback(index, 72 + index, 52 + index, 'work'),
      ),
    );
    const calibrated = calibrateUtilityScore(80, 'work', model);
    expect(calibrated).toBeLessThan(80);
    expect(calibrated).toBeGreaterThanOrEqual(65);
    expect(calibrateUtilityScore(80, 'relax', model)).toBe(80);
  });
});
