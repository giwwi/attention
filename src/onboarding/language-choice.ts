import { type UiLanguage, SUPPORTED_UI_LANGUAGES, uiText } from '../i18n/ui';

export const PRIORITY_LANGUAGES = ['en', 'de', 'ru'] as const;
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
  root.setAttribute('role', 'group');
  const buttons = PRIORITY_LANGUAGES.map((language) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.lang = language;
    button.textContent = names[language];
    button.dataset.languageChoice = language;
    button.addEventListener('click', () => void onChange(language));
    root.append(button);
    return button;
  });
  const others = document.createElement('select');
  others.className = 'onboarding-other-languages';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '🌐';
  placeholder.disabled = true;
  others.append(placeholder);
  for (const language of SUPPORTED_UI_LANGUAGES) {
    if ((PRIORITY_LANGUAGES as readonly string[]).includes(language)) continue;
    const option = document.createElement('option');
    option.value = language;
    option.textContent = names[language];
    option.lang = language;
    others.append(option);
  }
  others.addEventListener(
    'change',
    () => void onChange(others.value as UiLanguage),
  );
  root.append(others);
  const update = (language: UiLanguage): void => {
    root.setAttribute('aria-label', uiText(language, 'language'));
    others.setAttribute('aria-label', uiText(language, 'language'));
    buttons.forEach((button, index) =>
      button.setAttribute(
        'aria-pressed',
        String(PRIORITY_LANGUAGES[index] === language),
      ),
    );
    others.value = (PRIORITY_LANGUAGES as readonly string[]).includes(language)
      ? ''
      : language;
  };
  update(initial);
  return { root, update };
}
