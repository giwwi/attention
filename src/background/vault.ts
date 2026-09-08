import { loadProfileHandoffState } from '../onboarding/handoff/state';
import { loadProfile } from '../profile/storage';
import { isProfileReady } from '../profile/readiness';
import { getVaultEpoch, onVaultStateChanged } from '../vault/storage';
import {
  VAULT_CHANGED_TYPE,
  VAULT_HANDOFF_NOTICE_TYPE,
  VAULT_STATUS_TYPE,
  type VaultPublicStatus,
} from '../vault/messages';

async function publicStatus(): Promise<VaultPublicStatus> {
  try {
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
    if (type !== VAULT_STATUS_TYPE && type !== VAULT_HANDOFF_NOTICE_TYPE)
      return;
    if (sender.id !== chrome.runtime.id) {
      respond({ ok: false });
      return;
    }
    if (type === VAULT_STATUS_TYPE) {
      void publicStatus().then(respond);
      return true;
    }
    let allowed = false;
    try {
      const url = new URL(sender.url ?? '');
      allowed =
        sender.frameId === 0 &&
        url.protocol === 'https:' &&
        (url.hostname === 'chatgpt.com' ||
          url.hostname.endsWith('.chatgpt.com'));
    } catch {
      /* Invalid senders receive no state. */
    }
    if (!allowed) {
      respond({ ok: false });
      return;
    }
    void (async () => {
      const epoch = await getVaultEpoch();
      const state = await loadProfileHandoffState();
      if (epoch !== (await getVaultEpoch())) throw new Error('Vault changed.');
      // Only the flags for a fixed, public prompt leave the trusted context.
      respond({
        ok: true,
        state: state
          ? {
              profileImportProvider: state.profileImportProvider,
              profileImportStage: state.profileImportStage,
              method: state.method,
              promptCopied: state.promptCopied,
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
