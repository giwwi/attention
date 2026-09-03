/** Retention caps. They bound local storage growth without changing schemas. */
export const STORAGE_RETENTION_LIMITS = {
  attentionSessions: 100,
  outcomePromptShowsPerSession: 1,
  utilityFeedback: 200,
  materialMemory: 100,
  diagnostics: 40,
  profileImports: 20,
  profileFeedback: 200,
  novelPassageFeedback: 300,
  savedMaterials: 20,
  decisions: 100,
} as const;
