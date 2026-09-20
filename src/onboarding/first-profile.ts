import { canPrepareProfileBeforeVault, getVaultStatus } from '../vault/storage';
import { ensureVaultUnlocked, VaultSetupBackError } from '../vault/ui';
import { vaultLocale } from '../i18n/vault';
import { normalizeUiLanguage, UI_LANGUAGE_KEY, type UiLanguage } from '../i18n/ui';
import { loadProfile, saveProfile, deleteProfile } from '../profile/storage';
import { isProfileReady } from '../profile/readiness';
import { DataOperationCancelledError, type DataOperation } from '../privacy/data-operations';
import { ProfileOnboarding } from './profile-onboarding';
import { ProfileSaveDeferredError, type ProfilePersistence } from './profile-persistence';
import { loadProfileHandoffState, saveProfileHandoffState, clearProfileHandoffState } from './handoff/state';
import { firstRunNoticePublisher } from './handoff/first-run-notice';

/** Neither Chrome storage, localStorage nor IndexedDB receives a plaintext draft. */
export function createFirstProfilePersistence(
  protect: (records: Record<string, unknown>) => Promise<void>,
  getLanguage: () => UiLanguage,
  notice?: Awaited<ReturnType<typeof firstRunNoticePublisher>>,
): ProfilePersistence {
  let values: Record<string, unknown> = {};
  const generation = crypto.randomUUID();
  const memory = {
    async get() { return structuredClone(values); },
    async set(items: Record<string, unknown>) {
      values = { ...values, ...structuredClone(items) };
    },
    async remove(keys: string | string[]) {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key];
    },
  };
  async function assertCurrent(operation: DataOperation): Promise<void> {
    if (operation.generation !== generation ||
        await getVaultStatus() !== 'unconfigured')
      throw new DataOperationCancelledError();
  }
  return {
    loadProfile: () => loadProfile(memory),
    deleteProfile: () => deleteProfile(memory),
    loadProfileHandoffState: () => loadProfileHandoffState(memory),
    async saveProfileHandoffState(state) {
      await saveProfileHandoffState(state, memory);
      await notice?.save(state, getLanguage());
    },
    async clearProfileHandoffState() {
      await clearProfileHandoffState(memory);
      await notice?.clear();
    },
    async beginDataOperation() {
      const operation = { generation };
      await assertCurrent(operation);
      return operation;
    },
    assertDataOperationCurrent: assertCurrent,
    async commitDataOperation<T>(operation: DataOperation, work: () => Promise<T>) {
      await assertCurrent(operation);
      // Do not hold the shared data lock while a person edits their password.
      // createVault rechecks fresh state inside its own lifecycle transaction.
      return work();
    },
    async saveProfile(profile, source, importedProfile = profile) {
      if (!isProfileReady(profile)) throw new Error('A profile is required.');
      let records: Record<string, unknown> = {};
      await saveProfile(profile, source, importedProfile, {
        async get() { return {}; },
        async set(items) { records = structuredClone(items); },
        async remove() {},
      });
      records[UI_LANGUAGE_KEY] = getLanguage();
      try {
        await protect(records);
      } catch (error) {
        if (error instanceof VaultSetupBackError) throw new ProfileSaveDeferredError();
        throw error;
      }
      // Used only until the page reloads into the normal, vault-guarded UI.
      await memory.set(records);
    },
  };
}

/** Called before any private popup controller is constructed. Existing vaults keep their gate. */
export async function prepareFirstProfile(): Promise<void> {
  try {
    if (!await canPrepareProfileBeforeVault()) return;
  } catch {
    // Damaged metadata/storage must still reach the regular recovery gate.
    return;
  }
  const query = new URLSearchParams(location.search);
  let language = query.has('language')
    ? normalizeUiLanguage(query.get('language')) : vaultLocale();
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  if (query.get('profileSetup') === '1')
    document.documentElement.dataset.profileWelcomeSeen = 'true';
  const currentTab = await chrome.tabs.getCurrent();
  const notice = currentTab?.id === undefined
    ? undefined : await firstRunNoticePublisher(currentTab.id);
  if (currentTab) document.body.classList.add('profile-setup-tab');
  document.getElementById('profile-setup-settings')!.hidden = true;

  // A toolbar popup disappears when the visitor opens ChatGPT. Move before any
  // personal input, passing only a public language preference and source tab ID.
  if (!currentTab) {
    const start = document.getElementById('profile-start')!;
    start.addEventListener('click', (event) => {
      event.stopImmediatePropagation();
      const url = new URL(chrome.runtime.getURL('popup.html'));
      url.searchParams.set('profileSetup', '1');
      url.searchParams.set('language', language);
      if (/^\d+$/u.test(query.get('sourceTab') ?? ''))
        url.searchParams.set('sourceTab', query.get('sourceTab')!);
      void chrome.tabs.create({ url: url.href, active: true }).then(() => window.close());
    }, { capture: true });
  }
  let dirty = false;
  const warnBeforeLeaving = (event: BeforeUnloadEvent): void => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', warnBeforeLeaving);
  document.getElementById('profile-onboarding')!.addEventListener('input', () => { dirty = true; });
  const controller = new ProfileOnboarding({
    persistence: createFirstProfilePersistence(
      (initialRecords) => ensureVaultUnlocked({ initialRecords, language }),
      () => language,
      notice,
    ),
    onLanguageChange: (selected) => {
      language = selected;
      document.documentElement.lang = selected;
      document.documentElement.dir = selected === 'ar' ? 'rtl' : 'ltr';
      controller.translate();
    },
    onComplete: () => {
      window.removeEventListener('beforeunload', warnBeforeLeaving);
      const url = new URL(location.href);
      url.searchParams.delete('profileSetup');
      url.searchParams.delete('language');
      url.searchParams.set('profileCreated', '1');
      location.replace(url.href);
    },
  });
  await controller.initialize(true);
  // This document owns only the RAM draft. A successful save reloads into the
  // guarded app; a closed tab discards it without initializing private services.
  await new Promise<void>(() => {});
}
