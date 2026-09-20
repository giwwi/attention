import { loadProfileHandoffState } from '../onboarding/handoff/state';
import { loadFirstRunHandoffNotice } from '../onboarding/handoff/first-run-notice';
import { UI_LANGUAGE_KEY, normalizeUiLanguage } from '../i18n/ui';
import { loadProfile } from '../profile/storage';
import { isProfileReady } from '../profile/readiness';
import { profileProviderAtUrl } from '../profile/provider-sites';
import {
  getVaultEpoch,
  getVaultStatus,
  onVaultStateChanged,
  privateStorage,
} from '../vault/storage';
import {
  VAULT_CHANGED_TYPE,
  VAULT_HANDOFF_NOTICE_TYPE,
  VAULT_STATUS_TYPE,
  PROFILE_SETUP_OPEN_TYPE,
  type VaultPublicStatus,
} from '../vault/messages';

async function publicStatus(): Promise<VaultPublicStatus> {
  try {
    const status = await getVaultStatus();
    if (status !== 'unlocked')
      return {
        ok: true,
        unlocked: false,
        unconfigured: status === 'unconfigured',
      };
    const epoch = await getVaultEpoch();
    const profileReady = isProfileReady(await loadProfile());
    if (epoch !== (await getVaultEpoch())) throw new Error('Vault changed.');
    return { ok: true, unlocked: true, epoch, profileReady };
  } catch {
    return { ok: true, unlocked: false };
  }
}

export function installVaultMessages(): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!message || typeof message !== 'object') return;
    const type = (message as { type?: unknown }).type;
    if (
      type !== VAULT_STATUS_TYPE &&
      type !== VAULT_HANDOFF_NOTICE_TYPE &&
      type !== PROFILE_SETUP_OPEN_TYPE
    )
      return;
    if (sender.id !== chrome.runtime.id) {
      respond({ ok: false });
      return;
    }
    if (type === VAULT_STATUS_TYPE) {
      void publicStatus().then(respond);
      return true;
    }
    if (type === PROFILE_SETUP_OPEN_TYPE) {
      // No caller-supplied destination: a trusted card gesture can only open
      // our own setup page, which protects the reviewed profile before saving.
      if (
        sender.frameId !== 0 ||
        typeof sender.tab?.id !== 'number' ||
        !/^https?:\/\//u.test(sender.url ?? '')
      ) {
        respond({ ok: false });
        return;
      }
      void chrome.tabs
        .create({
          url:
            chrome.runtime.getURL('popup.html') + '?sourceTab=' + sender.tab.id,
          active: true,
        })
        .then(
          () => respond({ ok: true }),
          () => respond({ ok: false }),
        );
      return true;
    }
    const provider = profileProviderAtUrl(sender.url ?? '');
    if (!provider || sender.frameId !== 0) {
      respond({ ok: false });
      return;
    }
    void (async () => {
      const status = await getVaultStatus();
      if (status === 'unconfigured') {
        const state = await loadFirstRunHandoffNotice();
        if ((await getVaultStatus()) !== 'unconfigured')
          throw new Error('Vault changed.');
        respond({
          ok: true,
          state:
            state?.profileImportProvider === provider
              ? {
                  profileImportProvider: state.profileImportProvider,
                  profileImportStage: state.profileImportStage,
                  method: state.method,
                  promptCopied: state.promptCopied,
                  language: state.language,
                }
              : null,
        });
        return;
      }
      if (status !== 'unlocked') {
        respond({ ok: false });
        return;
      }
      const epoch = await getVaultEpoch();
      const state = await loadProfileHandoffState();
      const settings = await privateStorage.get(UI_LANGUAGE_KEY);
      if (epoch !== (await getVaultEpoch())) throw new Error('Vault changed.');
      // Only the flags for a fixed, public prompt leave the trusted context.
      respond({
        ok: true,
        state:
          state?.profileImportProvider === provider
            ? {
                profileImportProvider: state.profileImportProvider,
                profileImportStage: state.profileImportStage,
                method: state.method,
                promptCopied: state.promptCopied,
                language: normalizeUiLanguage(settings[UI_LANGUAGE_KEY]),
              }
            : null,
      });
    })().catch(() => respond({ ok: false }));
    return true;
  });

  onVaultStateChanged(() => {
    // Suspend immediately: a status read may wait behind a slow reset/IDB lock.
    void chrome.tabs
      .query({ url: ['http://*/*', 'https://*/*'] })
      .then((tabs) =>
        Promise.allSettled(
          tabs
            .filter((tab) => tab.id !== undefined)
            .map((tab) =>
              chrome.tabs.sendMessage(tab.id!, { type: VAULT_CHANGED_TYPE }),
            ),
        ),
      )
      .catch(() => undefined);
  });
}
