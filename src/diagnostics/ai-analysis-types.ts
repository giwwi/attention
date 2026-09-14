/** Fixed codes only. Never put model prose, excerpts, IDs or URLs in a report. */
export const PASSAGE_REJECTIONS = [
  'invalid-candidate',
  'passage-not-offered',
  'unsupported-passage-format',
  'prepared-context-invalid',
  'core-not-found',
  'core-not-sent',
  'invalid-query',
  'insufficient-context',
  'invalid-relevance',
  'low-relevance',
  'invalid-confidence',
  'low-confidence',
  'missing-contribution',
  'invalid-context-ids',
  'context-not-sent',
  'already-known',
  'invalid-context-window',
  'expanded-context-not-sent',
] as const;
export type PassageRejection = (typeof PASSAGE_REJECTIONS)[number];
export const RELEVANCE_INPUT_KINDS = [
  'number',
  'missing',
  'null',
  'string',
  'non-finite',
  'other',
] as const;
export interface PassageRelevanceInput {
  kind: (typeof RELEVANCE_INPUT_KINDS)[number];
  /** Original numeric value, only within the two supported score ranges. Never raw strings. */
  value: number | null;
  scale: 'unit' | 'percent' | 'invalid';
}
export interface PassageValidationTrace {
  index: number;
  accepted: boolean;
  relevance: number | null;
  /** Absent on reports created before 0.28.3. relevance above is always normalized to 0–1. */
  relevanceInput?: PassageRelevanceInput;
  confidence: number | null;
  reasons: PassageRejection[];
}
export const DISPLAY_REASONS = [
  'matched',
  'no-selection',
  'highlights-disabled',
  'article-root-not-found',
  'fingerprint-changed',
  'no-dom-matches',
] as const;
export interface PassageDisplayTrace {
  reason: (typeof DISPLAY_REASONS)[number];
  selected: number;
  matched: number;
  invalidWindows: number;
  overlapping: number;
  limited: number;
  fingerprintMatches: boolean | null;
}
export interface AiAnalysisDiagnostic {
  schemaVersion: 1;
  analysisId: string;
  at: string;
  version: string;
  model: string;
  status: 'started' | 'complete' | 'failed';
  stage: 'request' | 'response' | 'validation' | 'evaluation' | 'complete';
  errorCategory: string | null;
  input: {
    articleBlocks: number;
    sentBlocks: number;
    sentCharacters: number;
    /** Number of whole windows offered to the model (since 0.28.4). */
    offeredPassages?: number;
    queries: number;
    knowledgeSignals: number;
    coverage: 'complete' | 'partial';
  };
  output: {
    returned: number | null;
    inspected: number;
    overLimit: number;
    accepted: number;
    selected: number;
    mergedOrLimited: number;
    candidates: PassageValidationTrace[];
  };
  display: PassageDisplayTrace | null;
}

export function emptyDisplayTrace(selected: number): PassageDisplayTrace {
  return {
    reason: selected ? 'no-dom-matches' : 'no-selection',
    selected,
    matched: 0,
    invalidWindows: 0,
    overlapping: 0,
    limited: 0,
    fingerprintMatches: null,
  };
}
