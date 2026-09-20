import type { UiLanguage } from '../../i18n/ui';
import { normalizeUiLanguage } from '../../i18n/ui';
import { isExternalProfileSource } from '../../profile/schema';
import type { WebProfileProvider } from '../../profile/provider-sites';
import {
  PROFILE_IMPORT_HANDOFF_MAX_AGE_MS,
  type ProfileHandoffState,
} from './state';

const KEY = 'attentionFirstRunHandoffNotice';

interface PublicNotice {
  ownerDocumentId: string;
  startedAt: string;
  profileImportProvider: WebProfileProvider;
  profileImportStage: 'waiting-for-response';
  method: 'clipboard-and-web';
  promptCopied: boolean;
  language: UiLanguage;
}

function isSetupDocument(context: chrome.runtime.ExtensionContext): boolean {
  return (
    context.contextType === 'TAB' &&
    context.documentUrl?.split(/[?#]/u)[0] ===
      chrome.runtime.getURL('popup.html')
  );
}

/** Only public prompt flags go into memory-only session storage, never the draft. */
export async function firstRunNoticePublisher(tabId: number) {
  const contexts = await chrome.runtime.getContexts({ tabIds: [tabId] });
  const documentId = contexts.find(isSetupDocument)?.documentId;
  const clear = () =>
    navigator.locks.request(KEY, async () => {
      const stored = (await chrome.storage.session.get(KEY))[KEY] as
        PublicNotice | undefined;
      if (documentId && stored?.ownerDocumentId === documentId)
        await chrome.storage.session.remove(KEY);
    });
  return {
    clear,
    async save(
      state: ProfileHandoffState,
      language: UiLanguage,
    ): Promise<void> {
      if (!documentId) return;
      if (
        state.profileImportProvider === 'other' ||
        state.method !== 'clipboard-and-web'
      ) {
        await clear();
        return;
      }
      const value: PublicNotice = {
        ownerDocumentId: documentId,
        startedAt: state.startedAt,
        profileImportProvider: state.profileImportProvider,
        profileImportStage: 'waiting-for-response',
        method: 'clipboard-and-web',
        promptCopied: state.promptCopied === true,
        language,
      };
      await navigator.locks.request(KEY, () =>
        chrome.storage.session.set({ [KEY]: value }),
      );
    },
  };
}

export async function loadFirstRunHandoffNotice(): Promise<PublicNotice | null> {
  const value: unknown = (await chrome.storage.session.get(KEY))[KEY];
  if (!value || typeof value !== 'object') return null;
  const state = value as Partial<
    Omit<PublicNotice, 'profileImportProvider'>
  > & { profileImportProvider?: unknown };
  const age = Date.now() - Date.parse(state.startedAt ?? '');
  if (
    typeof state.ownerDocumentId !== 'string' ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > PROFILE_IMPORT_HANDOFF_MAX_AGE_MS ||
    !isExternalProfileSource(state.profileImportProvider) ||
    state.profileImportProvider === 'other' ||
    state.profileImportStage !== 'waiting-for-response' ||
    state.method !== 'clipboard-and-web' ||
    typeof state.promptCopied !== 'boolean'
  )
    return null;
  // Reloading or closing setup discards its RAM draft and invalidates the notice.
  const contexts = await chrome.runtime.getContexts({
    documentIds: [state.ownerDocumentId],
  });
  if (!contexts.some(isSetupDocument)) return null;
  return {
    ownerDocumentId: state.ownerDocumentId,
    startedAt: state.startedAt!,
    profileImportProvider: state.profileImportProvider,
    profileImportStage: 'waiting-for-response',
    method: 'clipboard-and-web',
    promptCopied: state.promptCopied,
    language: normalizeUiLanguage(state.language),
  };
}
