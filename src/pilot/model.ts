import type {
  MaterialDecision,
  UtilityPredictionProvenance,
} from '../shared/types';

export const PILOT_PROTOCOL_VERSION = 'work-articles-paired-v1';
export const PILOT_STORAGE_KEY = 'voluntaryPilot';
export const PILOT_TRIAL_LIMIT = 100;

export interface PilotReview {
  materialUseful: 'yes' | 'partial' | 'no';
  attentionHelpful: boolean | null;
  baselineHelpful: boolean | null;
  source: 'audit-invitation' | 'volunteered';
}

export interface PilotTrial {
  id: string;
  /** Salted participant-specific fingerprint; omitted from export. */
  materialFingerprint: string;
  scenario: 'work';
  availableMinutes: 15;
  personalContextUsed: boolean;
  baseline: { decision: MaterialDecision; decisionMs: number };
  attention: {
    recommendation: MaterialDecision;
    decision: MaterialDecision;
    decisionMs: number;
    sinceEnrollmentMs: number;
    prediction: UtilityPredictionProvenance;
  } | null;
  auditInvited: boolean;
  review: PilotReview | null;
}

export interface PilotState {
  schemaVersion: 1;
  protocolVersion: typeof PILOT_PROTOCOL_VERSION;
  participantId: string;
  enrolledAt: number;
  trials: PilotTrial[];
}

function rate(numerator: number, denominator: number) {
  return {
    numerator,
    denominator,
    rate: denominator ? numerator / denominator : null,
  };
}

export function pilotAuditInvited(trial: PilotTrial): boolean {
  return (
    trial.auditInvited &&
    trial.attention !== null &&
    (trial.baseline.decision === 'skip' ||
      trial.attention.recommendation === 'skip')
  );
}

/** Missing reviews are never counted as negative outcomes or successful skips. */
export function pilotMetrics(trials: PilotTrial[]) {
  const reviewed = trials.filter((trial) => trial.review !== null);
  const completed = trials.filter((trial) => trial.attention !== null);
  const arm = (name: 'baseline' | 'attention') => {
    const available = name === 'baseline' ? trials : completed;
    const isSkip = (trial: PilotTrial) =>
      (name === 'baseline'
        ? trial.baseline.decision
        : trial.attention?.recommendation) === 'skip';
    const skips = available.filter(isSkip);
    const checkedSkips = skips.filter((trial) => trial.review !== null);
    const helpful = available
      .map((trial) =>
        name === 'baseline'
          ? trial.review?.baselineHelpful
          : trial.review?.attentionHelpful,
      )
      .filter((value): value is boolean => typeof value === 'boolean');
    return {
      decisions: available.length,
      skipReviewCoverage: rate(checkedSkips.length, skips.length),
      // Partial usefulness also means skipping could lose something of value.
      falseSkip: rate(
        checkedSkips.filter((trial) => trial.review?.materialUseful !== 'no')
          .length,
        checkedSkips.length,
      ),
      usefulRecommendations: rate(
        helpful.filter(Boolean).length,
        helpful.length,
      ),
      helpfulnessCoverage: rate(helpful.length, available.length),
    };
  };
  const firstUseful = completed
    .filter((trial) => trial.review?.attentionHelpful === true)
    .map((trial) => trial.attention!.sinceEnrollmentMs);
  return {
    trials: trials.length,
    reviewCoverage: rate(reviewed.length, trials.length),
    baseline: arm('baseline'),
    attention: arm('attention'),
    timeToFirstUsefulDecisionMs: firstUseful.length
      ? Math.min(...firstUseful)
      : null,
    auditInvitations: trials.filter(pilotAuditInvited).length,
    completedAudits: reviewed.filter(
      (trial) => trial.review?.source === 'audit-invitation',
    ).length,
  };
}

/** Deliberate allowlist: no URL, title, goal, article, profile or stable content hash. */
export function exportPilot(state: PilotState) {
  return {
    schemaVersion: state.schemaVersion,
    protocolVersion: state.protocolVersion,
    participantId: state.participantId,
    kind: 'voluntary-human-pilot' as const,
    limitations: [
      'paired-baseline-first; not a randomized causal study',
      'voluntary reviews; inspect coverage and skipped-material audits',
    ],
    trials: state.trials.map((trial) => ({
      id: trial.id,
      scenario: trial.scenario,
      availableMinutes: trial.availableMinutes,
      personalContextUsed: trial.personalContextUsed,
      baseline: {
        decision: trial.baseline.decision,
        decisionMs: trial.baseline.decisionMs,
      },
      attention: trial.attention
        ? {
            recommendation: trial.attention.recommendation,
            decision: trial.attention.decision,
            decisionMs: trial.attention.decisionMs,
            sinceEnrollmentMs: trial.attention.sinceEnrollmentMs,
            prediction: {
              schemaVersion: trial.attention.prediction.schemaVersion,
              rawUtility: trial.attention.prediction.rawUtility,
              displayedUtility: trial.attention.prediction.displayedUtility,
              scenario: trial.attention.prediction.scenario,
              analyzerVersion: trial.attention.prediction.analyzerVersion,
              rawScoreVersion: trial.attention.prediction.rawScoreVersion,
              calibrationVersion: trial.attention.prediction.calibrationVersion,
              calibrationModelUpdatedAt: null,
              calibrationSampleSize:
                trial.attention.prediction.calibrationSampleSize,
              provenance: trial.attention.prediction.provenance,
            },
          }
        : null,
      auditInvited: trial.auditInvited,
      review: trial.review
        ? {
            materialUseful: trial.review.materialUseful,
            attentionHelpful: trial.review.attentionHelpful,
            baselineHelpful: trial.review.baselineHelpful,
            source: trial.review.source,
          }
        : null,
    })),
    metrics: pilotMetrics(state.trials),
  };
}
