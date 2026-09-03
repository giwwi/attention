export const NOVEL_PASSAGE_HIGHLIGHTS_KEY =
  'novelPassageHighlightsEnabled' as const;

export function novelPassageHighlightsEnabled(value: unknown): boolean {
  return value === true;
}
