import { loadProfileHandoffState } from '../onboarding/handoff/state';
import { VAULT_HANDOFF_NOTICE_TYPE } from '../vault/messages';
import { PROFILE_PROVIDERS } from '../profile/providers';
import { normalizeUiLanguage, type UiLanguage } from '../i18n/ui';
import { handoffNoticeCopy } from '../i18n/handoff-notice';
import { profileProviderAtUrl } from '../profile/provider-sites';

const NOTICE_SELECTOR = '[data-attention-profile-handoff-notice="true"]';

interface StorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface ProfileHandoffNoticeOptions {
  currentUrl?: string;
  storage?: StorageArea;
  copyText?: (text: string) => Promise<void>;
  platform?: string;
  language?: UiLanguage;
  signal?: AbortSignal;
}

function pasteShortcut(platform: string): string {
  return /mac|iphone|ipad/iu.test(platform) ? '⌘V' : 'Ctrl+V';
}

export async function installProfileHandoffNotice(
  options: ProfileHandoffNoticeOptions = {},
): Promise<HTMLElement | null> {
  const currentUrl = options.currentUrl ?? window.location.href;
  const provider = profileProviderAtUrl(currentUrl);
  if (!provider) return null;

  const state = options.storage
    ? await loadProfileHandoffState(options.storage)
    : (await chrome.runtime.sendMessage({ type: VAULT_HANDOFF_NOTICE_TYPE }))
        ?.state;
  if (options.signal?.aborted) return null;
  if (
    state?.profileImportProvider !== provider ||
    state.profileImportStage !== 'waiting-for-response' ||
    state.method !== 'clipboard-and-web'
  ) {
    return null;
  }

  document
    .querySelectorAll<HTMLElement>(NOTICE_SELECTOR)
    .forEach((element) => element.remove());
  const host = document.createElement('aside');
  host.dataset.attentionProfileHandoffNotice = 'true';
  Object.assign(host.style, {
    all: 'initial',
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '2147483647',
  });
  const shadow = host.attachShadow({ mode: 'open' });
  const language = normalizeUiLanguage(options.language ?? state.language);
  const base = handoffNoticeCopy[language];
  const providerName = PROFILE_PROVIDERS[provider].name;
  const text = {
    ...base,
    paste: base.paste.replaceAll('{provider}', providerName),
    copyFailed: base.copyFailed.replaceAll('{provider}', providerName),
    returnReply: base.returnReply.replaceAll('{provider}', providerName),
  };
  host.lang = language;
  host.dir = language === 'ar' ? 'rtl' : 'ltr';
  const shortcut = pasteShortcut(
    options.platform ?? navigator.platform ?? navigator.userAgent,
  );
  const style = document.createElement('style');
  style.textContent = `
    .notice { box-sizing: border-box; width: min(380px, calc(100vw - 40px)); border: 1px solid rgba(63,207,142,.72); border-radius: 16px; padding: 16px; color: #eefaf4; background: #11231d; box-shadow: 0 18px 52px rgba(0,0,0,.38); font: 500 14px/1.45 Inter, ui-sans-serif, system-ui, sans-serif; }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    strong { display: block; font-size: 16px; line-height: 1.25; }
    p { margin: 8px 0 14px; color: rgba(238,250,244,.76); }
    kbd { border: 1px solid rgba(255,255,255,.22); border-radius: 5px; padding: 1px 5px; color: #fff; background: rgba(255,255,255,.08); font: 700 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .actions { display: flex; align-items: center; gap: 10px; }
    button { border: 1px solid rgba(255,255,255,.2); border-radius: 9px; padding: 9px 11px; color: inherit; background: rgba(255,255,255,.07); font: 700 12px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
    button:hover { background: rgba(255,255,255,.13); }
    button:focus-visible { outline: 2px solid #70dfad; outline-offset: 2px; }
    .close { border: 0; padding: 2px 4px; background: transparent; font-size: 20px; }
    .status { min-height: 17px; color: #91d8b7; font-size: 11px; }
  `;
  const notice = document.createElement('section');
  notice.className = 'notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  const head = document.createElement('div');
  head.className = 'head';
  const title = document.createElement('strong');
  title.textContent = state.promptCopied ? text.copied : text.copyPrompt;
  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.setAttribute('aria-label', text.close);
  close.textContent = '×';
  head.append(title, close);
  const explanation = document.createElement('p');
  const showPasteInstructions = (): void => {
    const [before = '', after = ''] = text.paste.split('{shortcut}');
    const key = document.createElement('kbd');
    key.textContent = shortcut;
    explanation.replaceChildren(before, key, after);
  };
  if (state.promptCopied) {
    showPasteInstructions();
  } else {
    explanation.textContent = text.copyFailed;
  }
  const returnReply = document.createElement('p');
  returnReply.textContent = text.returnReply;
  const actions = document.createElement('div');
  actions.className = 'actions';
  const copy = document.createElement('button');
  copy.className = 'copy';
  copy.type = 'button';
  copy.textContent = state.promptCopied ? text.copyAgain : text.copyPrompt;
  const status = document.createElement('span');
  status.className = 'status';
  actions.append(copy, status);
  notice.append(head, explanation, returnReply, actions);
  shadow.append(style, notice);

  const listeners = new AbortController();
  const dismiss = (): void => {
    listeners.abort();
    host.remove();
  };
  options.signal?.addEventListener('abort', dismiss, { once: true });
  close.addEventListener('click', dismiss, { signal: listeners.signal });
  document.addEventListener('paste', dismiss, {
    once: true,
    capture: true,
    signal: listeners.signal,
  });
  copy.addEventListener(
    'click',
    () => {
      const copyText =
        options.copyText ??
        (async (text: string) => {
          try {
            await navigator.clipboard.writeText(text);
          } catch {
            // Some pages restrict the Clipboard API. A user-initiated copy
            // from our own selected field needs no broader extension permission.
            const previousFocus =
              shadow.activeElement ?? document.activeElement;
            const field = document.createElement('textarea');
            field.value = text;
            field.style.cssText = 'position:fixed;left:-10000px;top:0;';
            shadow.append(field);
            try {
              field.focus({ preventScroll: true });
              field.select();
              if (!document.execCommand('copy'))
                throw new Error('Copy failed.');
            } finally {
              field.remove();
              if (previousFocus instanceof HTMLElement)
                previousFocus.focus({ preventScroll: true });
            }
          }
        });
      void copyText(PROFILE_PROVIDERS[provider].prompt)
        .then(() => {
          title.textContent = text.copied;
          showPasteInstructions();
          status.textContent = text.copiedStatus;
          copy.textContent = text.copyAgain;
        })
        .catch(() => {
          status.textContent = text.copyError;
        });
    },
    { signal: listeners.signal },
  );

  document.documentElement.append(host);
  return host;
}
