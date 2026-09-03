import {
  ATTENTION_OUTCOME_PROMPT_SHOWN_TYPE,
  ATTENTION_OUTCOME_SUBMIT_TYPE,
  ATTENTION_SESSION_AUTO_START_TYPE,
  ATTENTION_SESSION_GET_PROGRESS_TYPE,
  ATTENTION_SESSION_PROGRESS_TYPE,
  ATTENTION_SESSION_START_TYPE,
  ATTENTION_SESSION_STOP_TYPE,
  CAPTURE_MESSAGE_TYPE,
  SCROLL_TO_HEADING_MESSAGE_TYPE,
  type AttentionSessionGetProgressMessage,
  type AttentionSessionAutoStartResponse,
  type AttentionSessionDescriptor,
  type AttentionSessionProgress,
  type AttentionSessionProgressMessage,
  type AttentionSessionProgressResponse,
  type AttentionSessionStartMessage,
  type AttentionSessionStopMessage,
  type CaptureMessage,
  type CaptureResponse,
  type PageCapture,
  type AttentionOutcomeSubmitResponse,
  type MaterialOutcome,
  type ScrollDepth,
  type ScrollToHeadingMessage,
  type ScrollToHeadingResponse,
  CONTENT_RUNTIME_PING_TYPE,
  UI_LANGUAGE_CHANGED_TYPE,
  UI_LANGUAGE_GET_TYPE,
  type ContentRuntimePingMessage,
  type ContentRuntimePingResponse,
  type UiLanguageChangedMessage,
  type UiLanguageResponse,
} from '../shared/types';
import {
  DEFAULT_UI_LANGUAGE,
  normalizeUiLanguage,
  type UiLanguage,
} from '../i18n/ui';
import { hasMeaningfulReadingEngagement } from '../attention/eligibility';
import { captureDocument } from './capture';
import {
  findCurrentArticleRoot,
  findCurrentArticleTitleElement,
} from './article-root';
import { HOVER_PREVIEW_CONFIG } from './config';
import { scrollToHeading } from './headings';
import { installHoverPreview } from './hover-preview';
import { installOutcomePrompt } from './outcome-prompt';
import { EXTENSION_RUNTIME_VERSION } from '../shared/version';
import {
  currentReadingProgress,
  quantizeReadingProgress,
} from './reading-progress';
import {
  findFeedbackReadingEndTarget,
  findFeedbackReadingRoot,
} from './feedback-reading';
import { installChatGptProfileHandoffNotice } from './profile-handoff-notice';
import {
  buildPageCaptureSignature,
  PageCaptureCache,
} from './page-capture-cache';
import { isArticlePagePath } from './page-kind';
import { installRouteWatcher } from './route-watcher';
import { subscribeToScroll } from './scroll-hub';

interface ActiveTracker {
  sessionId: string;
  url: string;
  accumulatedVisibleMs: number;
  visibleSince: number | null;
  maxScrollDepth: ScrollDepth;
  heartbeatId: number;
  estimatedReadingSeconds: number;
  sampledForOutcome: boolean;
  promptShown: boolean;
  readingRoot: HTMLElement | null;
  readingEndObserver: IntersectionObserver | null;
  initialScrollY: number;
  initialReadingProgress: number | null;
  hasReadingMovement: boolean;
}

interface ReadingCandidate {
  capture: PageCapture;
  initialScrollY: number;
  initialReadingProgress: number | null;
  readingRoot: HTMLElement | null;
}

interface ContentScriptGlobal {
  __pageCaptureListenerInstalled?: boolean;
  __pageCaptureRuntimeVersion?: string;
  __pageCaptureRuntimeAbort?: AbortController;
  __pageCaptureMessageListener?: Parameters<
    typeof chrome.runtime.onMessage.addListener
  >[0];
  __attentionTracker?: ActiveTracker | null;
}

const contentScriptGlobal = globalThis as typeof globalThis &
  ContentScriptGlobal;
void installChatGptProfileHandoffNotice().catch((error: unknown) => {
  console.warn('[Attention] ChatGPT handoff notice unavailable', {
    error: error instanceof Error ? error.message : String(error),
  });
});
let interfaceLanguage: UiLanguage = DEFAULT_UI_LANGUAGE;
const outcomePrompt = installOutcomePrompt('closed', interfaceLanguage);
const readingPageCache = new PageCaptureCache<PageCapture>();
let readingCandidate: ReadingCandidate | null = null;
let autoStartPending = false;
let observedPageUrl = canonicalUrl(window.location.href);
let readingHydrationObserver: MutationObserver | null = null;
let readingHydrationRoot: HTMLElement | null = null;
let readingHydrationTimer = 0;
let readingHydrationStopTimer = 0;

function setReadingCandidate(capture: PageCapture): void {
  if (!capture.isArticle || capture.wordCount < 80) return;
  const readingRoot = findFeedbackReadingRoot(document, capture.title);
  readingCandidate = {
    capture,
    initialScrollY: window.scrollY,
    initialReadingProgress: currentReadingProgress(readingRoot),
    readingRoot,
  };
}

function ensureCurrentReadingCandidate(): void {
  const capture = capturePage();
  if (!capture.isArticle || capture.wordCount < 80) return;
  const readingRoot = findFeedbackReadingRoot(document, capture.title);
  if (
    readingCandidate &&
    canonicalUrl(readingCandidate.capture.url) ===
      canonicalUrl(window.location.href) &&
    readingCandidate.capture.title === capture.title &&
    readingCandidate.capture.wordCount >= capture.wordCount &&
    readingCandidate.readingRoot === readingRoot &&
    readingCandidate.readingRoot?.isConnected !== false
  ) {
    return;
  }
  readingCandidate = {
    capture,
    initialScrollY: window.scrollY,
    initialReadingProgress: currentReadingProgress(readingRoot),
    readingRoot,
  };
}

function capturePage(): PageCapture {
  const titleElement = findCurrentArticleTitleElement(document);
  const articleRoot = findCurrentArticleRoot(document);
  const signature = buildPageCaptureSignature(
    document,
    window.location.href,
    articleRoot,
    titleElement,
  );
  return readingPageCache.get(signature, () =>
    captureDocument(document, window.location.href),
  );
}

function shouldPrepareReadingCandidate(): boolean {
  if (isArticlePagePath(window.location.pathname)) return true;
  const articleBody = document.querySelector<HTMLElement>(
    'article, [itemprop="articleBody"], .instapaper_body',
  );
  const primaryTitle = document.querySelector<HTMLElement>(
    'h1, [role="heading"][aria-level="1"], [itemprop="headline"]',
  );
  return Boolean(
    articleBody &&
    primaryTitle &&
    (articleBody.textContent?.trim().length ?? 0) >= 600,
  );
}

function stopReadingHydration(): void {
  window.clearTimeout(readingHydrationTimer);
  window.clearTimeout(readingHydrationStopTimer);
  readingHydrationTimer = 0;
  readingHydrationStopTimer = 0;
  readingHydrationObserver?.disconnect();
  readingHydrationObserver = null;
  readingHydrationRoot = null;
}

function restartReadingHydration(): void {
  stopReadingHydration();
  if (!shouldPrepareReadingCandidate()) return;

  ensureCurrentReadingCandidate();
  let remainingRefreshes = 5;
  const observationRoot =
    findCurrentArticleRoot(document) ??
    document.querySelector<HTMLElement>('article, main, [role="main"]') ??
    document.body;
  if (!observationRoot || typeof MutationObserver === 'undefined') return;
  readingHydrationRoot = observationRoot;

  readingHydrationObserver = new MutationObserver(() => {
    if (remainingRefreshes <= 0) {
      stopReadingHydration();
      return;
    }
    window.clearTimeout(readingHydrationTimer);
    readingHydrationTimer = window.setTimeout(() => {
      readingHydrationTimer = 0;
      remainingRefreshes -= 1;
      ensureCurrentReadingCandidate();
    }, 300);
  });
  readingHydrationObserver.observe(observationRoot, {
    childList: true,
    subtree: true,
  });
  readingHydrationStopTimer = window.setTimeout(
    stopReadingHydration,
    HOVER_PREVIEW_CONFIG.hydrationObservationWindowMs,
  );
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}

function currentScrollDepth(readingRoot: HTMLElement | null): ScrollDepth {
  const readingProgress = currentReadingProgress(readingRoot);
  if (readingProgress !== null) {
    return quantizeReadingProgress(readingProgress);
  }
  const documentHeight = Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight ?? 0,
  );
  const scrollable = Math.max(0, documentHeight - window.innerHeight);
  if (scrollable === 0) return 100;
  const percentage = Math.min(
    100,
    Math.max(0, ((window.scrollY + window.innerHeight) / documentHeight) * 100),
  );
  if (percentage >= 95) return 100;
  if (percentage >= 75) return 75;
  if (percentage >= 50) return 50;
  if (percentage >= 25) return 25;
  return 0;
}

function updateScrollDepth(tracker: ActiveTracker): void {
  tracker.maxScrollDepth = Math.max(
    tracker.maxScrollDepth,
    currentScrollDepth(tracker.readingRoot),
  ) as ScrollDepth;
}

function updateReadingMovement(tracker: ActiveTracker): void {
  const readingProgress = currentReadingProgress(tracker.readingRoot);
  if (
    window.scrollY >= tracker.initialScrollY + 64 ||
    (readingProgress !== null &&
      tracker.initialReadingProgress !== null &&
      readingProgress >= tracker.initialReadingProgress + 5)
  ) {
    tracker.hasReadingMovement = true;
  }
}

function visibleMilliseconds(tracker: ActiveTracker): number {
  const current =
    tracker.visibleSince === null ? 0 : Date.now() - tracker.visibleSince;
  return tracker.accumulatedVisibleMs + Math.max(0, current);
}

function progressSnapshot(
  tracker: ActiveTracker,
  ended: boolean,
): AttentionSessionProgress {
  updateScrollDepth(tracker);
  return {
    sessionId: tracker.sessionId,
    url: tracker.url,
    visibleSeconds: Math.round(visibleMilliseconds(tracker) / 1000),
    maxScrollDepth: tracker.maxScrollDepth,
    ended,
    recordedAt: new Date().toISOString(),
  };
}

function publishProgress(tracker: ActiveTracker, ended = false): void {
  const progress = progressSnapshot(tracker, ended);
  const message: AttentionSessionProgressMessage = {
    type: ATTENTION_SESSION_PROGRESS_TYPE,
    ...progress,
  };
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

function pauseVisibleTime(tracker: ActiveTracker): void {
  if (tracker.visibleSince === null) return;
  tracker.accumulatedVisibleMs += Math.max(
    0,
    Date.now() - tracker.visibleSince,
  );
  tracker.visibleSince = null;
}

function stopTracker(ended: boolean): void {
  const tracker = contentScriptGlobal.__attentionTracker;
  if (!tracker) return;
  pauseVisibleTime(tracker);
  window.clearInterval(tracker.heartbeatId);
  tracker.readingEndObserver?.disconnect();
  publishProgress(tracker, ended);
  contentScriptGlobal.__attentionTracker = null;
}

function startTracker(message: AttentionSessionDescriptor): void {
  if (canonicalUrl(message.url) !== canonicalUrl(window.location.href)) return;
  stopTracker(false);
  const readingRoot = findFeedbackReadingRoot(document, capturePage().title);
  const tracker: ActiveTracker = {
    sessionId: message.sessionId,
    url: canonicalUrl(message.url),
    accumulatedVisibleMs: 0,
    visibleSince: document.visibilityState === 'visible' ? Date.now() : null,
    maxScrollDepth: currentScrollDepth(readingRoot),
    heartbeatId: 0,
    estimatedReadingSeconds: message.estimatedReadingSeconds,
    sampledForOutcome: message.sampledForOutcome,
    // An unresolved material gets one fresh on-page prompt opportunity after
    // a page/extension reload. A previous runtime may have marked the prompt
    // as shown even when Substack removed or covered it before the user saw it.
    promptShown: false,
    readingRoot,
    readingEndObserver: null,
    initialScrollY: window.scrollY,
    initialReadingProgress: currentReadingProgress(readingRoot),
    hasReadingMovement: false,
  };
  tracker.heartbeatId = window.setInterval(() => {
    if (tracker.visibleSince === null) return;
    if (visibleMilliseconds(tracker) >= 30 * 60_000) {
      stopTracker(true);
      return;
    }
    publishProgress(tracker);
    maybeShowOutcomePrompt(tracker);
  }, 15_000);
  contentScriptGlobal.__attentionTracker = tracker;
  const endTarget = findFeedbackReadingEndTarget(readingRoot);
  if (endTarget && typeof IntersectionObserver !== 'undefined') {
    tracker.readingEndObserver = new IntersectionObserver(
      (entries, observer) => {
        const reachedEnd = entries.some(
          (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.1,
        );
        if (!reachedEnd) return;
        tracker.maxScrollDepth = 100;
        observer.disconnect();
        tracker.readingEndObserver = null;
        maybeShowOutcomePrompt(tracker);
      },
      { threshold: [0.1] },
    );
    tracker.readingEndObserver.observe(endTarget);
  }
  readingCandidate = null;
  publishProgress(tracker);
}

function isOutcomeSubmitResponse(
  value: unknown,
): value is AttentionOutcomeSubmitResponse {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).ok === 'boolean',
  );
}

async function submitOutcome(
  tracker: ActiveTracker,
  outcome: MaterialOutcome,
): Promise<boolean> {
  const response: unknown = await chrome.runtime.sendMessage({
    type: ATTENTION_OUTCOME_SUBMIT_TYPE,
    sessionId: tracker.sessionId,
    url: tracker.url,
    outcome,
  });
  if (!isOutcomeSubmitResponse(response) || !response.ok) return false;
  tracker.sampledForOutcome = false;
  return true;
}

function maybeShowOutcomePrompt(tracker: ActiveTracker): void {
  updateScrollDepth(tracker);
  if (
    !tracker.sampledForOutcome ||
    tracker.promptShown ||
    !tracker.hasReadingMovement ||
    !hasMeaningfulReadingEngagement(
      visibleMilliseconds(tracker) / 1000,
      tracker.maxScrollDepth,
      tracker.estimatedReadingSeconds,
    )
  ) {
    return;
  }
  tracker.promptShown = true;
  publishProgress(tracker);
  void chrome.runtime
    .sendMessage({
      type: ATTENTION_OUTCOME_PROMPT_SHOWN_TYPE,
      sessionId: tracker.sessionId,
      url: tracker.url,
    })
    .catch(() => undefined);
  outcomePrompt.show((outcome) => submitOutcome(tracker, outcome));
}

function isAutoStartResponse(
  value: unknown,
): value is AttentionSessionAutoStartResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Record<string, unknown>;
  const session = response.session as Record<string, unknown> | undefined;
  return (
    response.ok === true &&
    Boolean(session) &&
    typeof session?.sessionId === 'string' &&
    typeof session?.url === 'string' &&
    (session?.decision === 'read' || session?.decision === 'skim') &&
    typeof session?.estimatedReadingSeconds === 'number' &&
    typeof session?.sampledForOutcome === 'boolean' &&
    typeof session?.promptShownCount === 'number'
  );
}

async function maybeStartReadingCandidate(): Promise<void> {
  const candidate = readingCandidate;
  const readingProgress = candidate
    ? currentReadingProgress(candidate.readingRoot)
    : null;
  const progressedInsideArticle = Boolean(
    candidate &&
    readingProgress !== null &&
    candidate.initialReadingProgress !== null &&
    readingProgress >= candidate.initialReadingProgress + 5,
  );
  if (
    !candidate ||
    autoStartPending ||
    contentScriptGlobal.__attentionTracker ||
    document.visibilityState !== 'visible' ||
    (!progressedInsideArticle && window.scrollY < candidate.initialScrollY + 64)
  ) {
    return;
  }
  autoStartPending = true;
  try {
    const response: unknown = await chrome.runtime.sendMessage({
      type: ATTENTION_SESSION_AUTO_START_TYPE,
      capture: candidate.capture,
    });
    if (isAutoStartResponse(response)) startTracker(response.session);
  } finally {
    autoStartPending = false;
  }
}

function handleVisibilityChange(): void {
  synchronizePageState();
  const tracker = contentScriptGlobal.__attentionTracker;
  if (!tracker) return;
  if (document.visibilityState === 'visible') {
    tracker.visibleSince = Date.now();
    maybeShowOutcomePrompt(tracker);
  } else {
    pauseVisibleTime(tracker);
    publishProgress(tracker);
  }
}

function handleScroll(): void {
  synchronizePageState();
  const tracker = contentScriptGlobal.__attentionTracker;
  if (tracker) {
    updateReadingMovement(tracker);
    updateScrollDepth(tracker);
    maybeShowOutcomePrompt(tracker);
  } else {
    void maybeStartReadingCandidate().catch(() => undefined);
  }
}

function bindPageEventListeners(signal: AbortSignal): void {
  // Removing the same listener is safe even when the SPA kept the original
  // event surface intact. When it did not, this gives the new article a fresh
  // scroll/visibility path without creating duplicate callbacks.
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('visibilitychange', handleVisibilityChange, {
    signal,
  });
  subscribeToScroll(handleScroll, signal);
}

function synchronizePageState(): void {
  const currentUrl = canonicalUrl(window.location.href);
  if (currentUrl === observedPageUrl) {
    // Some SPA readers update history before replacing the article element.
    // The route event can therefore attach our short hydration observer to the
    // outgoing article. The sparse fallback check only repairs that specific
    // disconnected-root race; it does not re-extract stable pages.
    if (readingHydrationRoot && !readingHydrationRoot.isConnected) {
      readingCandidate = null;
      readingPageCache.invalidate();
      restartReadingHydration();
    }
    return;
  }
  outcomePrompt.hide();
  stopTracker(false);
  readingCandidate = null;
  autoStartPending = false;
  observedPageUrl = currentUrl;
  readingPageCache.invalidate();
  restartReadingHydration();
}

type ContentMessage =
  | CaptureMessage
  | ContentRuntimePingMessage
  | ScrollToHeadingMessage
  | AttentionSessionStartMessage
  | AttentionSessionStopMessage
  | AttentionSessionGetProgressMessage
  | UiLanguageChangedMessage;

if (
  !contentScriptGlobal.__pageCaptureListenerInstalled ||
  contentScriptGlobal.__pageCaptureRuntimeVersion !== EXTENSION_RUNTIME_VERSION
) {
  contentScriptGlobal.__pageCaptureRuntimeAbort?.abort();
  if (contentScriptGlobal.__pageCaptureMessageListener) {
    chrome.runtime.onMessage.removeListener(
      contentScriptGlobal.__pageCaptureMessageListener,
    );
  }
  const runtimeController = new AbortController();
  const messageListener: Parameters<
    typeof chrome.runtime.onMessage.addListener
  >[0] = (rawMessage: unknown, _sender, sendResponse) => {
    const message = rawMessage as ContentMessage;
    if (message?.type === CONTENT_RUNTIME_PING_TYPE) {
      const response: ContentRuntimePingResponse = {
        ok: true,
        version: EXTENSION_RUNTIME_VERSION,
      };
      sendResponse(response);
      return;
    }
    if (message?.type === UI_LANGUAGE_CHANGED_TYPE) {
      interfaceLanguage = normalizeUiLanguage(message.language);
      outcomePrompt.setLanguage(interfaceLanguage);
      return;
    }
    if (message?.type === CAPTURE_MESSAGE_TYPE) {
      const response: CaptureResponse = { ok: true, capture: capturePage() };
      sendResponse(response);
      return;
    }
    if (message?.type === SCROLL_TO_HEADING_MESSAGE_TYPE) {
      const response: ScrollToHeadingResponse = {
        ok: true,
        found: scrollToHeading(document, message.heading),
      };
      sendResponse(response);
      return;
    }
    if (message?.type === ATTENTION_SESSION_START_TYPE) {
      startTracker(message);
      return;
    }
    if (message?.type === ATTENTION_SESSION_STOP_TYPE) {
      if (canonicalUrl(message.url) === canonicalUrl(window.location.href)) {
        stopTracker(false);
      }
      return;
    }
    if (message?.type === ATTENTION_SESSION_GET_PROGRESS_TYPE) {
      const tracker = contentScriptGlobal.__attentionTracker;
      const response: AttentionSessionProgressResponse = {
        ok: true,
        progress: tracker ? progressSnapshot(tracker, false) : null,
      };
      sendResponse(response);
    }
  };
  chrome.runtime.onMessage.addListener(messageListener);
  bindPageEventListeners(runtimeController.signal);
  installRouteWatcher(synchronizePageState, runtimeController.signal, {
    fallbackIntervalMs: HOVER_PREVIEW_CONFIG.routeWatchIntervalMs,
  });
  restartReadingHydration();
  runtimeController.signal.addEventListener('abort', () => {
    stopReadingHydration();
  });
  window.addEventListener('pagehide', () => stopTracker(true), {
    signal: runtimeController.signal,
  });
  contentScriptGlobal.__pageCaptureListenerInstalled = true;
  contentScriptGlobal.__pageCaptureRuntimeVersion = EXTENSION_RUNTIME_VERSION;
  contentScriptGlobal.__pageCaptureRuntimeAbort = runtimeController;
  contentScriptGlobal.__pageCaptureMessageListener = messageListener;
}

installHoverPreview({
  getUiLanguage: () => interfaceLanguage,
  onCurrentPageEvaluation(capture): void {
    if (contentScriptGlobal.__attentionTracker) return;
    setReadingCandidate(capture);
  },
});

// A content-script update or a Substack SPA transition can leave the previous
// page's prompt in the shared document. Always start the current route hidden.
outcomePrompt.hide();

void chrome.runtime
  .sendMessage({ type: UI_LANGUAGE_GET_TYPE })
  .then((response: unknown) => {
    if (
      response &&
      typeof response === 'object' &&
      (response as Partial<UiLanguageResponse>).ok === true
    ) {
      interfaceLanguage = normalizeUiLanguage(
        (response as UiLanguageResponse).language,
      );
      outcomePrompt.setLanguage(interfaceLanguage);
    }
  })
  .catch(() => undefined);
