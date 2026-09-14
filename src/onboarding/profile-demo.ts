import type { UiLanguage } from '../i18n/ui';
import { profileText } from '../i18n/profile';

/** A labeled illustration, not a real analysis. No storage, network or personal data. */
export function createProfileDemo(language: UiLanguage): HTMLElement {
  const p = (text: string) => profileText(text, {}, language);
  const root = document.createElement('section');
  root.className = 'profile-example';
  root.dataset.profileDemo = 'true';
  const node = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text: string,
  ) => {
    const result = document.createElement(tag);
    result.textContent = p(text);
    return result;
  };
  const note = node('p', 'Учебный пример');
  note.className = 'profile-demo-note';
  const heading = node('h3', 'Одна статья. Разный смысл для вас.');
  const article = node('p', 'Как оценивать ответы AI: первые шаги');
  article.className = 'profile-demo-article';
  const switches = document.createElement('div');
  switches.className = 'profile-demo-switches';
  const result = document.createElement('div');
  result.className = 'profile-demo-result';
  result.setAttribute('role', 'status');
  result.setAttribute('aria-live', 'polite');
  const verdict = document.createElement('strong');
  const reason = document.createElement('p');
  result.append(verdict, reason);
  const buttons = ['Я изучаю эту тему', 'Я уже знаю основы'].map(
    (label, index) => {
      const button = node('button', label);
      button.type = 'button';
      button.addEventListener('click', () => select(index));
      switches.append(button);
      return button;
    },
  );
  function select(index: number): void {
    buttons.forEach((button, i) =>
      button.setAttribute('aria-pressed', String(i === index)),
    );
    result.dataset.verdict = index === 0 ? 'read' : 'maybe';
    verdict.textContent = p(
      index === 0 ? 'Стоит прочитать' : 'Основы можно пропустить',
    );
    reason.textContent = p(
      index === 0
        ? 'Критерии и примеры помогут начать оценивать ответы моделей.'
        : 'Начните с примера сложной ошибки — вводная часть вам уже знакома.',
    );
  }
  select(0);
  root.append(note, heading, article, switches, result);
  return root;
}
