import type { PersonalizationSignal } from '../shared/types';

/**
 * Browser history is a fallback taste model for Relax. It may tell us what the
 * user repeatedly chooses, but it must never be treated as confirmed knowledge
 * or as stronger evidence than an explicit matching leisure preference.
 */
export const RELAX_HISTORY_FALLBACK = {
  minimumUsefulStrength: 0.16,
  maximumTasteFit: 74,
  tasteLift: 100,
  maximumPreviewStrength: 0.62,
  topicPreviewMultiplier: 2.6,
  sourcePreviewMultiplier: 1.2,
  topicRankMultiplier: 2.4,
  sourceRankMultiplier: 1.8,
  confidenceCap: 0.62,
} as const;

export function hasRelevantLeisurePreference(
  signals: PersonalizationSignal[],
): boolean {
  return signals.some(
    (signal) =>
      signal.kind === 'leisurePreference' &&
      signal.effect !== 'neutral' &&
      signal.matchScore * signal.confidence > 0,
  );
}

export function relaxHistoryStrength(signal: PersonalizationSignal): number {
  if (signal.effect !== 'positive') return 0;
  if (signal.kind === 'historyTopic') {
    return signal.matchScore * signal.confidence;
  }
  if (signal.kind === 'historySource') {
    // A familiar source is useful evidence, but weaker than repeated topic
    // choices because one publisher may cover many unrelated subjects.
    return signal.matchScore * signal.confidence * 0.8;
  }
  return 0;
}

export function strongestRelaxHistoryStrength(
  signals: PersonalizationSignal[],
): number {
  return Math.max(0, ...signals.map(relaxHistoryStrength));
}

export function hasUsefulRelaxHistory(
  signals: PersonalizationSignal[],
): boolean {
  return (
    !hasRelevantLeisurePreference(signals) &&
    strongestRelaxHistoryStrength(signals) >=
      RELAX_HISTORY_FALLBACK.minimumUsefulStrength
  );
}

export function relaxHistoryRankMultiplier(
  signal: PersonalizationSignal,
  signals: PersonalizationSignal[],
): number {
  if (hasRelevantLeisurePreference(signals)) return 1;
  if (signal.kind === 'historyTopic') {
    return RELAX_HISTORY_FALLBACK.topicRankMultiplier;
  }
  if (signal.kind === 'historySource') {
    return RELAX_HISTORY_FALLBACK.sourceRankMultiplier;
  }
  return 1;
}

export function relaxHistoryPreviewStrength(
  signal: PersonalizationSignal | undefined,
  signals: PersonalizationSignal[],
): number | null {
  if (!signal || hasRelevantLeisurePreference(signals)) return null;
  const rawStrength = relaxHistoryStrength(signal);
  if (rawStrength < RELAX_HISTORY_FALLBACK.minimumUsefulStrength) return null;
  const multiplier =
    signal.kind === 'historyTopic'
      ? RELAX_HISTORY_FALLBACK.topicPreviewMultiplier
      : signal.kind === 'historySource'
        ? RELAX_HISTORY_FALLBACK.sourcePreviewMultiplier
        : 0;
  if (multiplier === 0) return null;
  return Math.min(
    RELAX_HISTORY_FALLBACK.maximumPreviewStrength,
    rawStrength * multiplier,
  );
}

export function relaxHistoryTasteFit(
  signals: PersonalizationSignal[],
): number | null {
  if (hasRelevantLeisurePreference(signals)) return null;
  const strength = strongestRelaxHistoryStrength(signals);
  if (strength < RELAX_HISTORY_FALLBACK.minimumUsefulStrength) return null;
  return Math.min(
    RELAX_HISTORY_FALLBACK.maximumTasteFit,
    Math.round(50 + strength * RELAX_HISTORY_FALLBACK.tasteLift),
  );
}
