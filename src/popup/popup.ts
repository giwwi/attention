import {
  initializeVaultPage,
  installVaultLockControl,
} from '../vault/page-guard';
import { privateStorage, privateStorageChanges } from '../vault/storage';
import { loadAiAnalyzerSettings } from '../analyzer/settings';
import {
  installPilotLauncher,
  translatePilotLauncher,
} from '../pilot/launcher';
import { ProfileOnboarding } from '../onboarding/profile-onboarding';
import { AiQuickProfileBuilder } from '../profile/quick-builder';
import { PERSONAL_PROFILE_KEY, loadProfile } from '../profile/storage';
import { isProfileReady } from '../profile/readiness';
import { AiSettingsController } from './controllers/ai-settings-controller';
import { SavedMaterialsController } from './controllers/saved-materials-controller';
import { PrivacyController } from './controllers/privacy-controller';
import { BrowserHistoryController } from './controllers/browser-history-controller';
import { ReadwiseController } from './controllers/readwise-controller';
import { ObsidianController } from './controllers/obsidian-controller';
import { NotionController } from './controllers/notion-controller';
import { closeExtensionPopup, getElement, setPopupStatus } from './dom';
import { openCardOnActiveTab } from './card-launcher';
import { popupText, translatePopup } from '../i18n/popup';
import { vaultText } from '../i18n/vault';
import {
  popupLauncherText,
  translatePopupLauncher,
  type PopupLauncherTextKey,
} from '../i18n/popup-launcher';
import {
  DEFAULT_UI_LANGUAGE,
  UI_LANGUAGE_KEY,
  normalizeUiLanguage,
  uiText,
  type UiLanguage,
  type UiTextKey,
} from '../i18n/ui';
import {
  NOVEL_PASSAGE_HIGHLIGHTS_KEY,
  novelPassageHighlightsEnabled,
} from '../novelty/settings';
import {
  assertDataOperationCurrent,
  beginDataOperation,
  observeDataOperation,
  commitDataOperation,
  DataOperationCancelledError,
  DATA_GENERATION_KEY,
  type DataOperation,
} from '../privacy/data-operations';

await initializeVaultPage();

const storageReady = privateStorage.setAccessLevel({
  accessLevel: 'TRUSTED_CONTEXTS',
});
const status = getElement<HTMLParagraphElement>('status');
const launcher = getElement<HTMLElement>('launcher-home');
const navigation = getElement<HTMLElement>('launcher-navigation');
const openCardButton = getElement<HTMLButtonElement>('open-page-card');
openCardButton.disabled = true;
const backButton = getElement<HTMLButtonElement>('back-to-launcher');
const settingsHome = getElement<HTMLElement>('settings-home');
const languageSelect = getElement<HTMLSelectElement>('interface-language');
const highlights = getElement<HTMLInputElement>('novel-passage-highlights');
const aiSettingsPanel = getElement<HTMLElement>('ai-settings');
const savedMaterialsView = getElement<HTMLElement>('saved-materials-view');
const privacySettingsPanel = getElement<HTMLElement>('privacy-settings');
const readwiseSettingsPanel = getElement<HTMLElement>('readwise-settings');
const profileRoot = getElement<HTMLElement>('profile-onboarding');
const historyPanel = getElement<HTMLElement>('browser-history-setup');
let language: UiLanguage = DEFAULT_UI_LANGUAGE;
let popupInvalidated = false;
let popupOperation: DataOperation | null = null;
let needsOnboarding = true;
let profileOnboarding: ProfileOnboarding | null = null;
let launchStatus: PopupLauncherTextKey | null = null;
const browserHistory = new BrowserHistoryController();
const ai = new AiSettingsController({
  status,
  settingsHome,
  savedMaterialsView,
  readwiseSettingsPanel,
  privacySettingsPanel,
  result: launcher,
  getLanguage: () => language,
  isMainStarted: () => !popupInvalidated,
  onSettingsChanged: () => undefined,
});
const saved = new SavedMaterialsController({
  status,
  settingsHome,
  aiSettingsPanel,
  readwiseSettingsPanel,
  privacySettingsPanel,
  result: launcher,
  getLanguage: () => language,
  isMainStarted: () => !popupInvalidated,
  onShow: () => {
    navigation.hidden = true;
    backButton.hidden = false;
    clearStatus();
  },
  onClose: showLauncher,
});
const privacy = new PrivacyController({
  status,
  settingsHome,
  savedMaterialsView,
  aiSettingsPanel,
  readwiseSettingsPanel,
  result: launcher,
  getLanguage: () => language,
  isMainStarted: () => !popupInvalidated,
  onModeChanged: () => undefined,
});
const readwise = new ReadwiseController({
  status,
  profileRoot,
  savedMaterialsView,
  aiSettingsPanel,
  privacySettingsPanel,
  result: launcher,
  getLanguage: () => language,
  onEvidenceChanged: () => undefined,
});
const obsidian = new ObsidianController({ getLanguage: () => language });
const notion = new NotionController(() => language);
installPilotLauncher();

function clearStatus(): void {
  launchStatus = null;
  setPopupStatus(status, 'default', '');
}
async function currentPopupOperation(): Promise<DataOperation> {
  const operation = popupOperation;
  if (popupInvalidated || !operation) throw new DataOperationCancelledError();
  await assertDataOperationCurrent(operation);
  return operation;
}
function showStatus(key: PopupLauncherTextKey, error = false): void {
  launchStatus = key;
  setPopupStatus(
    status,
    error ? 'error' : 'default',
    popupLauncherText(language, key),
  );
}
function hidePanels(): void {
  for (const panel of [
    launcher,
    settingsHome,
    savedMaterialsView,
    aiSettingsPanel,
    privacySettingsPanel,
    readwiseSettingsPanel,
    profileRoot,
    historyPanel,
  ])
    panel.hidden = true;
  document.body.classList.remove('profile-flow-active', 'history-flow-active');
  // Clear the unsaved secret when navigating away from its form.
  getElement<HTMLInputElement>('ai-gateway-key').value = '';
}
function showLauncher(): void {
  if (popupInvalidated) return;
  hidePanels();
  navigation.hidden = false;
  getElement<HTMLButtonElement>('open-saved-materials').setAttribute(
    'aria-expanded',
    'false',
  );
  backButton.hidden = true;
  clearStatus();
  if (needsOnboarding) {
    navigation.hidden = true;
    void profileOnboarding
      ?.openSource()
      .catch(() => showStatus('unavailable', true));
  } else launcher.hidden = false;
}
function showSettings(): void {
  if (popupInvalidated) return;
  hidePanels();
  navigation.hidden = true;
  backButton.hidden = false;
  settingsHome.hidden = false;
  clearStatus();
}
function translate(): void {
  document.documentElement.lang = language;
  const lockButton = document.getElementById('vault-lock');
  if (lockButton) lockButton.textContent = vaultText(language, 'lock');
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  languageSelect.value = language;
  languageSelect.setAttribute(
    'aria-label',
    popupLauncherText(language, 'language'),
  );
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    element.textContent = uiText(language, element.dataset.i18n as UiTextKey);
  }
  for (const element of document.querySelectorAll<HTMLInputElement>(
    '[data-i18n-placeholder]',
  )) {
    element.placeholder = uiText(
      language,
      element.dataset.i18nPlaceholder as UiTextKey,
    );
  }
  translatePopup(language);
  translatePopupLauncher(language);
  translatePilotLauncher(language);
  ai.renderState();
  privacy.translate();
  readwise.translate();
  obsidian.translate();
  notion.translate();
  if (launchStatus)
    status.textContent = popupLauncherText(language, launchStatus);
}

async function launchCard(suppliedOperation?: DataOperation): Promise<void> {
  if (popupInvalidated || openCardButton.disabled) return;
  if (!isProfileReady(await loadProfile())) {
    needsOnboarding = true;
    openCardButton.disabled = true;
    showLauncher();
    return;
  }
  openCardButton.disabled = true;
  showStatus('opening');
  try {
    const operation = suppliedOperation ?? (await currentPopupOperation());
    const result = await openCardOnActiveTab(async () => {
      if (popupInvalidated) throw new DataOperationCancelledError();
      await assertDataOperationCurrent(operation);
    });
    await assertDataOperationCurrent(operation);
    if (popupInvalidated) return;
    if (result.ok) closeExtensionPopup();
    else if (result.reason === 'profile_required') {
      needsOnboarding = true;
      showLauncher();
    } else
      showStatus(
        result.reason === 'protected_page'
          ? 'protectedPage'
          : result.reason === 'not_article'
            ? 'notArticle'
            : 'unavailable',
        result.reason === 'unavailable',
      );
  } catch (error) {
    if (!(error instanceof DataOperationCancelledError))
      showStatus('unavailable', true);
  } finally {
    openCardButton.disabled = needsOnboarding;
  }
}

getElement<HTMLButtonElement>('open-popup-settings').addEventListener(
  'click',
  showSettings,
);
backButton.addEventListener('click', showLauncher);
getElement<HTMLButtonElement>('profile-setup-settings').addEventListener(
  'click',
  showSettings,
);
openCardButton.addEventListener('click', () => void launchCard());
for (const [element, key] of [
  [languageSelect, UI_LANGUAGE_KEY],
  [highlights, NOVEL_PASSAGE_HIGHLIGHTS_KEY],
] as const) {
  element.addEventListener('change', () => {
    if (popupInvalidated) return;
    const value =
      key === UI_LANGUAGE_KEY
        ? normalizeUiLanguage(languageSelect.value)
        : highlights.checked;
    void currentPopupOperation()
      .then(async (operation) => {
        await commitDataOperation(operation, () =>
          privateStorage.set({ [key]: value }),
        );
        if (popupInvalidated) return;
        if (key === UI_LANGUAGE_KEY) {
          language = value as UiLanguage;
          translate();
          if (saved.isVisible) await saved.refresh();
        }
      })
      .catch((error) => {
        if (!(error instanceof DataOperationCancelledError))
          setPopupStatus(
            status,
            'error',
            popupText(language, 'settingsFailed'),
          );
      });
  });
}

let profileRefreshRevision = 0;
privateStorageChanges.addListener((changes, area) => {
  if (
    area !== 'local' ||
    !(PERSONAL_PROFILE_KEY in changes) ||
    popupInvalidated
  )
    return;
  const revision = ++profileRefreshRevision;
  openCardButton.disabled = true;
  void loadProfile()
    .then(async (profile) => {
      if (popupInvalidated || revision !== profileRefreshRevision) return;
      const wasRequired = needsOnboarding;
      needsOnboarding = !isProfileReady(profile);
      openCardButton.disabled = needsOnboarding;
      await profileOnboarding?.refreshProfile();
      if (!wasRequired && needsOnboarding) showLauncher();
      else if (wasRequired && !needsOnboarding && profileRoot.hidden)
        showLauncher();
    })
    .catch(() => {
      needsOnboarding = true;
      openCardButton.disabled = true;
    });
});

privateStorageChanges.addListener((changes, area) => {
  const changed = changes[DATA_GENERATION_KEY];
  if (area !== 'local' || !changed || changed.newValue === changed.oldValue)
    return;
  popupInvalidated = true;
  popupOperation = null;
  for (const field of document.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement
  >('input, textarea')) {
    field.value = '';
  }
  ai.resetAfterErasure();
  profileOnboarding?.resetAfterErasure();
  profileOnboarding = null;
  const panel = document.createElement('main');
  panel.className = 'shell';
  panel.id = 'erased-data-view';
  const heading = document.createElement('h1');
  heading.textContent = 'Attention';
  const message = document.createElement('p');
  message.textContent = popupText(language, 'dataChanged');
  const restart = document.createElement('button');
  restart.className = 'primary-button';
  restart.id = 'restart-after-erasure';
  restart.type = 'button';
  restart.textContent = popupText(language, 'restart');
  restart.addEventListener('click', () => {
    window.location.reload();
  });
  panel.append(heading, message, restart);
  document.body.className = '';
  document.body.replaceChildren(panel);
  restart.focus();
});

async function initialize(): Promise<void> {
  const operation = await beginDataOperation();
  popupOperation = operation;
  await storageReady;
  const stored = await privateStorage.get([
    UI_LANGUAGE_KEY,
    NOVEL_PASSAGE_HIGHLIGHTS_KEY,
    PERSONAL_PROFILE_KEY,
  ]);
  await assertDataOperationCurrent(operation);
  language = normalizeUiLanguage(stored[UI_LANGUAGE_KEY]);
  highlights.checked = novelPassageHighlightsEnabled(
    stored[NOVEL_PASSAGE_HIGHLIGHTS_KEY],
  );
  // Construct before translating: profile forms retain their original labels
  // for the existing nine-language profile translator.
  profileOnboarding = new ProfileOnboarding({
    onComplete: async () => {
      needsOnboarding = !isProfileReady(await loadProfile());
      openCardButton.disabled = needsOnboarding;
      showLauncher();
      if (!needsOnboarding) openCardButton.focus();
    },
    buildQuickProfile: async (answers) => {
      const operation = await beginDataOperation();
      const cancellation = await observeDataOperation(operation);
      try {
        const settings = await loadAiAnalyzerSettings();
        if (!settings) throw new Error(uiText(language, 'connectAi'));
        await assertDataOperationCurrent(operation);
        return await new AiQuickProfileBuilder(
          settings.apiKey,
          settings.model,
        ).build(answers, new Date(), cancellation.signal);
      } finally {
        cancellation.dispose();
      }
    },
  });
  translate();
  await browserHistory.initialize();
  await Promise.all([
    ai.refresh(),
    saved.refresh(),
    readwise.refresh(),
    obsidian.refresh(),
    notion.refresh(),
  ]);
  await assertDataOperationCurrent(operation);
  const restoredProfile = await profileOnboarding.initialize(false);
  await assertDataOperationCurrent(operation);
  if (popupInvalidated) return;
  needsOnboarding = !isProfileReady(await loadProfile());
  openCardButton.disabled = needsOnboarding;
  if (restoredProfile) {
    launcher.hidden = true;
    navigation.hidden = true;
    backButton.hidden = false;
  } else showLauncher();
}
void initialize()
  .then(installVaultLockControl)
  .catch((error) => {
    if (!(error instanceof DataOperationCancelledError))
      showStatus('unavailable', true);
  });
