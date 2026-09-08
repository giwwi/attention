import { isTrustedUserInteraction } from './user-interaction';
import type { MaterialOutcome } from '../shared/types';
import { DEFAULT_UI_LANGUAGE, uiText, type UiLanguage } from '../i18n/ui';
import { CONTENT_THEME_CSS } from './theme';

const SAVED_CONFIRMATION_MS = 450;

export interface OutcomePromptController {
  show(onOutcome: (outcome: MaterialOutcome) => Promise<boolean>): void;
  hide(): void;
  destroy(): void;
  setLanguage(language: UiLanguage): void;
}

interface OutcomePromptGlobal {
  __attentionOutcomePrompt?: OutcomePromptController;
}

export function installOutcomePrompt(
  shadowMode: ShadowRootMode = 'closed',
  initialLanguage: UiLanguage = DEFAULT_UI_LANGUAGE,
): OutcomePromptController {
  const promptGlobal = globalThis as typeof globalThis & OutcomePromptGlobal;
  if (
    promptGlobal.__attentionOutcomePrompt &&
    typeof promptGlobal.__attentionOutcomePrompt.setLanguage === 'function'
  ) {
    return promptGlobal.__attentionOutcomePrompt;
  }
  document
    .querySelectorAll<HTMLElement>('[data-attention-outcome-prompt="true"]')
    .forEach((element) => element.remove());
  const host = document.createElement('div');
  host.dataset.attentionOutcomePrompt = 'true';
  host.dataset.state = 'hidden';
  Object.assign(host.style, {
    all: 'initial',
    display: 'none',
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '2147483647',
  });
  const shadow = host.attachShadow({ mode: shadowMode });
  const style = document.createElement('style');
  style.textContent = `
    ${CONTENT_THEME_CSS}
    [hidden] { display: none !important; }
    .panel { box-sizing: border-box; width: min(360px, calc(100vw - 24px)); border: 1px solid var(--attention-border); border-radius: 14px; padding: 15px; color: var(--attention-fg); background: var(--attention-bg); box-shadow: 0 18px 48px var(--attention-shadow); font: 500 14px/1.35 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .top { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
    .question { margin: 0; font-size: 15px; font-weight: 750; }
    .close { width: 28px; height: 28px; margin: -6px -6px 0 0; border: 0; border-radius: 7px; color: var(--attention-muted); background: transparent; font: 600 19px/1 system-ui, sans-serif; cursor: pointer; }
    .close:hover, .close:focus-visible { color: var(--attention-fg); background: var(--attention-control-hover); }
    .options { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7px; margin-top: 13px; }
    .option { min-height: 38px; border: 1px solid var(--attention-border); border-radius: 9px; color: var(--attention-fg); background: var(--attention-control-bg); font: 700 13px/1 system-ui, sans-serif; cursor: pointer; }
    .option:hover, .option:focus-visible { border-color: var(--attention-border-hover); background: var(--attention-control-hover); }
    button:focus-visible { outline: 2px solid var(--attention-focus); outline-offset: 2px; }
    .option:disabled { cursor: default; opacity: .55; }
    .confirmation { margin: 0; color: var(--attention-accent); font-size: 14px; font-weight: 650; }
  `;
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.setAttribute('role', 'group');
  let language = initialLanguage;
  panel.setAttribute('aria-label', uiText(language, 'outcomeAria'));
  const top = document.createElement('div');
  top.className = 'top';
  const question = document.createElement('p');
  question.className = 'question';
  question.textContent = uiText(language, 'outcomeQuestion');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.setAttribute('aria-label', uiText(language, 'outcomeClose'));
  close.textContent = '×';
  top.append(question, close);
  const options = document.createElement('div');
  options.className = 'options';
  const confirmation = document.createElement('p');
  confirmation.className = 'confirmation';
  confirmation.hidden = true;
  confirmation.textContent = uiText(language, 'outcomeThanks');
  const choices: Array<[MaterialOutcome, 'outcomeYes' | 'outcomeNo']> = [
    ['yes', 'outcomeYes'],
    ['no', 'outcomeNo'],
  ];
  let submit: ((outcome: MaterialOutcome) => Promise<boolean>) | null = null;
  const buttons = choices.map(([outcome, labelKey]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.dataset.outcome = outcome;
    button.textContent = uiText(language, labelKey);
    button.addEventListener('click', async (event) => {
      if (!isTrustedUserInteraction(event) || !submit) return;
      for (const item of buttons) item.disabled = true;
      const saved = await submit(outcome).catch(() => false);
      if (!saved) {
        for (const item of buttons) item.disabled = false;
        question.textContent = uiText(language, 'outcomeError');
        return;
      }
      host.dataset.state = 'saved';
      host.dataset.outcome = outcome;
      panel.setAttribute('role', 'status');
      top.hidden = true;
      options.hidden = true;
      confirmation.hidden = false;
      window.setTimeout(() => {
        host.style.display = 'none';
        host.dataset.state = 'hidden';
      }, SAVED_CONFIRMATION_MS);
    });
    return button;
  });
  options.append(...buttons);
  panel.append(top, options, confirmation);
  shadow.append(style, panel);
  document.documentElement.append(host);

  close.addEventListener('click', (event) => {
    if (!isTrustedUserInteraction(event)) return;
    host.style.display = 'none';
    host.dataset.state = 'dismissed';
    submit = null;
  });

  const applyLanguage = (): void => {
    panel.dir = language === 'ar' ? 'rtl' : 'ltr';
    panel.setAttribute('aria-label', uiText(language, 'outcomeAria'));
    close.setAttribute('aria-label', uiText(language, 'outcomeClose'));
    confirmation.textContent = uiText(language, 'outcomeThanks');
    for (const [index, [, labelKey]] of choices.entries()) {
      const button = buttons[index];
      if (button) button.textContent = uiText(language, labelKey);
    }
    if (host.dataset.state !== 'saved') {
      question.textContent = uiText(language, 'outcomeQuestion');
    }
  };
  applyLanguage();

  const controller: OutcomePromptController = {
    show(onOutcome): void {
      submit = onOutcome;
      question.textContent = uiText(language, 'outcomeQuestion');
      for (const button of buttons) button.disabled = false;
      panel.setAttribute('role', 'group');
      top.hidden = false;
      options.hidden = false;
      confirmation.hidden = true;
      host.dataset.state = 'visible';
      delete host.dataset.outcome;
      host.style.display = 'block';
    },
    hide(): void {
      submit = null;
      host.dataset.state = 'hidden';
      host.style.display = 'none';
    },
    destroy(): void {
      submit = null;
      host.remove();
      if (promptGlobal.__attentionOutcomePrompt === controller)
        delete promptGlobal.__attentionOutcomePrompt;
    },
    setLanguage(nextLanguage): void {
      language = nextLanguage;
      applyLanguage();
    },
  };
  promptGlobal.__attentionOutcomePrompt = controller;
  return controller;
}
