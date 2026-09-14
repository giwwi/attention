import type { PassageRelevanceInput } from '../diagnostics/ai-analysis-types';

export type PassageRelevanceScale = 'unit' | 'percent';

/** The contract is 0–1. Some providers still emit article-scale scores (0–100).
 * Infer once for the inspected batch, so a score of 1 alongside 95 means 1%,
 * not perfect relevance. Mixed scales are interpreted conservatively. */
export function passageRelevanceScale(
  values: unknown[],
): PassageRelevanceScale {
  return values.some(
    (value) =>
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 1 &&
      value <= 100,
  )
    ? 'percent'
    : 'unit';
}

export function inspectPassageRelevance(
  value: unknown,
  scale: PassageRelevanceScale,
): {
  relevance: number | null;
  input: PassageRelevanceInput;
} {
  const kind: PassageRelevanceInput['kind'] =
    value === undefined
      ? 'missing'
      : value === null
        ? 'null'
        : typeof value === 'string'
          ? 'string'
          : typeof value === 'number'
            ? Number.isFinite(value)
              ? 'number'
              : 'non-finite'
            : 'other';
  const valid =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= (scale === 'percent' ? 100 : 1);
  return {
    relevance: valid ? value / (scale === 'percent' ? 100 : 1) : null,
    input: {
      kind,
      value: valid ? value : null,
      scale: valid ? scale : 'invalid',
    },
  };
}
