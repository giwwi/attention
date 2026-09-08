import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exportPilot,
  pilotMetrics,
  PILOT_STORAGE_KEY,
  type PilotTrial,
} from '../src/pilot/model';
import {
  enrollPilot,
  erasePilot,
  loadPilot,
  savePilotTrial,
} from '../src/pilot/storage';
import { createRawUtilityPrediction } from '../src/utility/prediction';
import { DATA_GENERATION_KEY } from '../src/privacy/data-operations';
import { DataTestStorage, installDataLocks } from './helpers/data-locks';

function trial(id: string): PilotTrial {
  return {
    id,
    materialFingerprint: `private-${id}`,
    scenario: 'work',
    availableMinutes: 15,
    personalContextUsed: false,
    baseline: { decision: 'skip', decisionMs: 2000 },
    attention: {
      recommendation: 'skip',
      decision: 'skip',
      decisionMs: 3000,
      sinceEnrollmentMs: 8000,
      prediction: createRawUtilityPrediction(35, 'work', 'test-analyzer'),
    },
    auditInvited: true,
    review: null,
  };
}

describe('voluntary local pilot', () => {
  beforeEach(installDataLocks);
  afterEach(() => vi.unstubAllGlobals());

  it('does not enroll or write without affirmative consent', async () => {
    const storage = new DataTestStorage();
    await expect(enrollPilot(false, storage.area)).rejects.toThrow('Consent');
    expect(storage.data).toEqual({});
  });

  it('reports unknown outcomes and false Skip denominators honestly', () => {
    const skipped = trial('reviewed');
    skipped.review = {
      materialUseful: 'partial',
      attentionHelpful: false,
      baselineHelpful: false,
      source: 'audit-invitation',
    };
    const useful = trial('useful');
    useful.attention!.recommendation = 'read';
    useful.attention!.decision = 'read';
    useful.attention!.sinceEnrollmentMs = 15_000;
    useful.review = {
      materialUseful: 'yes',
      attentionHelpful: true,
      baselineHelpful: null,
      source: 'volunteered',
    };
    const metrics = pilotMetrics([trial('missing'), skipped, useful]);
    expect(metrics.attention.falseSkip).toEqual({
      numerator: 1,
      denominator: 1,
      rate: 1,
    });
    expect(metrics.attention.skipReviewCoverage).toEqual({
      numerator: 1,
      denominator: 2,
      rate: 0.5,
    });
    expect(metrics.attention.usefulRecommendations.rate).toBe(0.5);
    expect(metrics.baseline.helpfulnessCoverage.denominator).toBe(3);
    expect(metrics.timeToFirstUsefulDecisionMs).toBe(15_000);
    expect(pilotMetrics([]).attention.falseSkip.rate).toBeNull();
    expect(
      pilotMetrics([trial('unknown')]).timeToFirstUsefulDecisionMs,
    ).toBeNull();
  });

  it('omits title, URL, goal, content, private fingerprints and extra fields from export', async () => {
    const storage = new DataTestStorage();
    const enrollment = await enrollPilot(true, storage.area);
    const sample = Object.assign(trial('one'), {
      url: 'https://private.example',
      title: 'Secret title',
      goal: 'Secret task',
      content: 'Secret article',
    });
    Object.assign(sample.baseline, { content: 'Secret baseline payload' });
    const state = await savePilotTrial(
      enrollment.state.participantId,
      enrollment.operation,
      sample,
      storage.area,
    );
    const exported = JSON.stringify(exportPilot(state));
    expect(exported).not.toMatch(
      /private-|Secret|private\.example|materialFingerprint/,
    );
    expect(JSON.parse(exported).trials[0].attention.prediction.rawUtility).toBe(
      35,
    );
    expect(Object.keys(storage.data)).toEqual([PILOT_STORAGE_KEY]);
  });

  it('counts only audit invitations actually shown for a Skip', () => {
    const pending = trial('pending');
    pending.attention = null;
    const read = trial('read');
    read.baseline.decision = 'read';
    read.attention!.recommendation = 'read';
    expect(pilotMetrics([pending, read]).auditInvitations).toBe(0);
    expect(pilotMetrics([trial('skip')]).auditInvitations).toBe(1);
  });

  it('withdrawal wins a pending enrollment read', async () => {
    const storage = new DataTestStorage();
    const original = storage.get.bind(storage);
    let resume!: () => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(storage, 'get').mockImplementationOnce(async (keys) => {
      started();
      await new Promise<void>((resolve) => {
        resume = resolve;
      });
      return original(keys);
    });
    const enrollment = enrollPilot(true, storage.area);
    await reading;
    const erased = erasePilot(storage.area);
    resume();
    await enrollment;
    await erased;
    expect(await loadPilot(storage.area)).toBeNull();
  });

  it('withdrawal and reenrollment invalidate unfinished writes from another page', async () => {
    const storage = new DataTestStorage();
    const old = await enrollPilot(true, storage.area);
    await erasePilot(storage.area);
    const fresh = await enrollPilot(true, storage.area);
    await expect(
      savePilotTrial(
        old.state.participantId,
        old.operation,
        trial('old'),
        storage.area,
      ),
    ).rejects.toThrow('ended');
    expect((await loadPilot(storage.area))?.participantId).toBe(
      fresh.state.participantId,
    );
    expect((await loadPilot(storage.area))?.trials).toEqual([]);
  });

  it('global data deletion wins a pending pilot write', async () => {
    const storage = new DataTestStorage();
    const active = await enrollPilot(true, storage.area);
    await storage.clear();
    await storage.set({ [DATA_GENERATION_KEY]: 'erased' });
    await expect(
      savePilotTrial(
        active.state.participantId,
        active.operation,
        trial('late'),
        storage.area,
      ),
    ).rejects.toThrow('changed');
    expect(await loadPilot(storage.area)).toBeNull();
  });

  it('rejects repeated article samples and keeps concurrent trials', async () => {
    const storage = new DataTestStorage();
    const active = await enrollPilot(true, storage.area);
    await Promise.all(
      ['a', 'b'].map((id) =>
        savePilotTrial(
          active.state.participantId,
          active.operation,
          trial(id),
          storage.area,
        ),
      ),
    );
    expect((await loadPilot(storage.area))?.trials).toHaveLength(2);
    const duplicate = trial('c');
    duplicate.materialFingerprint = 'private-a';
    await expect(
      savePilotTrial(
        active.state.participantId,
        active.operation,
        duplicate,
        storage.area,
      ),
    ).rejects.toThrow('already');
  });
});
