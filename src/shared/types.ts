export interface PageStructureSignals {
  paragraphCount: number;
  headingCount: number;
  linkCount: number;
  citationLinkCount: number;
  quoteCount: number;
  listItemCount: number;
  tableCount: number;
}

export interface PageCapture {
  title: string;
  url: string;
  content: string;
  excerpt: string;
  byline: string | null;
  siteName: string;
  publishedTime: string | null;
  language: string | null;
  wordCount: number;
  readingTimeMinutes: number;
  headings: string[];
  isArticle: boolean;
  extractionMethod: 'readability' | 'semantic' | 'visible-text';
  structure?: PageStructureSignals;
  capturedAt: string;
}

export type MaterialDecision = 'read' | 'skim' | 'save' | 'skip';
export type AvailableMinutes = 5 | 15 | 30;

export type AttentionScenario = 'work' | 'learn' | 'explore' | 'relax';
export type ScenarioSource = 'default' | 'manual' | 'suggested-confirmed';
export type CognitiveEffort = 'low' | 'medium' | 'high';
export type RelaxIntent =
  'chill' | 'funny' | 'interesting' | 'exciting' | 'familiar' | 'surprise';

export interface ScenarioState {
  scenario: AttentionScenario;
  scenarioUpdatedAt: string;
  scenarioSource: ScenarioSource;
  relaxIntent: RelaxIntent | null;
  desiredEffort: CognitiveEffort | null;
  leisureFormats: string[];
}

export interface AnalysisContext {
  intent: string;
  availableMinutes: AvailableMinutes;
  scenario: AttentionScenario;
  relaxIntent?: RelaxIntent | null;
  desiredEffort?: CognitiveEffort | null;
  leisureFormats?: string[];
}

export type PersonalizationSignalKind =
  | 'interest'
  | 'goal'
  | 'expertise'
  | 'learningArea'
  | 'leisurePreference'
  | 'lowValueTopic'
  | 'contentPreference'
  | 'historyTopic'
  | 'historySource';

export interface PersonalizationSignal {
  id: string;
  profileEntryId: string | null;
  kind: PersonalizationSignalKind;
  effect: 'positive' | 'negative' | 'neutral';
  label: string;
  explanation: string;
  confidence: number;
  matchScore: number;
}

export interface RelevantProfileContext {
  profileUpdatedAt: string;
  signals: PersonalizationSignal[];
  knowledgeSignals?: RelevantKnowledgeSignal[];
  historyEvidence?: RelevantHistoryEvidence;
  /** Local-only evidence. It must not be serialized into cloud requests. */
  readwiseEvidence?: RelevantReadwiseEvidence;
  /** Local-only evidence. Vault text must never be serialized into cloud requests. */
  obsidianEvidence?: RelevantObsidianEvidence;
  /** Local-only evidence. Notion text must never be serialized into cloud requests. */
  notionEvidence?: RelevantNotionEvidence;
  /** Local-only direct feedback about previously seen claims. */
  claimMemoryEvidence?: RelevantClaimMemoryEvidence;
  /** Local-only, deduplicated connector evidence used by novelty scoring. */
  unifiedLocalEvidence?: UnifiedLocalEvidence;
}

export interface RelevantHistoryEvidence {
  exactPageEncountered: boolean;
  encounteredProbability: number;
  topicFamiliarity: number;
  interestConfidence: number;
  matchingTopics: string[];
  matchingSources: string[];
  evidenceUpdatedAt: string;
}

export interface RelevantReadwiseHighlight {
  id: string;
  sourceId?: string;
  sourceTitle: string;
  excerpt: string;
  notePresent: boolean;
  tags: string[];
  attentionStrength: number;
  matchScore: number;
  materialKey?: string;
  exactSource?: boolean;
}

export interface RelevantReadwiseSource {
  id: string;
  title: string;
  materialKey: string;
}

export interface RelevantReadwiseEvidence {
  exactSourceMatched: boolean;
  matchingSourceCount: number;
  matchingHighlightCount: number;
  familiarityConfidence: number;
  matchingHighlights: RelevantReadwiseHighlight[];
  exactSources?: RelevantReadwiseSource[];
  evidenceUpdatedAt: string;
}

export type ObsidianEvidenceKind = 'own-note' | 'quote' | 'imported';

export interface RelevantObsidianFragment {
  id: string;
  notePath?: string;
  noteTitle: string;
  heading: string | null;
  excerpt: string;
  kind: ObsidianEvidenceKind;
  attentionStrength: number;
  matchScore: number;
  materialKey?: string;
  exactSource?: boolean;
}

export interface RelevantObsidianEvidence {
  matchingNoteCount: number;
  matchingFragmentCount: number;
  familiarityConfidence: number;
  matchingFragments: RelevantObsidianFragment[];
  evidenceUpdatedAt: string;
}

export interface RelevantNotionFragment {
  id: string;
  pageId?: string;
  pageTitle: string;
  heading: string | null;
  excerpt: string;
  kind: ObsidianEvidenceKind;
  attentionStrength: number;
  matchScore: number;
  materialKey?: string;
  exactSource?: boolean;
}

export interface RelevantNotionPage {
  id: string;
  title: string;
  materialKey: string;
}

export interface RelevantNotionEvidence {
  exactSourceMatched: boolean;
  matchingPageCount: number;
  matchingFragmentCount: number;
  familiarityConfidence: number;
  matchingFragments: RelevantNotionFragment[];
  exactPages?: RelevantNotionPage[];
  evidenceUpdatedAt: string;
}

export type LocalEvidenceSource = 'readwise' | 'obsidian' | 'notion';
export type LocalEvidenceKind =
  | 'own-note'
  | 'annotated-highlight'
  | 'highlight'
  | 'quote'
  | 'imported'
  | 'saved-source';

export interface UnifiedLocalEvidenceItem {
  id: string;
  source: LocalEvidenceSource;
  sources: LocalEvidenceSource[];
  documentId: string;
  materialKey: string;
  title: string;
  heading: string | null;
  excerpt: string;
  kind: LocalEvidenceKind;
  attentionStrength: number;
  matchScore: number;
  exactSource: boolean;
  updatedAt: string;
}

export interface UnifiedLocalEvidence {
  items: UnifiedLocalEvidenceItem[];
  materialCount: number;
  evidenceUpdatedAt: string;
}

export interface RelevantClaimMemoryMatch {
  id: string;
  url: string;
  claim: string;
  excerpt: string;
  value: 'known' | 'new';
  matchScore: number;
  exactPage: boolean;
  createdAt: string;
}

export interface RelevantClaimMemoryEvidence {
  matches: RelevantClaimMemoryMatch[];
  evidenceUpdatedAt: string;
}

export type RelevantKnowledgeKind = 'known' | 'learning' | 'uncertain';
export type RelevantKnowledgeEvidence =
  'demonstrated' | 'explicitly_stated' | 'inferred' | null;

export interface RelevantKnowledgeSignal {
  id: string;
  profileEntryId: string;
  kind: RelevantKnowledgeKind;
  topic: string;
  statement: string;
  evidenceType: RelevantKnowledgeEvidence;
  confidence: number;
  matchScore: number;
}

export type ClaimType =
  'thesis' | 'fact' | 'mechanism' | 'evidence' | 'recommendation' | 'forecast';
export type ClaimImportance = 'primary' | 'supporting';
export type ClaimNovelty =
  'known' | 'partially-known' | 'likely-new' | 'uncertain';

export interface KeyClaimAssessment {
  claim: string;
  /** Exact sentence from the analyzed material used only as a DOM anchor. */
  sourceExcerpt?: string;
  type: ClaimType;
  importance: ClaimImportance;
  novelty: ClaimNovelty;
  knownProbability: number;
  reason: string;
  confidence: number;
}

export interface QualityBreakdown {
  evidence: number;
  reasoning: number;
  specificity: number;
  calibration: number;
}

export type AssessmentReliabilityLevel = 'high' | 'medium' | 'low';

export interface AssessmentReliability {
  heuristicLanguage: string | null;
  languageSupported: boolean;
  extractionConfidence: number;
  overallConfidence: number;
  level: AssessmentReliabilityLevel;
  weakExtraction: boolean;
}

export interface MaterialEvaluationInsights {
  keyClaims: KeyClaimAssessment[];
  likelyNewClaims: string[];
  familiarClaims: string[];
  noveltySummary: string;
  noveltyConfidence: number;
  qualityBreakdown: QualityBreakdown;
  qualitySummary: string;
  qualityStrengths: string[];
  qualityLimitations: string[];
  qualityConfidence: number;
  reliability?: AssessmentReliability;
}

export type ProfileFeedbackType =
  'affirmSignal' | 'ignoreSignal' | 'wrongRecommendation';

export interface MaterialEvaluation {
  scenario: AttentionScenario;
  suggestedScenario?: AttentionScenario;
  recommendedAction: MaterialDecision;
  utilityScore: number;
  components: {
    relevance: number;
    novelty: number;
    actionability: number;
    quality: number;
  };
  scenarioSignals: ScenarioUtilitySignals;
  estimatedUsefulMinutes: number;
  reason: string;
  expectedValue: string;
  recommendedSections: string[];
  profileSignals: PersonalizationSignal[];
  insights?: MaterialEvaluationInsights;
  confidence: number;
  analyzerId: string;
  analyzedAt: string;
}

export interface ScenarioUtilitySignals {
  relevance: number;
  novelty: number;
  quality: number;
  actionability: number;
  knowledgeFit: number;
  timeFit: number;
  effortFit: number;
  tasteFit: number;
  serendipity: number;
  enjoymentFit: number;
}

export interface StoredEvaluation {
  url: string;
  context: AnalysisContext;
  evaluation: MaterialEvaluation;
  cacheVersion?: EvaluationCacheVersion;
}

export interface EvaluationCacheVersion {
  schemaVersion: 4;
  profile: string;
  history: string;
  readwise: string;
  obsidian: string;
  notion: string;
  claimMemory: string;
  utilityCalibration: string;
  articleText: string;
  analysisContext: string;
}

export interface DecisionRecord {
  url: string;
  title: string;
  decision: MaterialDecision;
  decidedAt: string;
}

export interface SavedMaterial {
  capture: PageCapture;
  savedAt: string;
}

export type ScrollDepth = 0 | 25 | 50 | 75 | 100;
export type MaterialOutcome = 'yes' | 'partial' | 'no';
export const QUICK_UTILITY_BY_OUTCOME: Record<MaterialOutcome, number> = {
  yes: 85,
  partial: 50,
  no: 15,
};
export type MaterialOutcomeReason =
  'nothingNew' | 'goalMismatch' | 'tooShallow' | 'tooDifficult' | 'poorQuality';

export interface ExpectedMaterialOutcome {
  analyzerId: string | null;
  recommendedAction: MaterialDecision | null;
  expectedValue: string | null;
  confidence: number | null;
  profileSignalIds: string[];
  predictedUtility: number | null;
  components: MaterialEvaluation['components'] | null;
}

export interface AttentionSessionRecord {
  id: string;
  url: string;
  title: string;
  decision: Extract<MaterialDecision, 'read' | 'skim'>;
  scenario: AttentionScenario;
  scenarioContext: Pick<
    AnalysisContext,
    'intent' | 'availableMinutes' | 'relaxIntent' | 'desiredEffort'
  >;
  expected: ExpectedMaterialOutcome;
  estimatedReadingSeconds: number;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  visibleSeconds: number;
  maxScrollDepth: ScrollDepth;
  sampledForOutcome: boolean;
  promptShownCount: number;
  outcome: MaterialOutcome | null;
  outcomeReason: MaterialOutcomeReason | null;
  outcomeAt: string | null;
}

export const ATTENTION_SESSION_START_TYPE = 'ATTENTION_SESSION/START';
export const ATTENTION_SESSION_AUTO_START_TYPE = 'ATTENTION_SESSION/AUTO_START';
export const ATTENTION_SESSION_STOP_TYPE = 'ATTENTION_SESSION/STOP';
export const ATTENTION_SESSION_PROGRESS_TYPE = 'ATTENTION_SESSION/PROGRESS';
export const ATTENTION_SESSION_GET_PROGRESS_TYPE =
  'ATTENTION_SESSION/GET_PROGRESS';

export interface AttentionSessionDescriptor {
  sessionId: string;
  url: string;
  decision: Extract<MaterialDecision, 'read' | 'skim'>;
  estimatedReadingSeconds: number;
  sampledForOutcome: boolean;
  promptShownCount: number;
}

export interface AttentionSessionStartMessage extends AttentionSessionDescriptor {
  type: typeof ATTENTION_SESSION_START_TYPE;
}

export interface AttentionSessionAutoStartMessage {
  type: typeof ATTENTION_SESSION_AUTO_START_TYPE;
  capture: PageCapture;
}

export interface AttentionSessionAutoStartResponse {
  ok: true;
  session: AttentionSessionDescriptor;
}

export interface AttentionSessionStopMessage {
  type: typeof ATTENTION_SESSION_STOP_TYPE;
  url: string;
}

export interface AttentionSessionProgress {
  sessionId: string;
  url: string;
  visibleSeconds: number;
  maxScrollDepth: ScrollDepth;
  ended: boolean;
  recordedAt: string;
}

export interface AttentionSessionProgressMessage extends AttentionSessionProgress {
  type: typeof ATTENTION_SESSION_PROGRESS_TYPE;
}

export interface AttentionSessionGetProgressMessage {
  type: typeof ATTENTION_SESSION_GET_PROGRESS_TYPE;
}

export interface AttentionSessionProgressResponse {
  ok: true;
  progress: AttentionSessionProgress | null;
}

export const ATTENTION_OUTCOME_PROMPT_SHOWN_TYPE =
  'ATTENTION_OUTCOME/PROMPT_SHOWN';
export const ATTENTION_OUTCOME_SUBMIT_TYPE = 'ATTENTION_OUTCOME/SUBMIT';

export interface AttentionOutcomePromptShownMessage {
  type: typeof ATTENTION_OUTCOME_PROMPT_SHOWN_TYPE;
  sessionId: string;
  url: string;
}

export interface AttentionOutcomeSubmitMessage {
  type: typeof ATTENTION_OUTCOME_SUBMIT_TYPE;
  sessionId: string;
  url: string;
  outcome: MaterialOutcome;
}

export interface AttentionOutcomeSubmitResponse {
  ok: boolean;
}

export interface CaptureResponse {
  ok: true;
  capture: PageCapture;
}

export const CAPTURE_MESSAGE_TYPE = 'PAGE_CAPTURE/CAPTURE';
export const SCROLL_TO_HEADING_MESSAGE_TYPE = 'PAGE_CAPTURE/SCROLL_TO_HEADING';

export interface CaptureMessage {
  type: typeof CAPTURE_MESSAGE_TYPE;
}

export interface ScrollToHeadingMessage {
  type: typeof SCROLL_TO_HEADING_MESSAGE_TYPE;
  heading: string;
}

export interface ScrollToHeadingResponse {
  ok: true;
  found: boolean;
}

export const CONTENT_RUNTIME_PING_TYPE = 'ATTENTION_RUNTIME/PING';

export interface ContentRuntimePingMessage {
  type: typeof CONTENT_RUNTIME_PING_TYPE;
}

export interface ContentRuntimePingResponse {
  ok: true;
  version: string;
}

export const UI_LANGUAGE_GET_TYPE = 'ATTENTION_UI/LANGUAGE_GET';
export const UI_LANGUAGE_CHANGED_TYPE = 'ATTENTION_UI/LANGUAGE_CHANGED';

export interface UiLanguageGetMessage {
  type: typeof UI_LANGUAGE_GET_TYPE;
}

export interface UiLanguageChangedMessage {
  type: typeof UI_LANGUAGE_CHANGED_TYPE;
  language: import('../i18n/ui').UiLanguage;
}

export interface UiLanguageResponse {
  ok: true;
  language: import('../i18n/ui').UiLanguage;
}

export const HOVER_PREVIEW_REQUEST_TYPE = 'ATTENTION_PREVIEW/REQUEST';

export interface HoverPreviewRequest {
  type: typeof HOVER_PREVIEW_REQUEST_TYPE;
  url: string;
  title: string;
  snippet: string;
  capture?: PageCapture;
  analysisMode?: 'local' | 'ai';
}

export type HoverPreviewAction = 'open' | 'maybe' | 'save' | 'skip';
export type HoverPreviewConfidence = 'low' | 'medium' | 'high';
export type HoverPreviewVerdict = 'read' | 'maybe' | 'skip';

export interface HoverPreview {
  scenario: AttentionScenario;
  suggestedScenario?: AttentionScenario;
  utilityScore: number | null;
  recommendedAction: HoverPreviewAction;
  reason: string;
  expectedValue: string;
  risk: string;
  confidence: HoverPreviewConfidence;
  source: 'full-analysis' | 'title-preview';
  signalIds: string[];
  calibrationSampleSize: number;
  components?: MaterialEvaluation['components'];
  scenarioSignals?: ScenarioUtilitySignals;
  estimatedUsefulMinutes?: number;
  recommendedSections?: string[];
  insights?: MaterialEvaluationInsights;
}

export interface HoverPreviewResponse {
  ok: true;
  preview: HoverPreview;
  saved?: boolean;
  novelPassageHighlightsEnabled?: boolean;
  readwiseConnected?: boolean;
  analysisSource?: 'local' | 'ai';
  aiState?: 'ready' | 'not-connected' | 'local-only' | 'error';
}

export const SAVE_MATERIAL_REQUEST_TYPE = 'ATTENTION_MATERIAL/SAVE';

export interface SaveMaterialRequest {
  type: typeof SAVE_MATERIAL_REQUEST_TYPE;
  capture: PageCapture;
}

export interface SaveMaterialResponse {
  ok: boolean;
  savedCount?: number;
}

export const HOVER_PREVIEW_EVENT_TYPE = 'ATTENTION_PREVIEW/EVENT';

export interface HoverPreviewEventMessage {
  type: typeof HOVER_PREVIEW_EVENT_TYPE;
  event: 'shown' | 'opened';
  scenario: AttentionScenario;
  url: string;
  title: string;
  verdict: HoverPreviewVerdict;
  recommendedAction: HoverPreviewAction;
  source: HoverPreview['source'];
  signalIds: string[];
  occurredAt: string;
}
