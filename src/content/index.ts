import { startContentRuntime } from './runtime';
import {
  VAULT_CHANGED_TYPE,
  VAULT_STATUS_TYPE,
  type VaultPublicStatus,
} from '../vault/messages';
import {
  CONTENT_RUNTIME_PING_TYPE,
  CAPTURE_MESSAGE_TYPE,
} from '../shared/types';
import { EXTENSION_RUNTIME_VERSION } from '../shared/version';
import { isAttentionInputsInvalidatedMessage } from '../background/input-invalidation';
import { ATTENTION_CARD_OPEN_TYPE } from '../shared/card-messages';
import { installChatGptProfileHandoffNotice } from './profile-handoff-notice';

interface GateGlobal {
  __attentionVaultGateStop?: () => void;
}
const scope = globalThis as typeof globalThis & GateGlobal;
scope.__attentionVaultGateStop?.();
let stopped = false;
let requestRevision = 0;
let activeEpoch: string | undefined;
let stopRuntime: (() => void) | undefined;
let handoffAbort: AbortController | undefined;
let vaultUnlocked = false;

function suspend(): void {
  stopRuntime?.();
  stopRuntime = undefined;
  activeEpoch = undefined;
  handoffAbort?.abort();
  handoffAbort = undefined;
}

async function reconcile(): Promise<void> {
  const revision = ++requestRevision;
  try {
    // No article text, URL, DOM or reading activity is gathered for this check.
    const state: VaultPublicStatus = await chrome.runtime.sendMessage({
      type: VAULT_STATUS_TYPE,
    });
    if (stopped || revision !== requestRevision) return;
    vaultUnlocked = Boolean(state?.ok && state.unlocked);
    if (!state?.ok || !state.unlocked || !state.epoch) {
      suspend();
      return;
    }
    // Import instructions still work on ChatGPT before a profile exists.
    // Article capture, hover, keyboard launchers and reading tracking do not.
    if (!handoffAbort) {
      handoffAbort = new AbortController();
      void installChatGptProfileHandoffNotice({
        signal: handoffAbort.signal,
      }).catch(() => undefined);
    }
    if (state.profileReady !== true) {
      stopRuntime?.();
      stopRuntime = undefined;
      activeEpoch = undefined;
      return;
    }
    if (activeEpoch === state.epoch) return;
    stopRuntime?.();
    activeEpoch = state.epoch;
    stopRuntime = startContentRuntime();
  } catch {
    if (!stopped && revision === requestRevision) suspend();
  }
}

const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
  message: unknown,
  sender,
  sendResponse,
) => {
  if (!message || typeof message !== 'object') return;
  const type = (message as { type?: unknown }).type;
  const profileChanged =
    isAttentionInputsInvalidatedMessage(message) &&
    message.changedKeys.some(
      (key) => key === 'personalProfile' || key === 'attentionDataGeneration',
    );
  if (
    (type === VAULT_CHANGED_TYPE || profileChanged) &&
    sender.id === chrome.runtime.id
  ) {
    // Clear the old runtime before an asynchronous status read can finish.
    suspend();
    void reconcile();
  } else if (type === CONTENT_RUNTIME_PING_TYPE) {
    sendResponse({ ok: true, version: EXTENSION_RUNTIME_VERSION });
  } else if (type === CAPTURE_MESSAGE_TYPE && !activeEpoch) {
    sendResponse({
      ok: false,
      error: vaultUnlocked ? 'profile_required' : 'vault_locked',
    });
  } else if (type === ATTENTION_CARD_OPEN_TYPE && !activeEpoch) {
    sendResponse({
      ok: false,
      reason: vaultUnlocked ? 'profile_required' : 'unavailable',
    });
  }
};
chrome.runtime.onMessage.addListener(listener);
scope.__attentionVaultGateStop = () => {
  stopped = true;
  ++requestRevision;
  suspend();
  chrome.runtime.onMessage.removeListener(listener);
};
void reconcile();
