import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vaultLocale, vaultText } from '../src/i18n/vault';
import type { UiLanguage } from '../src/i18n/ui';

const vault = vi.hoisted(() => ({
  getVaultStatus: vi.fn(),
  createVault: vi.fn(),
  unlockVault: vi.fn(),
  lockVault: vi.fn(),
  resetVault: vi.fn(),
}));
vi.mock('../src/vault/storage', () => vault);

async function loadUi() {
  return import('../src/vault/ui');
}

function input(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function button(id: string): HTMLButtonElement {
  return document.getElementById(id) as HTMLButtonElement;
}

function submit(): void {
  document
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function acknowledgeReset(): void {
  input('vault-reset-acknowledge').checked = true;
  input('vault-reset-acknowledge').dispatchEvent(new Event('change'));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  document.head.innerHTML = '';
  document.body.innerHTML =
    '<main id="private-app"><p>Private imported material</p><input id="private-draft" value="Unsaved private draft"></main>';
  vi.stubGlobal('chrome', {
    i18n: { getUILanguage: () => 'en-US' },
    storage: {
      local: {
        get: vi.fn(() => {
          throw new Error('The gate must not read private settings');
        }),
      },
    },
  });
  vault.getVaultStatus.mockResolvedValue('locked');
  vault.createVault.mockResolvedValue(undefined);
  vault.unlockVault.mockResolvedValue(undefined);
  vault.lockVault.mockResolvedValue(undefined);
  vault.resetVault.mockResolvedValue(undefined);
});

describe('vault entry gate', () => {
  it('loads a packaged stylesheet that the extension security policy permits', async () => {
    const { ensureVaultUnlocked } = await loadUi();
    void ensureVaultUnlocked();
    const stylesheet = document.getElementById(
      'vault-ui-styles',
    ) as HTMLLinkElement;
    expect(stylesheet.tagName).toBe('LINK');
    expect(stylesheet.rel).toBe('stylesheet');
    expect(stylesheet.getAttribute('href')).toBe('vault.css');
    expect(document.querySelector('style')).toBeNull();
  });

  it('removes private content before the initial status read completes', async () => {
    vault.getVaultStatus.mockReturnValue(new Promise(() => {}));
    const { ensureVaultUnlocked } = await loadUi();
    void ensureVaultUnlocked();
    expect(document.getElementById('vault-gate')).not.toBeNull();
    expect(document.getElementById('private-app')).toBeNull();
    expect(document.body.textContent).not.toContain(
      'Private imported material',
    );
    expect(document.body.innerHTML).not.toContain('Unsaved private draft');
    expect(document.querySelector('form')).toBeNull();
  });

  it('restores the original DOM and listeners when the vault is already unlocked', async () => {
    vault.getVaultStatus.mockResolvedValue('unlocked');
    const original = document.getElementById('private-app');
    const listener = vi.fn();
    original!.addEventListener('click', listener);
    const { ensureVaultUnlocked } = await loadUi();
    await ensureVaultUnlocked();
    expect(document.getElementById('vault-gate')).toBeNull();
    expect(document.getElementById('private-app')).toBe(original);
    original!.click();
    expect(listener).toHaveBeenCalledOnce();
    expect(vault.unlockVault).not.toHaveBeenCalled();
  });

  it('shares one gate between concurrent initialization requests', async () => {
    const { ensureVaultUnlocked } = await loadUi();
    const first = ensureVaultUnlocked();
    const second = ensureVaultUnlocked();
    expect(second).toBe(first);
    await flush();
    expect(document.querySelectorAll('#vault-gate')).toHaveLength(1);
    expect(vault.getVaultStatus).toHaveBeenCalledOnce();
  });

  it('keeps the gate closed after a wrong password and clears the password immediately', async () => {
    let rejectUnlock!: (reason: Error) => void;
    vault.unlockVault.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectUnlock = reject;
      }),
    );
    const { ensureVaultUnlocked } = await loadUi();
    const unlocked = vi.fn();
    void ensureVaultUnlocked().then(unlocked);
    await flush();
    input('vault-password').value = 'wrong-password-private';
    input('vault-show-password').checked = true;
    input('vault-show-password').dispatchEvent(new Event('change'));
    expect(input('vault-password').type).toBe('text');
    submit();
    expect(vault.unlockVault).toHaveBeenCalledExactlyOnceWith(
      'wrong-password-private',
    );
    expect(input('vault-password').value).toBe('');
    expect(input('vault-password').type).toBe('password');
    expect(input('vault-show-password').checked).toBe(false);
    expect(button('vault-submit').disabled).toBe(true);
    expect(button('vault-reset').disabled).toBe(true);
    rejectUnlock(new Error('Untrusted storage error containing private data'));
    await flush();
    expect(unlocked).not.toHaveBeenCalled();
    expect(document.getElementById('private-app')).toBeNull();
    expect(button('vault-submit').disabled).toBe(false);
    expect(document.getElementById('vault-status')!.textContent).toContain(
      'Incorrect password',
    );
    expect(document.body.textContent).not.toContain('Untrusted storage error');
    expect(document.activeElement).toBe(input('vault-password'));
  });

  it('requires matching passwords and clears both fields after validation fails', async () => {
    vault.getVaultStatus.mockResolvedValue('unconfigured');
    const { ensureVaultUnlocked } = await loadUi();
    void ensureVaultUnlocked();
    await flush();
    input('vault-password').value = 'long-safe-password';
    input('vault-confirm-password').value = 'a-different-password';
    submit();
    expect(vault.createVault).not.toHaveBeenCalled();
    expect(vault.unlockVault).not.toHaveBeenCalled();
    expect(input('vault-password').value).toBe('');
    expect(input('vault-confirm-password').value).toBe('');
    expect(document.getElementById('vault-status')!.textContent).toContain(
      'do not match',
    );
    expect(document.getElementById('private-app')).toBeNull();
  });

  it('enforces the twelve-character minimum before attempting creation', async () => {
    vault.getVaultStatus.mockResolvedValue('unconfigured');
    const { ensureVaultUnlocked } = await loadUi();
    void ensureVaultUnlocked();
    await flush();
    input('vault-password').value = 'short';
    input('vault-confirm-password').value = 'short';
    submit();
    expect(vault.createVault).not.toHaveBeenCalled();
    expect(document.getElementById('vault-status')!.textContent).toContain(
      'at least 12',
    );
    expect(input('vault-password').value).toBe('');
  });

  it('opens the app only after creation completes and the unlocked status is verified', async () => {
    let finishCreate!: () => void;
    vault.getVaultStatus
      .mockResolvedValueOnce('unconfigured')
      .mockResolvedValue('unlocked');
    vault.createVault.mockReturnValue(
      new Promise<void>((resolve) => {
        finishCreate = resolve;
      }),
    );
    const { ensureVaultUnlocked } = await loadUi();
    const pending = ensureVaultUnlocked();
    await flush();
    input('vault-password').value = 'correct-horse-battery';
    input('vault-confirm-password').value = 'correct-horse-battery';
    submit();
    expect(input('vault-password').value).toBe('');
    expect(input('vault-confirm-password').value).toBe('');
    expect(document.getElementById('private-app')).toBeNull();
    finishCreate();
    await pending;
    expect(vault.createVault).toHaveBeenCalledExactlyOnceWith(
      'correct-horse-battery',
    );
    expect(vault.getVaultStatus).toHaveBeenCalledTimes(2);
    expect(document.getElementById('private-app')).not.toBeNull();
    expect(document.getElementById('vault-password')).toBeNull();
  });

  it('does not restore the app if the vault locks before unlock verification', async () => {
    const { ensureVaultUnlocked } = await loadUi();
    const unlocked = vi.fn();
    void ensureVaultUnlocked().then(unlocked);
    await flush();
    input('vault-password').value = 'correct-horse-battery';
    submit();
    await flush();
    expect(vault.unlockVault).toHaveBeenCalledOnce();
    expect(unlocked).not.toHaveBeenCalled();
    expect(document.getElementById('private-app')).toBeNull();
    expect(button('vault-submit').disabled).toBe(false);
  });

  it('requires a separate deletion acknowledgment and allows cancellation without deleting', async () => {
    const { ensureVaultUnlocked } = await loadUi();
    void ensureVaultUnlocked();
    await flush();
    const previousPassword = input('vault-password');
    previousPassword.value = 'unsaved-password';
    button('vault-reset').click();
    expect(previousPassword.value).toBe('');
    expect(document.getElementById('vault-password')).toBeNull();
    expect(button('vault-reset-confirm').disabled).toBe(true);
    button('vault-reset-confirm').click();
    expect(vault.resetVault).not.toHaveBeenCalled();
    expect(
      document.getElementById('vault-reset-warning')!.textContent,
    ).toContain('permanently deletes all local Attention data');
    expect(
      document.getElementById('vault-reset-warning')!.textContent,
    ).toContain('Original source files are unaffected');
    acknowledgeReset();
    expect(button('vault-reset-confirm').disabled).toBe(false);
    button('vault-reset-cancel').click();
    expect(vault.resetVault).not.toHaveBeenCalled();
    expect(input('vault-password').value).toBe('');
    button('vault-reset').click();
    expect(input('vault-reset-acknowledge').checked).toBe(false);
    expect(button('vault-reset-confirm').disabled).toBe(true);
  });

  it('returns to password creation after reset while keeping the app gated', async () => {
    const { ensureVaultUnlocked } = await loadUi();
    const unlocked = vi.fn();
    void ensureVaultUnlocked().then(unlocked);
    await flush();
    button('vault-reset').click();
    acknowledgeReset();
    button('vault-reset-confirm').click();
    expect(button('vault-reset-cancel').disabled).toBe(true);
    await flush();
    expect(vault.resetVault).toHaveBeenCalledOnce();
    expect(document.getElementById('vault-confirm-password')).not.toBeNull();
    expect(document.getElementById('private-app')).toBeNull();
    expect(unlocked).not.toHaveBeenCalled();
  });

  it('keeps reset available when vault metadata cannot be read', async () => {
    vault.getVaultStatus.mockRejectedValue(new Error('Damaged metadata'));
    const { ensureVaultUnlocked } = await loadUi();
    void ensureVaultUnlocked();
    await flush();
    expect(document.getElementById('vault-status')!.textContent).toContain(
      'could not be read',
    );
    button('vault-reset').click();
    acknowledgeReset();
    button('vault-reset-confirm').click();
    await flush();
    expect(vault.resetVault).toHaveBeenCalledOnce();
    expect(document.getElementById('vault-confirm-password')).not.toBeNull();
  });

  it('requires a fresh acknowledgment after an incomplete reset', async () => {
    vault.resetVault.mockRejectedValue(new Error('Private storage failure'));
    const { ensureVaultUnlocked } = await loadUi();
    void ensureVaultUnlocked();
    await flush();
    button('vault-reset').click();
    acknowledgeReset();
    button('vault-reset-confirm').click();
    await flush();
    expect(input('vault-reset-acknowledge').checked).toBe(false);
    expect(button('vault-reset-confirm').disabled).toBe(true);
    expect(document.getElementById('vault-status')!.textContent).toContain(
      'could not be completely reset',
    );
    expect(document.body.textContent).not.toContain('Private storage failure');
    expect(document.getElementById('private-app')).toBeNull();
  });

  it('uses the browser locale without reading protected language settings', async () => {
    chrome.i18n.getUILanguage = () => 'ru-RU';
    const { ensureVaultUnlocked } = await loadUi();
    void ensureVaultUnlocked();
    await flush();
    expect(document.getElementById('vault-title')!.textContent).toBe(
      'Разблокируйте Attention',
    );
    expect(document.getElementById('vault-gate')!.lang).toBe('ru');
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
  });

  it('provides distinct translated controls and deletion explanations in all nine languages', () => {
    const languages: UiLanguage[] = [
      'en',
      'ru',
      'de',
      'es',
      'fr',
      'it',
      'zh',
      'ar',
      'hi',
    ];
    for (const key of [
      'unlockTitle',
      'createTitle',
      'resetWarning',
      'resetAcknowledge',
      'unlockError',
      'lock',
    ] as const) {
      const translations = languages.map((language) =>
        vaultText(language, key),
      );
      expect(translations.every((text) => text.length > 0)).toBe(true);
      expect(new Set(translations).size).toBe(9);
    }
    expect(vaultLocale('zh-Hant')).toBe('zh');
    expect(vaultLocale('ar_EG')).toBe('ar');
    expect(vaultLocale('unsupported')).toBe('en');
  });

  it('sets the correct reading direction for Arabic', async () => {
    chrome.i18n.getUILanguage = () => 'ar';
    const { ensureVaultUnlocked } = await loadUi();
    void ensureVaultUnlocked();
    await flush();
    expect(document.getElementById('vault-gate')!.dir).toBe('rtl');
  });
});

describe('vault lock control', () => {
  it('clears drafts and removes private DOM synchronously, preserving privacy on lock failure', async () => {
    let rejectLock!: (reason: Error) => void;
    vault.lockVault.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectLock = reject;
      }),
    );
    const { createVaultLockButton } = await loadUi();
    const draft = input('private-draft');
    const lock = createVaultLockButton('en');
    document.body.append(lock);
    lock.click();
    expect(vault.lockVault).toHaveBeenCalledOnce();
    expect(draft.value).toBe('');
    expect(document.getElementById('private-app')).toBeNull();
    expect(document.body.textContent).not.toContain(
      'Private imported material',
    );
    rejectLock(new Error('Private locking error'));
    await flush();
    expect(document.body.textContent).toContain('could not finish locking');
    expect(document.body.textContent).not.toContain('Private locking error');
    expect(document.getElementById('private-app')).toBeNull();
    expect(button('vault-lock').disabled).toBe(false);
  });
});
