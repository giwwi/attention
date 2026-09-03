import {
  cancelAttentionSession,
  createAttentionSession,
} from '../attention/storage';
import { loadAiAnalyzerSettings } from '../analyzer/settings';
import { recordMaterialDecision } from '../memory/material-memory';
import {
  FirstValueOnboarding,
  shouldShowFirstValueOnboarding,
  type FirstValueSelection,
} from '../onboarding/first-value';
import { ProfileOnboarding } from '../onboarding/profile-onboarding';
import { AiQuickProfileBuilder } from '../profile/quick-builder';
import {
  PERSONAL_PROFILE_KEY,
  PROFILE_ONBOARDING_KEY,
  completeProfileOnboarding,
} from '../profile/storage';
import {
  ATTENTION_SESSION_START_TYPE,
  ATTENTION_SESSION_STOP_TYPE,
  CAPTURE_MESSAGE_TYPE,
  SCROLL_TO_HEADING_MESSAGE_TYPE,
  type CaptureMessage,
  type CaptureResponse,
  type DecisionRecord,
  type MaterialDecision,
  type PageCapture,
} from '../shared/types';
import { EXTENSION_RUNTIME_VERSION } from '../shared/version';
import { AiSettingsController } from './controllers/ai-settings-controller';
import { EvaluationController } from './controllers/evaluation-controller';
import { FeedbackController } from './controllers/feedback-controller';
import { SavedMaterialsController } from './controllers/saved-materials-controller';
import { SettingsController } from './controllers/settings-controller';
import { PrivacyController } from './controllers/privacy-controller';
import { BrowserHistoryController } from './controllers/browser-history-controller';
import { ReadwiseController } from './controllers/readwise-controller';
import { ObsidianController } from './controllers/obsidian-controller';
import { NotionController } from './controllers/notion-controller';
import { recordDiagnostic } from '../diagnostics/diagnostics';
import { closeExtensionPopup, getElement, setPopupStatus } from './dom';
import {
  isDecisionRecord,
  isPageCapture,
  isScrollToHeadingResponse,
} from './guards';
import {
  CONTENT_SCRIPT_LIFECYCLE_DIAGNOSTIC_KEY,
  DECISIONS_KEY,
  LATEST_CAPTURE_KEY,
} from './storage-keys';
import { STORAGE_RETENTION_LIMITS } from '../storage/limits';

const storageReady = chrome.storage.local.setAccessLevel({
  accessLevel: 'TRUSTED_CONTEXTS',
});

interface RuntimeLifecycleDiagnostic {
  matchedTabs: number;
  activeTabs: number;
  injectedTabs: number;
  failedTabs: number;
  firstError: string | null;
  version: string;
  checkedAt: string;
}

const captureButton = getElement<HTMLButtonElement>('capture');
const runtimeVersion = getElement<HTMLSpanElement>('runtime-version');
runtimeVersion.textContent = `v${chrome.runtime.getManifest().version}`;
runtimeVersion.dataset.bundleVersion = EXTENSION_RUNTIME_VERSION;
const status = getElement<HTMLParagraphElement>('status');
const runtimeDiagnostic =
  getElement<HTMLParagraphElement>('runtime-diagnostic');
const settingsHome = getElement<HTMLElement>('settings-home');
const result = getElement<HTMLElement>('result');
const title = getElement<HTMLHeadingElement>('title');
const excerpt = getElement<HTMLParagraphElement>('excerpt');
const siteName = getElement<HTMLSpanElement>('site-name');
const contentType = getElement<HTMLSpanElement>('content-type');
const readingTime = getElement<HTMLElement>('reading-time');
const wordCount = getElement<HTMLElement>('word-count');
const language = getElement<HTMLElement>('language');
const articleMeta = getElement<HTMLParagraphElement>('article-meta');
const extractionNote = getElement<HTMLParagraphElement>('extraction-note');
const skimPanel = getElement<HTMLElement>('skim-panel');
const headings = getElement<HTMLOListElement>('headings');
const noHeadings = getElement<HTMLParagraphElement>('no-headings');
const content = getElement<HTMLTextAreaElement>('content');
const url = getElement<HTMLElement>('url');
const method = getElement<HTMLElement>('method');
const storageState = getElement<HTMLElement>('storage-state');
const openSavedMaterialsButton = getElement<HTMLButtonElement>(
  'open-saved-materials',
);
const continueOnPageButton = getElement<HTMLButtonElement>('continue-on-page');
const aiSettingsPanel = getElement<HTMLElement>('ai-settings');
const savedMaterialsView = getElement<HTMLElement>('saved-materials-view');
const privacySettingsPanel = getElement<HTMLElement>('privacy-settings');
const readwiseSettingsPanel = getElement<HTMLElement>('readwise-settings');
const profileRoot = getElement<HTMLElement>('profile-onboarding');
const decisionButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-decision]'),
);

let activeCapture: PageCapture | null = null;
let mainStarted = false;
let profileOnboarding: ProfileOnboarding | null = null;
let firstValueOnboarding: FirstValueOnboarding | null = null;
let privacyController: PrivacyController | null = null;
let readwiseController: ReadwiseController | null = null;
let obsidianController: ObsidianController | null = null;
let notionController: NotionController | null = null;
const browserHistoryController = new BrowserHistoryController();
const settingsController = new SettingsController({
  status,
  onEvaluationInvalidated: () => evaluationController.clear(),
  onTranslated: () => {
    aiSettingsController.renderState();
    privacyController?.translate();
    readwiseController?.translate();
    obsidianController?.translate();
    notionController?.translate();
  },
  onLanguageChanged: async () => {
    if (savedMaterialsController.isVisible) {
      await savedMaterialsController.refresh();
    }
    if (privacyController?.isVisible) await privacyController.refresh();
    if (readwiseController?.isVisible) await readwiseController.refresh();
    await obsidianController?.refresh();
    await notionController?.refresh();
  },
});

const aiSettingsController = new AiSettingsController({
  status,
  settingsHome,
  savedMaterialsView,
  readwiseSettingsPanel,
  privacySettingsPanel,
  result,
  getLanguage: () => settingsController.language,
  isMainStarted: () => mainStarted,
  onSettingsChanged: () => evaluationController.clear(),
});

const savedMaterialsController = new SavedMaterialsController({
  status,
  settingsHome,
  aiSettingsPanel,
  readwiseSettingsPanel,
  privacySettingsPanel,
  result,
  getLanguage: () => settingsController.language,
  isMainStarted: () => mainStarted,
});

const feedbackController = new FeedbackController({ status });

const evaluationController = new EvaluationController({
  status,
  decisionButtons,
  getCapture: () => activeCapture,
  getContext: () => settingsController.currentContext(),
  getScenario: () => settingsController.scenario,
  getAiSettings: () => aiSettingsController.current,
  refreshAiSettings: () => aiSettingsController.refresh(),
  applyContext: (context) => settingsController.applyContext(context),
  refreshProfile: async () => profileOnboarding?.refreshProfile(),
});

privacyController = new PrivacyController({
  status,
  settingsHome,
  savedMaterialsView,
  aiSettingsPanel,
  readwiseSettingsPanel,
  result,
  getLanguage: () => settingsController.language,
  isMainStarted: () => mainStarted,
  onModeChanged: () => evaluationController.clear(),
});

readwiseController = new ReadwiseController({
  status,
  profileRoot,
  savedMaterialsView,
  aiSettingsPanel,
  privacySettingsPanel,
  result,
  getLanguage: () => settingsController.language,
  onEvidenceChanged: () => evaluationController.clear(),
});

obsidianController = new ObsidianController({
  getLanguage: () => settingsController.language,
});

notionController = new NotionController(() => settingsController.language);

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Не удалось найти активную вкладку.');
  return tab.id;
}

function isCaptureResponse(value: unknown): value is CaptureResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { ok?: unknown; capture?: unknown };
  return candidate.ok === true && isPageCapture(candidate.capture);
}

async function sendCaptureRequest(tabId: number): Promise<PageCapture> {
  const message: CaptureMessage = { type: CAPTURE_MESSAGE_TYPE };
  const response: unknown = await chrome.tabs.sendMessage(tabId, message);
  if (!isCaptureResponse(response)) {
    throw new Error('Страница вернула некорректный результат извлечения.');
  }
  return response.capture;
}

async function requestCapture(tabId: number): Promise<PageCapture> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch {
    // The following request reports the user-facing error for protected pages.
  }
  try {
    return await sendCaptureRequest(tabId);
  } catch {
    throw new Error('Не удалось подключить актуальную версию к странице.');
  }
}

function formatPublishedTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function renderHeadings(capture: PageCapture): void {
  headings.replaceChildren();
  for (const heading of capture.headings) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = heading;
    button.title = `Перейти к разделу «${heading}»`;
    button.addEventListener('click', () => {
      void navigateToHeading(heading, button);
    });
    item.append(button);
    headings.append(item);
  }
  headings.hidden = capture.headings.length === 0;
  noHeadings.hidden = capture.headings.length > 0;
}

async function navigateToHeading(
  heading: string,
  button: HTMLButtonElement,
): Promise<void> {
  button.disabled = true;
  try {
    const tabId = await getActiveTabId();
    const response: unknown = await chrome.tabs.sendMessage(tabId, {
      type: SCROLL_TO_HEADING_MESSAGE_TYPE,
      heading,
    });
    if (!isScrollToHeadingResponse(response) || !response.found) {
      throw new Error('Раздел больше не найден на странице.');
    }
    setPopupStatus(status, 'success', `Переходим к разделу «${heading}».`);
    closeExtensionPopup();
  } catch (error) {
    await recordDiagnostic({
      subsystem: 'popup',
      operation: 'capture-page',
      code: 'PAGE_CAPTURE_FAILED',
      error,
    }).catch(() => undefined);
    button.disabled = false;
    setPopupStatus(
      status,
      'error',
      error instanceof Error
        ? error.message
        : 'Не удалось перейти к разделу на странице.',
    );
  }
}

function extractionMethodLabel(capture: PageCapture): string {
  if (capture.extractionMethod === 'readability') return 'Основная статья';
  if (capture.extractionMethod === 'semantic') return 'Семантический блок';
  return 'Видимый текст страницы';
}

function renderCapture(capture: PageCapture, savedLocally = true): void {
  activeCapture = capture;
  evaluationController.clear();
  title.textContent = capture.title || 'Страница без заголовка';
  excerpt.textContent = capture.excerpt;
  excerpt.hidden = !capture.excerpt;
  siteName.textContent = capture.siteName;
  contentType.textContent = capture.isArticle ? 'Статья' : 'Страница';
  readingTime.textContent = capture.readingTimeMinutes
    ? `${capture.readingTimeMinutes} мин`
    : '—';
  wordCount.textContent = capture.wordCount.toLocaleString('ru-RU');
  language.textContent = capture.language?.toUpperCase() || '—';
  content.value = capture.content;
  url.textContent = capture.url;
  method.textContent = extractionMethodLabel(capture);
  storageState.textContent = savedLocally
    ? 'Сохранено локально'
    : 'Не сохранено: превышен лимит';

  const metadata = [capture.byline, formatPublishedTime(capture.publishedTime)]
    .filter(Boolean)
    .join(' · ');
  articleMeta.textContent = metadata;
  articleMeta.hidden = !metadata;
  extractionNote.hidden = capture.isArticle;
  extractionNote.textContent =
    'Основную статью выделить не удалось — показан видимый текст страницы.';
  renderHeadings(capture);
  result.hidden = false;
  void restoreDecision(capture.url);
  void evaluationController.restore(capture.url);
}

async function storeCapture(pageCapture: PageCapture): Promise<boolean> {
  const currentBytes = await chrome.storage.local.getBytesInUse(null);
  const replacedBytes =
    await chrome.storage.local.getBytesInUse(LATEST_CAPTURE_KEY);
  const captureBytes = new Blob([
    LATEST_CAPTURE_KEY,
    JSON.stringify(pageCapture),
  ]).size;
  const projectedBytes = currentBytes - replacedBytes + captureBytes;

  if (projectedBytes > chrome.storage.local.QUOTA_BYTES) return false;
  await chrome.storage.local.set({ [LATEST_CAPTURE_KEY]: pageCapture });
  return true;
}

function setActiveDecision(decision: MaterialDecision | null): void {
  for (const button of decisionButtons) {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.decision === decision),
    );
  }
  skimPanel.hidden = decision !== 'skim';
}

async function getDecisions(): Promise<DecisionRecord[]> {
  const stored = await chrome.storage.local.get(DECISIONS_KEY);
  const value: unknown = stored[DECISIONS_KEY];
  return Array.isArray(value) ? value.filter(isDecisionRecord) : [];
}

async function restoreDecision(pageUrl: string): Promise<void> {
  const decisions = await getDecisions();
  const record = decisions.find((decision) => decision.url === pageUrl);
  if (activeCapture?.url === pageUrl) {
    setActiveDecision(record?.decision ?? null);
  }
}

async function updateAttentionTracking(
  decision: MaterialDecision,
): Promise<void> {
  if (!activeCapture) return;
  const tabId = await getActiveTabId();
  if (decision === 'read' || decision === 'skim') {
    const session = await createAttentionSession(
      activeCapture,
      decision,
      evaluationController.current,
      chrome.storage.local,
      new Date(),
      settingsController.currentContext(),
    );
    await chrome.tabs.sendMessage(tabId, {
      type: ATTENTION_SESSION_START_TYPE,
      sessionId: session.id,
      url: session.url,
      decision: session.decision,
      estimatedReadingSeconds: session.estimatedReadingSeconds,
      sampledForOutcome: session.sampledForOutcome,
      promptShownCount: session.promptShownCount,
    });
    return;
  }
  await cancelAttentionSession(activeCapture.url);
  await chrome.tabs
    .sendMessage(tabId, {
      type: ATTENTION_SESSION_STOP_TYPE,
      url: activeCapture.url,
    })
    .catch(() => undefined);
}

async function saveDecision(decision: MaterialDecision): Promise<void> {
  if (!activeCapture) return;
  if (decision === 'save') {
    await savedMaterialsController.save(activeCapture);
  }
  const decisions = await getDecisions();
  const record: DecisionRecord = {
    url: activeCapture.url,
    title: activeCapture.title,
    decision,
    decidedAt: new Date().toISOString(),
  };
  const next = [
    record,
    ...decisions.filter((item) => item.url !== activeCapture?.url),
  ].slice(0, STORAGE_RETENTION_LIMITS.decisions);
  await chrome.storage.local.set({ [DECISIONS_KEY]: next });
  await recordMaterialDecision(record);
  await updateAttentionTracking(decision).catch(() => undefined);
  setActiveDecision(decision);

  const messages: Record<MaterialDecision, string> = {
    read: 'Решение сохранено: читать материал.',
    skim: 'Показана структура материала.',
    save: 'Материал сохранён локально на потом.',
    skip: 'Решение сохранено: пропустить материал.',
  };
  setPopupStatus(status, 'success', messages[decision]);
  if (decision === 'skim') {
    skimPanel.scrollIntoView({ block: 'start' });
  } else {
    closeExtensionPopup();
  }
}

async function capture(): Promise<void> {
  savedMaterialsController.hide();
  captureButton.disabled = true;
  result.hidden = true;
  feedbackController.resetForCapture();
  setPopupStatus(
    status,
    'default',
    'Извлекаем основной материал и метаданные…',
  );
  try {
    await storageReady;
    const tabId = await getActiveTabId();
    const pageCapture = await requestCapture(tabId);
    const savedLocally = await storeCapture(pageCapture);
    await feedbackController.syncProgress(tabId).catch(() => undefined);
    renderCapture(pageCapture, savedLocally);
    await feedbackController.restorePrompt(pageCapture.url);
    await feedbackController.refreshStats();
    setPopupStatus(
      status,
      savedLocally ? 'success' : 'default',
      savedLocally
        ? 'Материал готов к решению.'
        : 'Материал извлечён, но слишком велик для локального сохранения.',
    );
  } catch (error) {
    setPopupStatus(
      status,
      'error',
      error instanceof Error
        ? `Не удалось обработать страницу: ${error.message}`
        : 'Не удалось обработать эту страницу.',
    );
  } finally {
    captureButton.disabled = false;
  }
}

captureButton.addEventListener('click', () => void capture());
continueOnPageButton.addEventListener('click', () => {
  setPopupStatus(status, 'success', 'Продолжаем на странице.');
  closeExtensionPopup();
});
for (const button of decisionButtons) {
  button.addEventListener('click', () => {
    const decision = button.dataset.decision as MaterialDecision | undefined;
    if (!decision) return;
    void saveDecision(decision).catch(() => {
      setPopupStatus(status, 'error', 'Не удалось сохранить решение локально.');
    });
  });
}

function isRuntimeLifecycleDiagnostic(
  value: unknown,
): value is RuntimeLifecycleDiagnostic {
  if (!value || typeof value !== 'object') return false;
  const diagnostic = value as Record<string, unknown>;
  return (
    typeof diagnostic.matchedTabs === 'number' &&
    typeof diagnostic.activeTabs === 'number' &&
    typeof diagnostic.injectedTabs === 'number' &&
    typeof diagnostic.failedTabs === 'number' &&
    (diagnostic.firstError === null ||
      typeof diagnostic.firstError === 'string') &&
    typeof diagnostic.version === 'string' &&
    typeof diagnostic.checkedAt === 'string'
  );
}

async function refreshRuntimeDiagnostic(): Promise<void> {
  const stored = await chrome.storage.local.get(
    CONTENT_SCRIPT_LIFECYCLE_DIAGNOSTIC_KEY,
  );
  const value = stored[CONTENT_SCRIPT_LIFECYCLE_DIAGNOSTIC_KEY];
  if (!isRuntimeLifecycleDiagnostic(value)) {
    runtimeDiagnostic.hidden = true;
    return;
  }
  if (value.failedTabs > 0) {
    runtimeDiagnostic.hidden = false;
    runtimeDiagnostic.className = 'runtime-diagnostic error';
    runtimeDiagnostic.textContent = `Связь со страницей не установлена: ${value.firstError ?? 'неизвестная ошибка'}`;
    return;
  }
  runtimeDiagnostic.hidden = true;
}

async function initialize(): Promise<void> {
  await storageReady;
  browserHistoryController.initialize();
  await settingsController.initializeLanguage();
  await refreshRuntimeDiagnostic();
  await aiSettingsController.refresh();
  await readwiseController?.refresh();
  await obsidianController?.refresh();
  await notionController?.refresh();
  const stored = await chrome.storage.local.get([
    PROFILE_ONBOARDING_KEY,
    PERSONAL_PROFILE_KEY,
  ]);
  profileOnboarding = new ProfileOnboarding({
    onComplete: startMainApp,
    buildQuickProfile: async (answers) => {
      const settings = await loadAiAnalyzerSettings();
      if (!settings) {
        throw new Error(
          'Сначала подключите AI-анализатор в настройках или используйте импорт из ChatGPT / Claude.',
        );
      }
      return new AiQuickProfileBuilder(settings.apiKey, settings.model).build(
        answers,
      );
    },
  });
  const profileFlowActive = await profileOnboarding.initialize(false);
  await feedbackController.refreshStats();
  if (profileFlowActive) {
    setPopupStatus(
      status,
      'default',
      'Продолжите создание профиля с выбранным AI.',
    );
    return;
  }
  if (
    shouldShowFirstValueOnboarding(
      stored[PROFILE_ONBOARDING_KEY],
      stored[PERSONAL_PROFILE_KEY],
    )
  ) {
    firstValueOnboarding = new FirstValueOnboarding({
      onComplete: completeFirstValue,
    });
    firstValueOnboarding.open();
    return;
  }
  await startMainApp();
}

async function completeFirstValue(
  selection: FirstValueSelection,
): Promise<void> {
  await settingsController.applyFirstValue(selection);
  await completeProfileOnboarding();
  await startMainApp();
}

async function startMainApp(): Promise<void> {
  if (mainStarted) return;
  mainStarted = true;
  settingsHome.hidden = false;
  openSavedMaterialsButton.hidden = false;
  await settingsController.initializeScenario();
  await savedMaterialsController.refresh();
  await browserHistoryController.refresh();
  result.hidden = true;
  privacySettingsPanel.hidden = true;
  readwiseSettingsPanel.hidden = true;
  privacyController?.translate();
  await readwiseController?.refresh();
  await obsidianController?.refresh();
  await notionController?.refresh();
  setPopupStatus(status, 'default', 'Настройки готовы.');
}

void initialize().catch(async (error) => {
  await recordDiagnostic({
    subsystem: 'popup',
    operation: 'initialize',
    code: 'POPUP_INITIALIZATION_FAILED',
    error,
  }).catch(() => undefined);
  setPopupStatus(status, 'error', 'Не удалось запустить расширение.');
});
