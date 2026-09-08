import { createProfileDemo } from '../onboarding/profile-demo';
import { vaultLocale, vaultText } from '../i18n/vault';
import type { UiLanguage } from '../i18n/ui';
import {
  createVault,
  getVaultStatus,
  lockVault,
  resetVault,
  unlockVault,
} from './storage';

let activeGate: Promise<void> | undefined;

function installStyles(): void {
  if (document.getElementById('vault-ui-styles')) return;
  const style = document.createElement('link');
  style.id = 'vault-ui-styles';
  style.rel = 'stylesheet';
  style.href =
    typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL('vault.css')
      : 'vault.css';
  document.head.append(style);
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function gateShell(language: UiLanguage): HTMLElement {
  const gate = element('main');
  gate.id = 'vault-gate';
  gate.lang = language;
  gate.dir = language === 'ar' ? 'rtl' : 'ltr';
  gate.append(element('div', 'Attention', 'vault-brand'));
  return gate;
}

/** Call before initializing private views. Only the initial, static app DOM is retained. */
export function ensureVaultUnlocked(): Promise<void> {
  if (activeGate) return activeGate;
  installStyles();
  const language = vaultLocale();
  const t = (key: Parameters<typeof vaultText>[1]) => vaultText(language, key);
  const original = document.createDocumentFragment();
  while (document.body.firstChild) original.append(document.body.firstChild);
  const gate = gateShell(language);
  const heading = element('h1', t('checking'));
  heading.id = 'vault-title';
  gate.setAttribute('aria-labelledby', heading.id);
  const description = element('p');
  description.hidden = true;
  const sessionHint = element('p', t('sessionHint'), 'vault-hint');
  sessionHint.hidden = true;
  const content = element('div');
  const status = element('p');
  status.id = 'vault-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  gate.append(heading, description, sessionHint, content, status);
  document.body.append(gate);
  let state: 'unconfigured' | 'locked' = 'locked';
  let busy = false;
  let resolveGate: () => void;
  activeGate = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });
  const pending = activeGate;

  function clearPasswords(): void {
    gate
      .querySelectorAll<HTMLInputElement>('input[data-vault-password]')
      .forEach((input) => {
        input.value = '';
        input.type = 'password';
      });
    const show = gate.querySelector<HTMLInputElement>('#vault-show-password');
    if (show) show.checked = false;
  }

  function finish(): void {
    clearPasswords();
    gate.remove();
    document.body.append(original);
    activeGate = undefined;
    resolveGate();
  }

  function setBusy(value: boolean, message = ''): void {
    busy = value;
    gate.setAttribute('aria-busy', String(value));
    content
      .querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')
      .forEach((control) => {
        control.disabled = value;
      });
    const confirmReset = content.querySelector<HTMLButtonElement>(
      '#vault-reset-confirm',
    );
    const acknowledge = content.querySelector<HTMLInputElement>(
      '#vault-reset-acknowledge',
    );
    if (confirmReset) confirmReset.disabled = value || !acknowledge?.checked;
    status.textContent = message;
  }

  function renderForm(error = ''): void {
    content.replaceChildren();
    const creating = state === 'unconfigured';
    heading.textContent = t(creating ? 'createTitle' : 'unlockTitle');
    description.textContent = t(creating ? 'createDescription' : 'description');
    description.hidden = false;
    sessionHint.hidden = false;
    if (creating)
      content.append(
        createProfileDemo(language),
        element('p', t('createHint'), 'vault-hint'),
      );
    const form = element('form');
    form.noValidate = true;
    const passwordLabel = element('label', t('password'));
    passwordLabel.htmlFor = 'vault-password';
    const password = element('input');
    password.id = 'vault-password';
    password.name = 'vault-password';
    password.type = 'password';
    password.autocomplete = creating ? 'new-password' : 'current-password';
    password.required = true;
    password.spellcheck = false;
    password.dataset.vaultPassword = '';
    password.setAttribute('autocapitalize', 'off');
    password.setAttribute('aria-describedby', 'vault-status');
    form.append(passwordLabel, password);
    const confirm = element('input');
    if (creating) {
      password.minLength = 12;
      const hint = element('p', t('passwordHint'), 'vault-hint');
      hint.id = 'vault-password-hint';
      password.setAttribute('aria-describedby', `${hint.id} vault-status`);
      const confirmLabel = element('label', t('confirmPassword'));
      confirmLabel.htmlFor = 'vault-confirm-password';
      confirm.id = 'vault-confirm-password';
      confirm.name = 'vault-confirm-password';
      confirm.type = 'password';
      confirm.autocomplete = 'new-password';
      confirm.required = true;
      confirm.spellcheck = false;
      confirm.dataset.vaultPassword = '';
      confirm.setAttribute('aria-describedby', 'vault-status');
      form.append(hint, confirmLabel, confirm);
    }
    const showLabel = element('label', undefined, 'vault-checkbox');
    const show = element('input');
    show.type = 'checkbox';
    show.id = 'vault-show-password';
    show.addEventListener('change', () => {
      password.type = show.checked ? 'text' : 'password';
      confirm.type = show.checked ? 'text' : 'password';
    });
    showLabel.append(show, element('span', t('showPassword')));
    const submit = element(
      'button',
      t(creating ? 'createAction' : 'unlockAction'),
      'vault-primary',
    );
    submit.id = 'vault-submit';
    submit.type = 'submit';
    form.append(showLabel, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (busy) return;
      if (creating && password.value.length < 12) {
        clearPasswords();
        status.textContent = t('tooShort');
        password.setAttribute('aria-invalid', 'true');
        password.focus();
        return;
      }
      if (creating && password.value !== confirm.value) {
        clearPasswords();
        status.textContent = t('mismatch');
        confirm.setAttribute('aria-invalid', 'true');
        password.focus();
        return;
      }
      if (!password.value) {
        password.focus();
        return;
      }
      password.removeAttribute('aria-invalid');
      confirm.removeAttribute('aria-invalid');
      // Start the operation before clearing DOM fields; never persist the password in UI state.
      const action = creating
        ? createVault(password.value)
        : unlockVault(password.value);
      clearPasswords();
      setBusy(true, t('working'));
      void action
        .then(async () => {
          if ((await getVaultStatus()) !== 'unlocked')
            throw new Error('Vault is still locked');
          finish();
        })
        .catch(() => {
          setBusy(false, t(creating ? 'createError' : 'unlockError'));
          password.setAttribute('aria-invalid', 'true');
          password.focus();
        });
    });
    const reset = element('button', t('resetAction'), 'vault-link');
    reset.id = 'vault-reset';
    reset.type = 'button';
    reset.addEventListener('click', () => {
      if (!busy) renderReset();
    });
    content.append(form, reset);
    setBusy(false, error);
    password.focus();
  }

  function renderReset(): void {
    clearPasswords();
    content.replaceChildren();
    heading.textContent = t('resetTitle');
    description.hidden = true;
    sessionHint.hidden = true;
    const warning = element('p', t('resetWarning'));
    warning.id = 'vault-reset-warning';
    const label = element('label', undefined, 'vault-checkbox');
    const acknowledge = element('input');
    acknowledge.type = 'checkbox';
    acknowledge.id = 'vault-reset-acknowledge';
    acknowledge.setAttribute('aria-describedby', warning.id);
    label.append(acknowledge, element('span', t('resetAcknowledge')));
    const confirm = element('button', t('resetConfirm'), 'vault-danger');
    confirm.id = 'vault-reset-confirm';
    confirm.type = 'button';
    confirm.disabled = true;
    acknowledge.addEventListener('change', () => {
      confirm.disabled = busy || !acknowledge.checked;
    });
    confirm.addEventListener('click', () => {
      if (busy || !acknowledge.checked) return;
      setBusy(true, t('resetting'));
      void resetVault()
        .then(() => {
          state = 'unconfigured';
          renderForm();
        })
        .catch(() => {
          acknowledge.checked = false;
          setBusy(false, t('resetError'));
          acknowledge.focus();
        });
    });
    const cancel = element('button', t('cancel'));
    cancel.id = 'vault-reset-cancel';
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      if (!busy) renderForm();
    });
    content.append(warning, label, confirm, cancel);
    setBusy(false);
    cancel.focus();
  }

  void getVaultStatus()
    .then((current) => {
      if (current === 'unlocked') finish();
      else {
        state = current;
        renderForm();
      }
    })
    .catch(() => renderForm(t('storageError')));
  return pending;
}

/** Append after unlock. Other-window locks must also invalidate private views at the entrypoint. */
export function createVaultLockButton(
  preferredLocale?: string,
): HTMLButtonElement {
  installStyles();
  const language = vaultLocale(preferredLocale);
  const button = element('button', vaultText(language, 'lock'));
  button.type = 'button';
  button.id = 'vault-lock';
  button.addEventListener('click', () => {
    if (button.disabled) return;
    button.disabled = true;
    // Remove rendered data and unsaved input values before any asynchronous locking work.
    document
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input, textarea',
      )
      .forEach((input) => {
        input.value = '';
      });
    const gate = gateShell(language);
    const status = element('p', vaultText(language, 'locking'));
    status.setAttribute('role', 'status');
    gate.append(status);
    document.body.replaceChildren(gate);
    void lockVault()
      .then(() => {
        window.location.reload();
      })
      .catch(() => {
        status.textContent = vaultText(language, 'lockError');
        button.disabled = false;
        gate.append(button);
        button.focus();
      });
  });
  return button;
}
