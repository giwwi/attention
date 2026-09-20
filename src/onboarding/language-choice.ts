import { type UiLanguage, SUPPORTED_UI_LANGUAGES, uiText } from '../i18n/ui';

const names: Record<UiLanguage, string> = {
  en: 'English',
  de: 'Deutsch',
  ru: 'Русский',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  zh: '中文',
  ar: 'العربية',
  hi: 'हिन्दी',
};

/** Native names remain readable before the visitor knows the current UI language. */
export function createLanguageChoice(
  initial: UiLanguage,
  onChange: (language: UiLanguage) => void | Promise<void>,
): { root: HTMLElement; update: (language: UiLanguage) => void } {
  const root = document.createElement('div');
  root.className = 'onboarding-language';
  const select = document.createElement('select');
  for (const language of SUPPORTED_UI_LANGUAGES) {
    const option = document.createElement('option');
    option.value = language;
    option.textContent = names[language];
    option.lang = language;
    select.append(option);
  }
  select.addEventListener(
    'change',
    () => void onChange(select.value as UiLanguage),
  );
  root.append(select);
  const update = (language: UiLanguage): void => {
    select.setAttribute('aria-label', uiText(language, 'language'));
    select.value = language;
  };
  update(initial);
  return { root, update };
}
