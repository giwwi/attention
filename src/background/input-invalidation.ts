export const ATTENTION_INPUTS_INVALIDATED_TYPE = 'ATTENTION_INPUTS/INVALIDATED';

export interface AttentionInputsInvalidatedMessage {
  type: typeof ATTENTION_INPUTS_INVALIDATED_TYPE;
  changedKeys: string[];
}

// Only inputs belong here. Evaluations, material memory, reading progress and
// diagnostics are outputs and must never trigger a recomputation loop.
const INPUT_KEYS = new Set([
  'attentionDataGeneration',
  'personalProfile',
  'attentionScenario',
  'analysisContext',
  'aiAnalyzerSettings',
  'privacySettings',
  'browserHistoryEvidence',
  'browserHistorySettings',
  'readwiseEvidence',
  'readwiseSettings',
  'obsidianSettings',
  'notionSettings',
  'novelPassageFeedback',
  'claimMemoryRevision',
  'utilityCalibration',
  'novelPassageHighlightsEnabled',
  'savedMaterials',
]);

export function changedInputKeys(
  changes: Record<string, unknown>,
  areaName: string,
): string[] {
  return areaName === 'local'
    ? Object.keys(changes).filter((key) => INPUT_KEYS.has(key))
    : [];
}

export function isAttentionInputsInvalidatedMessage(
  value: unknown,
): value is AttentionInputsInvalidatedMessage {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    item.type === ATTENTION_INPUTS_INVALIDATED_TYPE &&
    Array.isArray(item.changedKeys) &&
    item.changedKeys.every((key) => typeof key === 'string')
  );
}
