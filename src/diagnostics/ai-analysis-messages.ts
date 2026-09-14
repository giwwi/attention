import { DISPLAY_REASONS, type PassageDisplayTrace } from './ai-analysis-types';
export const AI_PASSAGE_DISPLAY_TYPE = 'ATTENTION_DIAGNOSTICS/PASSAGE_DISPLAY';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
export interface AiPassageDisplayMessage {
  type: typeof AI_PASSAGE_DISPLAY_TYPE;
  analysisId: string;
  url: string;
  display: PassageDisplayTrace;
}
export function isAiPassageDisplayMessage(
  value: unknown,
): value is AiPassageDisplayMessage {
  if (!value || typeof value !== 'object') return false;
  const m = value as AiPassageDisplayMessage;
  return (
    m.type === AI_PASSAGE_DISPLAY_TYPE &&
    typeof m.analysisId === 'string' &&
    uuid.test(m.analysisId) &&
    typeof m.url === 'string' &&
    m.url.length <= 4096 &&
    /^https?:\/\//u.test(m.url) &&
    !!m.display &&
    DISPLAY_REASONS.includes(m.display.reason) &&
    ['selected', 'matched', 'invalidWindows', 'overlapping', 'limited'].every(
      (key) => {
        const v = m.display[key as keyof PassageDisplayTrace];
        return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6;
      },
    ) &&
    [null, true, false].includes(m.display.fingerprintMatches) &&
    m.display.matched <= m.display.selected
  );
}
