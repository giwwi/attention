import {
  applyAttentionProgress,
  createAttentionSession,
  getOpenAttentionSession,
  loadAttentionSessions,
  markOutcomePromptShown,
} from '../attention/storage';
import { recordQuickOutcome } from '../attention/quick-feedback';
import {
  createFullAnalysisHoverPreview,
  createHoverPreview,
} from '../analyzer/preview';
import { LocalAnalyzer } from '../analyzer/local-analyzer';
import { AiGatewayAnalyzer } from '../analyzer/ai-gateway-analyzer';
import type { Analyzer } from '../analyzer/analyzer';
import { loadAiAnalyzerSettings } from '../analyzer/settings';
import {
  createEvaluationCacheVersion,
  isEvaluationCacheCurrent,
  loadEvaluationSourceVersions,
  type EvaluationSourceVersions,
} from '../analyzer/evaluation-cache';
import {
  buildMaterialFeatures,
  type MaterialFeatures,
} from '../analyzer/material-features';
import { loadProfile } from '../profile/storage';
import { selectRelevantPersonalContext } from '../history/relevance';
import { aggregateBrowserHistory } from '../history/evidence';
import {
  loadBrowserHistoryEvidence,
  saveBrowserHistoryEvidence,
} from '../history/storage';
import type {
  BrowserHistoryImportRequest,
  BrowserHistoryImportResponse,
} from '../history/messages';
import {
  deriveHoverCalibration,
  findMaterialMemory,
  loadMaterialMemory,
  recordHoverPreviewEvent,
  recordMaterialEvaluation,
  invalidateMaterialEvaluations,
} from '../memory/material-memory';
import {
  loadReadwiseEvidence,
  loadReadwiseSettings,
  loadReadwiseToken,
  saveReadwiseConnection,
  saveReadwiseEvidence,
} from '../readwise/storage';
import { saveReadwiseHighlight, syncReadwiseLibrary } from '../readwise/client';
import {
  loadNovelPassageFeedback,
  recordNovelPassageFeedback,
} from '../novelty/feedback';
import {
  NOVEL_PASSAGE_FEEDBACK_TYPE,
  type NovelPassageActionResponse,
  type NovelPassageMessage,
} from '../novelty/messages';
import {
  NOVEL_PASSAGE_HIGHLIGHTS_KEY,
  novelPassageHighlightsEnabled,
} from '../novelty/settings';
import { loadObsidianEvidence } from '../obsidian/evidence';
import { loadNotionEvidence } from '../notion/evidence';
import { NotionApiClient } from '../notion/client';
import { syncNotionWorkspace } from '../notion/indexer';
import {
  exchangeNotionCode,
  loadNotionOAuthClientId,
  refreshNotionToken,
  revokeNotionToken,
} from '../notion/oauth';
import { clearNotionDatabase } from '../notion/database';
import {
  clearNotionConnection,
  loadNotionAuth,
  loadNotionSettings,
  saveNotionAuth,
  saveNotionConnection,
} from '../notion/storage';
import {
  NOTION_CONFIG_TYPE,
  NOTION_CONNECT_TYPE,
  NOTION_DISCONNECT_TYPE,
  type NotionRequest,
  type NotionResponse,
} from '../notion/messages';
import type {
  ReadwiseRequest,
  ReadwiseSyncResponse,
} from '../readwise/messages';
import {
  type AnalysisContext,
  type AttentionOutcomeSubmitMessage,
  type AttentionOutcomeSubmitResponse,
  type AttentionSessionAutoStartMessage,
  type AttentionSessionAutoStartResponse,
  type AttentionSessionDescriptor,
  type HoverPreviewRequest,
  type HoverPreviewResponse,
  type PageCapture,
  UI_LANGUAGE_CHANGED_TYPE,
  type SaveMaterialRequest,
  type SaveMaterialResponse,
  type SavedMaterial,
  type StoredEvaluation,
} from '../shared/types';
import { calibrateMaterialEvaluation } from '../utility/calibration';
import { loadUtilityCalibration } from '../utility/storage';
import {
  UI_LANGUAGE_KEY,
  normalizeUiLanguage,
  type UiLanguage,
} from '../i18n/ui';
import {
  CONTENT_SCRIPT_LIFECYCLE_DIAGNOSTIC_KEY,
  ensureContentScriptInOpenWebTabs,
  ensureContentScriptInTab,
  summarizeContentScriptResults,
  type ContentScriptLifecycleDiagnostic,
  type ContentScriptLifecycleTrigger,
  type ContentScriptReinjectionSummary,
} from './content-script-lifecycle';
import { EXTENSION_RUNTIME_VERSION } from '../shared/version';
import { messageSenderMatchesPage } from './message-sender';
import {
  loadScenarioState,
  normalizeAnalysisContext,
} from '../scenario/scenario';
import { upsertSavedMaterial } from '../popup/saved-materials';
import { isPageCapture } from './message-guards';
import { createBackgroundMessageRouter } from './message-router';
import { recordDiagnostic } from '../diagnostics/diagnostics';
import { loadPrivacySettings } from '../privacy/settings';

const storageReady = chrome.storage.local.setAccessLevel({
  accessLevel: 'TRUSTED_CONTEXTS',
});
const LATEST_EVALUATION_KEY = 'latestEvaluation';
const ANALYSIS_CONTEXT_KEY = 'analysisContext';
const SAVED_MATERIALS_KEY = 'savedMaterials';
let openTabsRefreshQueue: Promise<void> = Promise.resolve();
const lifecycleRefreshQueue = new Map<number, Promise<void>>();

async function loadInterfaceLanguage(): Promise<UiLanguage> {
  await storageReady;
  const stored = await chrome.storage.local.get(UI_LANGUAGE_KEY);
  return normalizeUiLanguage(stored[UI_LANGUAGE_KEY]);
}

async function storeLifecycleDiagnostic(
  trigger: ContentScriptLifecycleTrigger,
  summary: ContentScriptReinjectionSummary,
): Promise<void> {
  await storageReady;
  const diagnostic: ContentScriptLifecycleDiagnostic = {
    ...summary,
    firstError:
      summary.failedTabs > 0 ? 'CONTENT_SCRIPT_RUNTIME_UNAVAILABLE' : null,
    trigger,
    version: EXTENSION_RUNTIME_VERSION,
    checkedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({
    [CONTENT_SCRIPT_LIFECYCLE_DIAGNOSTIC_KEY]: diagnostic,
  });
}

async function refreshOpenWebTabs(
  trigger: Extract<
    ContentScriptLifecycleTrigger,
    'install' | 'update' | 'startup'
  >,
): Promise<void> {
  const summary = await ensureContentScriptInOpenWebTabs();
  await storeLifecycleDiagnostic(trigger, summary);
  console.info('[attention:lifecycle] open tabs checked', summary);
}

function queueOpenWebTabsRefresh(
  trigger: Extract<
    ContentScriptLifecycleTrigger,
    'install' | 'update' | 'startup'
  >,
): void {
  openTabsRefreshQueue = openTabsRefreshQueue
    .catch(() => undefined)
    .then(() => refreshOpenWebTabs(trigger))
    .catch(async (error: unknown) => {
      await storeLifecycleDiagnostic(trigger, failedLifecycleSummary()).catch(
        () => undefined,
      );
      await recordDiagnostic({
        subsystem: 'background',
        operation: 'refresh-open-tabs',
        code: 'CONTENT_SCRIPT_REFRESH_FAILED',
        error,
      }).catch(() => undefined);
      console.warn('[attention:lifecycle] open-tab refresh failed');
    });
}

function failedLifecycleSummary(): ContentScriptReinjectionSummary {
  return {
    matchedTabs: 0,
    activeTabs: 0,
    injectedTabs: 0,
    failedTabs: 1,
    firstError: 'CONTENT_SCRIPT_RUNTIME_UNAVAILABLE',
  };
}

async function refreshWebTab(
  tab: chrome.tabs.Tab,
  trigger: Extract<ContentScriptLifecycleTrigger, 'activated' | 'updated'>,
): Promise<void> {
  const result = await ensureContentScriptInTab(tab);
  const summary = summarizeContentScriptResults([result]);
  await storeLifecycleDiagnostic(trigger, summary);
  console.info('[attention:lifecycle] tab checked', summary);
}

function queueWebTabRefresh(
  tabId: number,
  tab: chrome.tabs.Tab | undefined,
  trigger: Extract<ContentScriptLifecycleTrigger, 'activated' | 'updated'>,
): void {
  const previous = lifecycleRefreshQueue.get(tabId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const resolvedTab = tab ?? (await chrome.tabs.get(tabId));
      await refreshWebTab(resolvedTab, trigger);
    })
    .catch(async (error: unknown) => {
      await storeLifecycleDiagnostic(trigger, failedLifecycleSummary()).catch(
        () => undefined,
      );
      await recordDiagnostic({
        subsystem: 'background',
        operation: 'refresh-tab',
        code: 'CONTENT_SCRIPT_REFRESH_FAILED',
        error,
      }).catch(() => undefined);
      console.warn('[attention:lifecycle] tab refresh failed');
    });
  lifecycleRefreshQueue.set(tabId, next);
  void next.finally(() => {
    if (lifecycleRefreshQueue.get(tabId) === next) {
      lifecycleRefreshQueue.delete(tabId);
    }
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  const trigger =
    details.reason === 'install'
      ? 'install'
      : details.reason === 'update'
        ? 'update'
        : null;
  if (!trigger) return;
  queueOpenWebTabsRefresh(trigger);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  queueWebTabRefresh(tabId, undefined, 'activated');
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url === undefined && changeInfo.status !== 'complete') return;
  queueWebTabRefresh(tabId, tab, 'updated');
});

// Reloading an unpacked MV3 extension invalidates content-script contexts in
// tabs that are already open. A service worker can start without onInstalled,
// onActivated, or onUpdated firing, so repair those tabs once per worker
// lifetime instead of requiring the user to reload every page manually.
queueOpenWebTabsRefresh('startup');

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}

function isSavedMaterial(value: unknown): value is SavedMaterial {
  if (!value || typeof value !== 'object') return false;
  const material = value as Record<string, unknown>;
  return (
    isPageCapture(material.capture) && typeof material.savedAt === 'string'
  );
}

async function loadSavedMaterials(): Promise<SavedMaterial[]> {
  const stored = await chrome.storage.local.get(SAVED_MATERIALS_KEY);
  const value: unknown = stored[SAVED_MATERIALS_KEY];
  return Array.isArray(value) ? value.filter(isSavedMaterial) : [];
}

async function isMaterialSaved(pageUrl: string): Promise<boolean> {
  const saved = await loadSavedMaterials();
  return saved.some((material) =>
    canonicalMatch(material.capture.url, pageUrl),
  );
}

async function saveMaterialFromCard(
  request: SaveMaterialRequest,
): Promise<SaveMaterialResponse> {
  await storageReady;
  const saved = await loadSavedMaterials();
  const next = upsertSavedMaterial(
    saved,
    request.capture,
    new Date().toISOString(),
  );
  while (next.length > 0) {
    try {
      await chrome.storage.local.set({ [SAVED_MATERIALS_KEY]: next });
      return { ok: true, savedCount: next.length };
    } catch {
      next.pop();
    }
  }
  return { ok: false };
}

function canonicalMatch(left: string, right: string): boolean {
  return canonicalUrl(left) === canonicalUrl(right);
}

function sessionDescriptor(
  session: Awaited<ReturnType<typeof createAttentionSession>>,
): AttentionSessionDescriptor {
  return {
    sessionId: session.id,
    url: session.url,
    decision: session.decision,
    estimatedReadingSeconds: session.estimatedReadingSeconds,
    sampledForOutcome: session.sampledForOutcome,
    promptShownCount: session.promptShownCount,
  };
}

async function autoStartSession(
  message: AttentionSessionAutoStartMessage,
): Promise<AttentionSessionAutoStartResponse | undefined> {
  await storageReady;
  if (!message.capture.isArticle || message.capture.wordCount < 80) {
    return undefined;
  }
  const context = await loadCurrentAnalysisContext();
  const preparation = await prepareLocalEvaluation(message.capture);
  const remembered = await findMaterialMemory(message.capture.url);
  const cachedEvaluation = remembered?.storedEvaluation;
  const matchingEvaluation = isEvaluationCacheCurrent(
    cachedEvaluation,
    preparation.sourceVersions,
    context,
    preparation.features,
  )
    ? (cachedEvaluation?.evaluation ?? null)
    : null;
  const evaluation =
    matchingEvaluation ??
    (
      await createAndStoreLocalEvaluation(
        message.capture,
        message.capture.title,
        context,
        preparation,
      )
    ).evaluation;
  const existing = await getOpenAttentionSession(
    message.capture.url,
    chrome.storage.local,
    context.scenario,
  );
  const session =
    existing ??
    (await createAttentionSession(
      message.capture,
      'read',
      evaluation,
      chrome.storage.local,
      new Date(),
      context,
    ));
  return { ok: true, session: sessionDescriptor(session) };
}

interface LocalEvaluationPreparation {
  profile: Awaited<ReturnType<typeof loadProfile>>;
  features: MaterialFeatures;
  sourceVersions: EvaluationSourceVersions;
}

async function prepareLocalEvaluation(
  capture: PageCapture,
): Promise<LocalEvaluationPreparation> {
  const [profile, features] = await Promise.all([
    loadProfile(),
    buildMaterialFeatures(capture),
  ]);
  return {
    profile,
    features,
    sourceVersions: await loadEvaluationSourceVersions(profile),
  };
}

async function createAndStoreLocalEvaluation(
  capture: PageCapture,
  title: string,
  suppliedContext?: AnalysisContext,
  suppliedPreparation?: LocalEvaluationPreparation,
): Promise<StoredEvaluation> {
  return createAndStoreEvaluation(
    capture,
    title,
    new LocalAnalyzer(),
    suppliedContext,
    suppliedPreparation,
  );
}

async function createAndStoreEvaluation(
  capture: PageCapture,
  title: string,
  analyzer: Analyzer,
  suppliedContext?: AnalysisContext,
  suppliedPreparation?: LocalEvaluationPreparation,
): Promise<StoredEvaluation> {
  const context = suppliedContext ?? (await loadCurrentAnalysisContext());
  const preparation =
    suppliedPreparation ?? (await prepareLocalEvaluation(capture));
  const [
    historyEvidence,
    readwiseEvidence,
    obsidianEvidence,
    notionEvidence,
    claimMemory,
    utilityCalibration,
  ] = await Promise.all([
    loadBrowserHistoryEvidence(),
    loadReadwiseEvidence(),
    loadObsidianEvidence(),
    loadNotionEvidence(),
    loadNovelPassageFeedback(),
    loadUtilityCalibration(),
  ]);
  const relevantProfile = await selectRelevantPersonalContext(
    preparation.profile,
    historyEvidence,
    readwiseEvidence,
    obsidianEvidence,
    notionEvidence,
    capture,
    context,
    claimMemory,
    preparation.features,
  );
  const evaluation = calibrateMaterialEvaluation(
    await analyzer.analyze(capture, context, relevantProfile),
    capture.readingTimeMinutes,
    utilityCalibration,
  );
  const storedEvaluation: StoredEvaluation = {
    url: capture.url,
    context,
    evaluation,
    cacheVersion: createEvaluationCacheVersion(
      preparation.features,
      context,
      preparation.sourceVersions,
    ),
  };
  await recordMaterialEvaluation(storedEvaluation, title);
  return storedEvaluation;
}

function evaluationAnalysisSource(
  evaluation: StoredEvaluation['evaluation'],
): 'local' | 'ai' {
  return evaluation.analyzerId.startsWith('ai-gateway-') ? 'ai' : 'local';
}

async function loadCurrentAnalysisContext(): Promise<AnalysisContext> {
  const stored = await chrome.storage.local.get(ANALYSIS_CONTEXT_KEY);
  const base = normalizeAnalysisContext(stored[ANALYSIS_CONTEXT_KEY]);
  const scenarioState = await loadScenarioState();
  return {
    ...base,
    scenario: scenarioState.scenario,
    relaxIntent: scenarioState.relaxIntent,
    desiredEffort: scenarioState.desiredEffort,
    leisureFormats: scenarioState.leisureFormats,
  };
}

async function saveQuickOutcome(
  message: AttentionOutcomeSubmitMessage,
): Promise<AttentionOutcomeSubmitResponse> {
  await storageReady;
  const sessions = await loadAttentionSessions();
  const session = sessions.find(
    (item) =>
      item.id === message.sessionId && canonicalMatch(item.url, message.url),
  );
  if (
    !session ||
    session.outcome !== null ||
    session.expected.predictedUtility === null ||
    session.expected.components === null
  ) {
    return { ok: false };
  }
  const now = new Date();
  await recordQuickOutcome(session, message.outcome, chrome.storage.local, now);
  return { ok: true };
}

async function hoverPreviewResponse(
  request: HoverPreviewRequest,
): Promise<HoverPreviewResponse> {
  await storageReady;
  const pageCapabilities = request.capture
    ? await Promise.all([
        chrome.storage.local.get(NOVEL_PASSAGE_HIGHLIGHTS_KEY),
        loadReadwiseSettings(),
        loadAiAnalyzerSettings(),
        loadPrivacySettings(),
      ]).then(
        ([
          highlightSettings,
          readwiseSettings,
          aiSettings,
          privacySettings,
        ]) => ({
          aiSettings,
          aiState: privacySettings.localOnly
            ? ('local-only' as const)
            : aiSettings
              ? ('ready' as const)
              : ('not-connected' as const),
          novelPassageHighlightsEnabled: novelPassageHighlightsEnabled(
            highlightSettings[NOVEL_PASSAGE_HIGHLIGHTS_KEY],
          ),
          readwiseConnected: readwiseSettings.connected,
        }),
      )
    : {
        aiSettings: null,
        aiState: 'not-connected' as const,
        novelPassageHighlightsEnabled: novelPassageHighlightsEnabled(undefined),
        readwiseConnected: false,
      };
  const capabilities = {
    novelPassageHighlightsEnabled:
      pageCapabilities.novelPassageHighlightsEnabled,
    readwiseConnected: pageCapabilities.readwiseConnected,
    aiState: pageCapabilities.aiState,
  };
  const context = await loadCurrentAnalysisContext();
  const profile = await loadProfile();
  const [features, sourceVersions] = await Promise.all([
    request.capture ? buildMaterialFeatures(request.capture) : null,
    loadEvaluationSourceVersions(profile),
  ]);
  const preparation = features ? { profile, features, sourceVersions } : null;
  if (request.analysisMode === 'ai' && request.capture) {
    if (pageCapabilities.aiState !== 'ready' || !pageCapabilities.aiSettings) {
      const localEvaluation = await createAndStoreLocalEvaluation(
        request.capture,
        request.title,
        context,
        preparation ?? undefined,
      );
      return {
        ok: true,
        preview: createFullAnalysisHoverPreview(localEvaluation.evaluation),
        analysisSource: 'local',
        saved: await isMaterialSaved(request.url),
        ...capabilities,
      };
    }
    try {
      const aiEvaluation = await createAndStoreEvaluation(
        request.capture,
        request.title,
        new AiGatewayAnalyzer(
          pageCapabilities.aiSettings.apiKey,
          pageCapabilities.aiSettings.model,
        ),
        context,
        preparation ?? undefined,
      );
      return {
        ok: true,
        preview: createFullAnalysisHoverPreview(aiEvaluation.evaluation),
        analysisSource: 'ai',
        saved: await isMaterialSaved(request.url),
        ...capabilities,
      };
    } catch (error) {
      await recordDiagnostic({
        subsystem: 'background',
        operation: 'hover-preview-ai-analysis',
        code: 'HOVER_PREVIEW_AI_FAILED',
        error,
      }).catch(() => undefined);
      const localEvaluation = await createAndStoreLocalEvaluation(
        request.capture,
        request.title,
        context,
        preparation ?? undefined,
      );
      return {
        ok: true,
        preview: createFullAnalysisHoverPreview(localEvaluation.evaluation),
        analysisSource: 'local',
        saved: await isMaterialSaved(request.url),
        ...capabilities,
        aiState: 'error',
      };
    }
  }
  const remembered = await findMaterialMemory(request.url);
  if (
    remembered?.storedEvaluation?.evaluation &&
    isEvaluationCacheCurrent(
      remembered.storedEvaluation,
      sourceVersions,
      context,
      features ?? undefined,
    ) &&
    (remembered.storedEvaluation.evaluation.insights || !request.capture)
  ) {
    return {
      ok: true,
      preview: createFullAnalysisHoverPreview(
        remembered.storedEvaluation.evaluation,
      ),
      analysisSource: evaluationAnalysisSource(
        remembered.storedEvaluation.evaluation,
      ),
      saved: await isMaterialSaved(request.url),
      ...capabilities,
    };
  }
  const stored = await chrome.storage.local.get(LATEST_EVALUATION_KEY);
  const latest = stored[LATEST_EVALUATION_KEY] as StoredEvaluation | undefined;
  if (
    latest?.evaluation &&
    typeof latest.url === 'string' &&
    canonicalMatch(latest.url, request.url) &&
    isEvaluationCacheCurrent(
      latest,
      sourceVersions,
      context,
      features ?? undefined,
    ) &&
    typeof latest.evaluation.utilityScore === 'number' &&
    (latest.evaluation.insights || !request.capture)
  ) {
    return {
      ok: true,
      preview: createFullAnalysisHoverPreview(latest.evaluation),
      analysisSource: evaluationAnalysisSource(latest.evaluation),
      saved: await isMaterialSaved(request.url),
      ...capabilities,
    };
  }
  if (request.capture) {
    const storedEvaluation = await createAndStoreLocalEvaluation(
      request.capture,
      request.title,
      context,
      preparation ?? undefined,
    );
    return {
      ok: true,
      preview: createFullAnalysisHoverPreview(storedEvaluation.evaluation),
      analysisSource: evaluationAnalysisSource(storedEvaluation.evaluation),
      saved: await isMaterialSaved(request.url),
      ...capabilities,
    };
  }
  const memory = await loadMaterialMemory();
  const calibration = deriveHoverCalibration(memory, context.scenario);
  const [historyEvidence, readwiseEvidence] = await Promise.all([
    loadBrowserHistoryEvidence(),
    loadReadwiseEvidence(),
  ]);
  return {
    ok: true,
    preview: await createHoverPreview(
      request,
      profile,
      calibration,
      context,
      historyEvidence,
      readwiseEvidence,
    ),
    analysisSource: 'local',
    saved: await isMaterialSaved(request.url),
    ...capabilities,
  };
}

async function handleNovelPassageMessage(
  message: NovelPassageMessage,
): Promise<NovelPassageActionResponse> {
  await storageReady;
  try {
    if (message.type === NOVEL_PASSAGE_FEEDBACK_TYPE) {
      await recordNovelPassageFeedback(message);
      return { ok: true };
    }
    const token = await loadReadwiseToken();
    if (!token) return { ok: false, error: 'not_connected' };
    await saveReadwiseHighlight(token, {
      text: message.excerpt,
      title: message.title,
      author: message.author,
      sourceUrl: message.url,
    });
    return { ok: true };
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'request_failed';
    await recordDiagnostic({
      subsystem: 'background',
      operation: 'novel-passage-action',
      code: `NOVEL_PASSAGE_${code.toUpperCase()}`,
      error,
    }).catch(() => undefined);
    return { ok: false, error: code };
  }
}

function senderIsTrustedExtensionPage(
  sender: chrome.runtime.MessageSender,
): boolean {
  const extensionOrigin = chrome.runtime.getURL('');
  return (
    sender.id === chrome.runtime.id &&
    Boolean(sender.url?.startsWith(extensionOrigin))
  );
}

async function importBrowserHistory(
  message: BrowserHistoryImportRequest,
): Promise<BrowserHistoryImportResponse> {
  await storageReady;
  const endTime = Date.now();
  let response: BrowserHistoryImportResponse | null = null;
  let permissionRevoked = false;
  try {
    const items = await chrome.history.search({
      text: '',
      startTime: endTime - message.lookbackDays * 86_400_000,
      endTime,
      maxResults: 10_000,
    });
    const evidence = await aggregateBrowserHistory(
      items,
      message.lookbackDays,
      new Date(endTime),
    );
    await saveBrowserHistoryEvidence(evidence, message.lookbackDays, false);
    response = {
      ok: true,
      processedUrlCount: evidence.processedUrlCount,
      totalVisitCount: evidence.totalVisitCount,
      excludedUrlCount: evidence.excludedUrlCount,
    };
  } finally {
    permissionRevoked = await chrome.permissions
      .remove({ permissions: ['history'] })
      .catch(() => false);
    const evidence = await loadBrowserHistoryEvidence().catch(() => null);
    if (evidence) {
      await saveBrowserHistoryEvidence(
        evidence,
        message.lookbackDays,
        !permissionRevoked,
      ).catch(() => undefined);
    }
  }
  return { ...(response ?? { ok: false }), permissionRevoked };
}

async function invalidateAnalysisCaches(): Promise<void> {
  await Promise.all([
    chrome.storage.local.remove(LATEST_EVALUATION_KEY),
    invalidateMaterialEvaluations(),
  ]);
}

async function handleReadwiseRequest(
  message: ReadwiseRequest,
): Promise<ReadwiseSyncResponse> {
  await storageReady;
  const rawToken =
    message.type === 'attention:readwise-connect'
      ? message.token
      : await loadReadwiseToken();
  if (!rawToken) return { ok: false, error: 'not_connected' };
  try {
    const isConnect = message.type === 'attention:readwise-connect';
    const [previousEvidence, previousSettings] = isConnect
      ? [null, null]
      : await Promise.all([loadReadwiseEvidence(), loadReadwiseSettings()]);
    const syncedAt = new Date().toISOString();
    const { token, evidence } = await syncReadwiseLibrary(
      rawToken,
      fetch,
      new Date(syncedAt),
      previousEvidence,
      previousSettings?.lastSyncedAt ?? null,
    );
    if (message.type === 'attention:readwise-connect') {
      await saveReadwiseConnection(token, evidence, syncedAt);
    } else {
      await saveReadwiseEvidence(evidence, syncedAt);
    }
    if (isConnect || evidence.generatedAt !== previousEvidence?.generatedAt) {
      await invalidateAnalysisCaches();
    }
    return {
      ok: true,
      sourceCount: evidence.sourceCount,
      highlightCount: evidence.highlightCount,
      noteCount: evidence.noteCount,
      excludedSourceCount: evidence.excludedSourceCount,
    };
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'sync_failed';
    await recordDiagnostic({
      subsystem: 'background',
      operation: 'sync-readwise',
      code: `READWISE_${code.toUpperCase()}`,
      error,
    }).catch(() => undefined);
    return { ok: false, error: code };
  }
}

async function handleNotionRequest(
  message: NotionRequest,
): Promise<NotionResponse> {
  await storageReady;
  if (message.type === NOTION_CONFIG_TYPE) {
    try {
      return { ok: true, clientId: await loadNotionOAuthClientId() };
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'oauth_not_configured';
      return { ok: false, error: code };
    }
  }
  if (message.type === NOTION_DISCONNECT_TYPE) {
    const auth = await loadNotionAuth();
    if (auth) {
      await revokeNotionToken(auth.accessToken).catch((error) =>
        recordDiagnostic({
          subsystem: 'background',
          operation: 'revoke-notion',
          code: 'NOTION_REVOKE_FAILED',
          error,
        }),
      );
    }
    await Promise.all([clearNotionConnection(), clearNotionDatabase()]);
    await invalidateAnalysisCaches();
    return { ok: true };
  }

  try {
    const previousSettings = await loadNotionSettings();
    const previousAuth =
      message.type === NOTION_CONNECT_TYPE ? await loadNotionAuth() : null;
    const auth =
      message.type === NOTION_CONNECT_TYPE
        ? await exchangeNotionCode(message.code, message.redirectUri)
        : await loadNotionAuth();
    if (!auth) return { ok: false, error: 'not_connected' };
    const client = new NotionApiClient(auth, async (current) => {
      if (!current.refreshToken) return null;
      const refreshed = await refreshNotionToken(current.refreshToken);
      await saveNotionAuth(refreshed);
      return refreshed;
    });
    const result = await syncNotionWorkspace({
      auth,
      sourceMode: message.sourceMode,
      client,
    });
    await saveNotionConnection(result.auth, result.settings);
    if (previousAuth && previousAuth.accessToken !== result.auth.accessToken) {
      await revokeNotionToken(previousAuth.accessToken).catch((error) =>
        recordDiagnostic({
          subsystem: 'background',
          operation: 'revoke-replaced-notion-token',
          code: 'NOTION_REPLACED_TOKEN_REVOKE_FAILED',
          error,
        }),
      );
    }
    if (
      result.settings.evidenceUpdatedAt !== previousSettings.evidenceUpdatedAt
    ) {
      await invalidateAnalysisCaches();
    }
    return {
      ok: true,
      pageCount: result.settings.pageCount,
      fragmentCount: result.settings.fragmentCount,
      excludedPageCount: result.settings.excludedPageCount,
      workspaceName: result.settings.workspaceName,
    };
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'sync_failed';
    await recordDiagnostic({
      subsystem: 'background',
      operation: 'sync-notion',
      code: `NOTION_${code.toUpperCase()}`,
      error,
    }).catch(() => undefined);
    return { ok: false, error: code };
  }
}

chrome.runtime.onMessage.addListener(
  createBackgroundMessageRouter({
    storageReady,
    loadInterfaceLanguage,
    autoStartSession,
    markOutcomePromptShown,
    saveQuickOutcome,
    hoverPreviewResponse,
    saveMaterialFromCard,
    recordHoverPreviewEvent,
    applyAttentionProgress,
    senderMatchesPage: messageSenderMatchesPage,
    senderIsTrustedExtensionPage,
    importBrowserHistory,
    handleReadwiseRequest,
    handleNotionRequest,
    handleNovelPassageMessage,
    reportError: ({ operation, code, error }) =>
      recordDiagnostic({
        subsystem: 'background',
        operation,
        code,
        error,
      }),
  }),
);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[UI_LANGUAGE_KEY]) return;
  const language = normalizeUiLanguage(changes[UI_LANGUAGE_KEY].newValue);
  void chrome.tabs
    .query({ url: ['http://*/*', 'https://*/*'] })
    .then((tabs) =>
      Promise.allSettled(
        tabs
          .filter((tab): tab is chrome.tabs.Tab & { id: number } =>
            Number.isInteger(tab.id),
          )
          .map((tab) =>
            chrome.tabs.sendMessage(tab.id, {
              type: UI_LANGUAGE_CHANGED_TYPE,
              language,
            }),
          ),
      ),
    )
    .catch(() => undefined);
});
