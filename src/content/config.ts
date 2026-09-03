/** Tunable limits for page extraction. */
export const EXTRACTION_CONFIG = {
  wordsPerMinute: 220,
  maximumHeadings: 12,
  readabilityCharacterThreshold: 140,
  readabilityMaximumElements: 50_000,
  minimumReadableArticleCharacters: 140,
} as const;

/** Tunable responsiveness and payload limits for hover previews. */
export const HOVER_PREVIEW_CONFIG = {
  feedDelayMs: 420,
  currentPageDelayMs: 120,
  maximumSnippetCharacters: 420,
  maximumCardAncestors: 7,
  currentPageContentCharacters: 20_000,
  routeWatchIntervalMs: 1_500,
  hydrationRetryMs: 180,
  hydrationObservationWindowMs: 12_000,
  pointerThrottleMs: 80,
} as const;
