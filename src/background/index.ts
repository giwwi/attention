import {
  privateStorage,
  privateStorageChanges,
  getVaultStatus,
} from '../vault/storage';
import { installVaultMessages } from './vault';
import {
  applyAttentionProgress,
  cancelAttentionSession,
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
import { isProfileReady } from '../profile/readiness';
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
  recordMaterialDecision,
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
  cardContextDto,
  createCardContextMessageHandler,
  loadCardContext,
} from './card-context';
import { upsertSavedMaterial } from '../popup/saved-materials';
import { isPageCapture } from './message-guards';
import { createBackgroundMessageRouter } from './message-router';
import { recordDiagnostic } from '../diagnostics/diagnostics';
import { loadPrivacySettings } from '../privacy/settings';
import {
  beginDataOperation,
  beginSyncOperation,
  cancelSyncOperation,
  observeDataOperation,
  commitDataOperation,
  DataOperationCancelledError,
  assertDataOperationCurrent,
  type DataOperation,
} from '../privacy/data-operations';
import {
  ATTENTION_INPUTS_INVALIDATED_TYPE,
  changedInputKeys,
} from './input-invalidation';
import {
  ATTENTION_MATERIAL_DECIDE_TYPE,
  type AttentionMaterialDecideMessage,
  type AttentionMaterialDecideResponse,
} from '../attention/decision-messages';
import { STORAGE_RETENTION_LIMITS } from '../storage/limits';
import { DECISIONS_KEY } from '../popup/storage-keys';
import type { DecisionRecord } from '../shared/types';

const storageReady = privateStorage.setAccessLevel({
  accessLevel: 'TRUSTED_CONTEXTS',
});
installVaultMessages();
const LATEST_EVALUATION_KEY = 'latestEvaluation';
const SAVED_MATERIALS_KEY = 'savedMaterials';
let openTabsRefreshQueue: Promise<void> = Promise.resolve();
const lifecycleRefreshQueue = new Map<number, Promise<void>>();

async function loadInterfaceLanguage(): Promise<UiLanguage> {
  await storageReady;
  const stored = await privateStorage.get(UI_LANGUAGE_KEY);
  return normalizeUiLanguage(stored[UI_LANGUAGE_KEY]);
}

async function storeLifecycleDiagnostic(
  trigger: ContentScriptLifecycleTrigger,
  summary: ContentScriptReinjectionSummary,
): Promise<void> {
  await storageReady;
  if ((await getVaultStatus()) !== 'unlocked') return;
  const diagnostic: ContentScriptLifecycleDiagnostic = {
    ...summary,
    firstError:
      summary.failedTabs > 0 ? 'CONTENT_SCRIPT_RUNTIME_UNAVAILABLE' : null,
    trigger,
    version: EXTENSION_RUNTIME_VERSION,
    checkedAt: new Date().toISOString(),
  };
  await privateStorage.set({
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
  const stored = await privateStorage.get(SAVED_MATERIALS_KEY);
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
  try {
    await privateStorage.set({ [SAVED_MATERIALS_KEY]: next });
    return { ok: true, savedCount: next.length };
  } catch {
    // A vault/IO failure is not evidence that existing articles should be lost.
    return { ok: false };
  }
}

async function decideMaterial(
  message: AttentionMaterialDecideMessage,
): Promise<AttentionMaterialDecideResponse> {
  const operation = await beginDataOperation();
  await storageReady;
  const context = await loadCurrentAnalysisContext();
  const remembered = await findMaterialMemory(message.capture.url);
  const preparation = await prepareLocalEvaluation(message.capture);
  const evaluation = isEvaluationCacheCurrent(
    remembered?.storedEvaluation,
    preparation.sourceVersions,
    context,
    preparation.features,
  )
    ? remembered!.storedEvaluation!.evaluation
    : (
        await createAndStoreLocalEvaluation(
          message.capture,
          message.capture.title,
          context,
          preparation,
          operation,
        )
      ).evaluation;
  return commitDataOperation(operation, async () => {
    if (message.decision === 'save') {
      const saved = await saveMaterialFromCard({
        type: 'ATTENTION_MATERIAL/SAVE',
        capture: message.capture,
      });
      if (!saved.ok) return { ok: false };
    }
    const record: DecisionRecord = {
      url: message.capture.url,
      title: message.capture.title,
      decision: message.decision,
      decidedAt: new Date().toISOString(),
    };
    const stored = await privateStorage.get(DECISIONS_KEY);
    const previous = Array.isArray(stored[DECISIONS_KEY])
      ? (stored[DECISIONS_KEY] as DecisionRecord[])
      : [];
    await privateStorage.set({
      [DECISIONS_KEY]: [
        record,
        ...previous.filter((item) => !canonicalMatch(item.url, record.url)),
      ].slice(0, STORAGE_RETENTION_LIMITS.decisions),
    });
    await recordMaterialDecision(record);
    if (message.decision === 'read' || message.decision === 'skim') {
      const session = await createAttentionSession(
        message.capture,
        message.decision,
        evaluation,
        privateStorage,
        new Date(),
        context,
      );
      return { ok: true, session: sessionDescriptor(session) };
    }
    await cancelAttentionSession(message.capture.url);
    return { ok: true };
  });
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
  const operation = await beginDataOperation();
  await storageReady;
  if (!message.capture.isArticle || message.capture.wordCount < 80) {
    return undefined;
  }
  const context = await loadCurrentAnalysisContext();
  const preparation = await prepareLocalEvaluation(message.capture);
  if (!isProfileReady(preparation.profile)) return undefined;
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
        operation,
      )
    ).evaluation;
  return commitDataOperation(operation, async () => {
    const existing = await getOpenAttentionSession(
      message.capture.url,
      privateStorage,
      context.scenario,
    );
    const session =
      existing ??
      (await createAttentionSession(
        message.capture,
        'read',
        evaluation,
        privateStorage,
        new Date(),
        context,
      ));
    return { ok: true, session: sessionDescriptor(session) };
  });
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
  operation?: DataOperation,
): Promise<StoredEvaluation> {
  return createAndStoreEvaluation(
    capture,
    title,
    new LocalAnalyzer(),
    suppliedContext,
    suppliedPreparation,
    operation,
  );
}

async function createAndStoreEvaluation(
  capture: PageCapture,
  title: string,
  analyzer: Analyzer,
  suppliedContext?: AnalysisContext,
  suppliedPreparation?: LocalEvaluationPreparation,
  startedOperation?: DataOperation,
): Promise<StoredEvaluation> {
  const operation = startedOperation ?? (await beginDataOperation());
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
  const cancellation = await observeDataOperation(operation);
  let rawEvaluation;
  try {
    await assertDataOperationCurrent(operation);
    rawEvaluation = await analyzer.analyze(
      capture,
      context,
      relevantProfile,
      cancellation.signal,
    );
  } finally {
    cancellation.dispose();
  }
  const evaluation = calibrateMaterialEvaluation(
    rawEvaluation,
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
  await commitDataOperation(operation, () =>
    recordMaterialEvaluation(storedEvaluation, title),
  );
  return storedEvaluation;
}

function evaluationAnalysisSource(
  evaluation: StoredEvaluation['evaluation'],
): 'local' | 'ai' {
  return evaluation.analyzerId.startsWith('ai-gateway-') ? 'ai' : 'local';
}

async function loadCurrentAnalysisContext(): Promise<AnalysisContext> {
  return loadCardContext();
}

async function saveQuickOutcome(
  message: AttentionOutcomeSubmitMessage,
  startedOperation?: DataOperation,
): Promise<AttentionOutcomeSubmitResponse> {
  const operation = startedOperation ?? (await beginDataOperation());
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
  await commitDataOperation(operation, () =>
    recordQuickOutcome(session, message.outcome, privateStorage, now),
  );
  return { ok: true };
}

async function hoverPreviewResponse(
  request: HoverPreviewRequest,
): Promise<HoverPreviewResponse | undefined> {
  const operation = await beginDataOperation();
  await storageReady;
  const profile = await loadProfile();
  if (!isProfileReady(profile)) return undefined;
  const pageCapabilities = request.capture
    ? await Promise.all([
        privateStorage.get(NOVEL_PASSAGE_HIGHLIGHTS_KEY),
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
        operation,
      );
      return {
        ok: true,
        context: cardContextDto(localEvaluation.context),
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
        operation,
      );
      return {
        ok: true,
        context: cardContextDto(aiEvaluation.context),
        preview: createFullAnalysisHoverPreview(aiEvaluation.evaluation),
        analysisSource: 'ai',
        saved: await isMaterialSaved(request.url),
        ...capabilities,
      };
    } catch (error) {
      if (error instanceof DataOperationCancelledError) throw error;
      await commitDataOperation(operation, () =>
        recordDiagnostic({
          subsystem: 'background',
          operation: 'hover-preview-ai-analysis',
          code: 'HOVER_PREVIEW_AI_FAILED',
          error,
        }),
      ).catch(() => undefined);
      const localEvaluation = await createAndStoreLocalEvaluation(
        request.capture,
        request.title,
        context,
        preparation ?? undefined,
        operation,
      );
      return {
        ok: true,
        context: cardContextDto(localEvaluation.context),
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
      context: cardContextDto(remembered.storedEvaluation.context),
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
  const stored = await privateStorage.get(LATEST_EVALUATION_KEY);
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
      context: cardContextDto(latest.context),
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
      operation,
    );
    return {
      ok: true,
      context: cardContextDto(storedEvaluation.context),
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
    context,
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
  startedOperation?: DataOperation,
): Promise<NovelPassageActionResponse> {
  const operation = startedOperation ?? (await beginDataOperation());
  await storageReady;
  try {
    if (message.type === NOVEL_PASSAGE_FEEDBACK_TYPE) {
      await commitDataOperation(operation, () =>
        recordNovelPassageFeedback(message),
      );
      return { ok: true };
    }
    const token = await loadReadwiseToken();
    if (!token) return { ok: false, error: 'not_connected' };
    await assertDataOperationCurrent(operation);
    await saveReadwiseHighlight(token, {
      text: message.excerpt,
      title: message.title,
      author: message.author,
      sourceUrl: message.url,
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof DataOperationCancelledError)
      return { ok: false, error: 'operation_cancelled' };
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'request_failed';
    await commitDataOperation(operation, () =>
      recordDiagnostic({
        subsystem: 'background',
        operation: 'novel-passage-action',
        code: `NOVEL_PASSAGE_${code.toUpperCase()}`,
        error,
      }),
    ).catch(() => undefined);
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
  let operation: DataOperation;
  try {
    operation = await beginSyncOperation(
      'history',
      message.generation === undefined
        ? undefined
        : {
            generation: message.generation,
            vaultEpoch: message.vaultEpoch,
            ...(message.syncRevision
              ? {
                  sync: {
                    source: 'history' as const,
                    revision: message.syncRevision,
                  },
                }
              : {}),
          },
    );
  } catch (error) {
    if (error instanceof DataOperationCancelledError)
      return { ok: false, error: 'operation_cancelled' };
    throw error;
  }
  await storageReady;
  const endTime = Date.now();
  let response: BrowserHistoryImportResponse | null = null;
  let permissionRevoked = false;
  try {
    await assertDataOperationCurrent(operation);
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
    await commitDataOperation(operation, () =>
      saveBrowserHistoryEvidence(evidence, message.lookbackDays, false),
    );
    response = {
      ok: true,
      processedUrlCount: evidence.processedUrlCount,
      totalVisitCount: evidence.totalVisitCount,
      excludedUrlCount: evidence.excludedUrlCount,
    };
  } catch (error) {
    if (!(error instanceof DataOperationCancelledError)) throw error;
    response = { ok: false, error: 'operation_cancelled' };
  } finally {
    await commitDataOperation(operation, async () => {
      // Only the current importer owns the temporary permission. An older
      // response must not revoke access granted to a replacement import.
      permissionRevoked = await chrome.permissions
        .remove({ permissions: ['history'] })
        .catch(() => false);
      const evidence = await loadBrowserHistoryEvidence();
      if (evidence)
        await saveBrowserHistoryEvidence(
          evidence,
          message.lookbackDays,
          !permissionRevoked,
        );
    }).catch(() => undefined);
  }
  return { ...(response ?? { ok: false }), permissionRevoked };
}

async function invalidateAnalysisCaches(): Promise<void> {
  await Promise.all([
    privateStorage.remove(LATEST_EVALUATION_KEY),
    invalidateMaterialEvaluations(),
  ]);
}

async function handleReadwiseRequest(
  message: ReadwiseRequest,
): Promise<ReadwiseSyncResponse> {
  const operation = await beginSyncOperation('readwise');
  await storageReady;
  const rawToken =
    message.type === 'attention:readwise-connect'
      ? message.token
      : await loadReadwiseToken();
  if (!rawToken) return { ok: false, error: 'not_connected' };
  let observation: Awaited<ReturnType<typeof observeDataOperation>> | undefined;
  try {
    observation = await observeDataOperation(operation);
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
      observation.signal,
    );
    await commitDataOperation(operation, async () => {
      if (message.type === 'attention:readwise-connect') {
        await saveReadwiseConnection(token, evidence, syncedAt);
      } else {
        await saveReadwiseEvidence(evidence, syncedAt);
      }
      if (isConnect || evidence.generatedAt !== previousEvidence?.generatedAt)
        await invalidateAnalysisCaches();
    });
    return {
      ok: true,
      sourceCount: evidence.sourceCount,
      highlightCount: evidence.highlightCount,
      noteCount: evidence.noteCount,
      excludedSourceCount: evidence.excludedSourceCount,
    };
  } catch (error) {
    if (
      error instanceof DataOperationCancelledError ||
      observation?.signal.aborted
    )
      return { ok: false, error: 'operation_cancelled' };
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'sync_failed';
    await commitDataOperation(operation, () =>
      recordDiagnostic({
        subsystem: 'background',
        operation: 'sync-readwise',
        code: `READWISE_${code.toUpperCase()}`,
        error,
      }),
    ).catch(() => undefined);
    return { ok: false, error: code };
  } finally {
    observation?.dispose();
  }
}

async function handleNotionRequest(
  message: NotionRequest,
): Promise<NotionResponse> {
  if (message.type === NOTION_CONFIG_TYPE) {
    const operation = await beginDataOperation();
    const observation = await observeDataOperation(operation);
    await storageReady;
    try {
      return {
        ok: true,
        clientId: await loadNotionOAuthClientId(observation.signal),
      };
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'oauth_not_configured';
      return { ok: false, error: code };
    } finally {
      observation.dispose();
    }
  }
  if (message.type === NOTION_DISCONNECT_TYPE) {
    const auth = await cancelSyncOperation('notion', async () => {
      await storageReady;
      const current = await loadNotionAuth();
      await Promise.all([clearNotionConnection(), clearNotionDatabase()]);
      await invalidateAnalysisCaches();
      return current;
    });
    if (auth) void revokeNotionToken(auth.accessToken).catch(() => undefined);
    return { ok: true };
  }

  let operation: DataOperation;
  try {
    operation = await beginSyncOperation(
      'notion',
      message.type === NOTION_CONNECT_TYPE && message.generation !== undefined
        ? {
            generation: message.generation,
            vaultEpoch: message.vaultEpoch,
            ...(message.syncRevision
              ? {
                  sync: {
                    source: 'notion' as const,
                    revision: message.syncRevision,
                  },
                }
              : {}),
          }
        : undefined,
    );
  } catch (error) {
    if (error instanceof DataOperationCancelledError)
      return { ok: false, error: 'operation_cancelled' };
    throw error;
  }
  await storageReady;
  let observation: Awaited<ReturnType<typeof observeDataOperation>> | undefined;
  try {
    observation = await observeDataOperation(operation);
    await assertDataOperationCurrent(operation);
    const previousSettings = await loadNotionSettings();
    const previousAuth =
      message.type === NOTION_CONNECT_TYPE ? await loadNotionAuth() : null;
    const auth =
      message.type === NOTION_CONNECT_TYPE
        ? await exchangeNotionCode(
            message.code,
            message.redirectUri,
            observation.signal,
          )
        : await loadNotionAuth();
    if (!auth) return { ok: false, error: 'not_connected' };
    const client = new NotionApiClient(
      auth,
      async (current) => {
        if (!current.refreshToken) return null;
        const refreshed = await refreshNotionToken(
          current.refreshToken,
          observation?.signal,
        );
        await commitDataOperation(operation, async () => {
          // A new workspace's credentials stay provisional until its index
          // commits. Refresh only the already persisted connection in place.
          const stored = await loadNotionAuth();
          if (stored?.accessToken === current.accessToken)
            await saveNotionAuth(refreshed);
        });
        return refreshed;
      },
      {
        signal: observation.signal,
        assertCurrent: () => assertDataOperationCurrent(operation),
      },
    );
    const result = await syncNotionWorkspace({
      auth,
      sourceMode: message.sourceMode,
      client,
      operation,
    });
    await commitDataOperation(operation, async () => {
      if (
        result.settings.evidenceUpdatedAt !== previousSettings.evidenceUpdatedAt
      )
        await invalidateAnalysisCaches();
    });
    if (previousAuth && previousAuth.accessToken !== result.auth.accessToken) {
      await revokeNotionToken(previousAuth.accessToken).catch((error) =>
        commitDataOperation(operation, () =>
          recordDiagnostic({
            subsystem: 'background',
            operation: 'revoke-replaced-notion-token',
            code: 'NOTION_REPLACED_TOKEN_REVOKE_FAILED',
            error,
          }),
        ).catch(() => undefined),
      );
    }
    return {
      ok: true,
      pageCount: result.settings.pageCount,
      fragmentCount: result.settings.fragmentCount,
      excludedPageCount: result.settings.excludedPageCount,
      workspaceName: result.settings.workspaceName,
    };
  } catch (error) {
    if (
      error instanceof DataOperationCancelledError ||
      observation?.signal.aborted
    )
      return { ok: false, error: 'operation_cancelled' };
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'sync_failed';
    await commitDataOperation(operation, () =>
      recordDiagnostic({
        subsystem: 'background',
        operation: 'sync-notion',
        code: `NOTION_${code.toUpperCase()}`,
        error,
      }),
    ).catch(() => undefined);
    return { ok: false, error: code };
  } finally {
    observation?.dispose();
  }
}

chrome.runtime.onMessage.addListener(
  createCardContextMessageHandler({ storageReady }),
);

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

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return;
    const input = message as Record<string, unknown>;
    if (input.type !== ATTENTION_MATERIAL_DECIDE_TYPE) return;
    if (
      !isPageCapture(input.capture) ||
      !['read', 'skim', 'save', 'skip'].includes(String(input.decision)) ||
      !messageSenderMatchesPage(sender, input.capture.url)
    ) {
      sendResponse({ ok: false });
      return;
    }
    void decideMaterial(input as unknown as AttentionMaterialDecideMessage)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true;
  },
);

const pendingInputKeys = new Set<string>();
let inputBroadcastTimer: ReturnType<typeof setTimeout> | undefined;
privateStorageChanges.addListener((changes, areaName) => {
  for (const key of changedInputKeys(changes, areaName))
    pendingInputKeys.add(key);
  if (pendingInputKeys.size === 0 || inputBroadcastTimer !== undefined) return;
  inputBroadcastTimer = setTimeout(() => {
    inputBroadcastTimer = undefined;
    const changedKeys = [...pendingInputKeys];
    pendingInputKeys.clear();
    void chrome.tabs
      .query({ url: ['http://*/*', 'https://*/*'] })
      .then((tabs) =>
        Promise.allSettled(
          tabs
            .filter((tab) => typeof tab.id === 'number')
            .map((tab) =>
              chrome.tabs.sendMessage(tab.id!, {
                type: ATTENTION_INPUTS_INVALIDATED_TYPE,
                changedKeys,
              }),
            ),
        ),
      )
      .catch(() => undefined);
  }, 50);
});

privateStorageChanges.addListener((changes, areaName) => {
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
