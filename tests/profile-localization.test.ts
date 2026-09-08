import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { captureProfileLabels, profileText } from '../src/i18n/profile';

const popup = readFileSync('public/popup.html', 'utf8');
const languages = ['en', 'de', 'es', 'fr', 'it', 'zh', 'ar', 'hi'] as const;
afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.lang = 'en';
});

describe('profile language switching', () => {
  it('covers every generated interface label used by profile onboarding', () => {
    const source = ts.createSourceFile(
      'profile-onboarding.ts',
      readFileSync('src/onboarding/profile-onboarding.ts', 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const labels = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === 'p'
      ) {
        const first = node.arguments[0];
        if (first && ts.isStringLiteral(first)) labels.add(first.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const label of labels) {
      expect(profileText(label, {}, 'en'), label).not.toMatch(/[а-яё]/iu);
    }
  });

  it.each(languages)(
    'translates the initial profile flow into %s and preserves entered data',
    (language) => {
      const parsed = new DOMParser().parseFromString(popup, 'text/html');
      const root = parsed.getElementById('profile-onboarding')!;
      document.body.append(root);
      const translate = captureProfileLabels(root);
      const input = root.querySelector<HTMLTextAreaElement>(
        '#quick-profile-internet',
      )!;
      input.value = 'Мои личные русские заметки';
      document.documentElement.lang = language;
      translate();
      expect(root.textContent).not.toMatch(/[а-яё]/iu);
      for (const field of root.querySelectorAll(
        '[aria-label], [placeholder]',
      )) {
        expect(field.getAttribute('aria-label') ?? '').not.toMatch(/[а-яё]/iu);
        expect(field.getAttribute('placeholder') ?? '').not.toMatch(/[а-яё]/iu);
      }
      expect(input.value).toBe('Мои личные русские заметки');
      document.documentElement.lang = 'ru';
      translate();
      expect(root.textContent).toContain('Сначала — ваш профиль');
      expect(input.value).toBe('Мои личные русские заметки');
    },
  );

  it.each(languages)(
    'translates optional browser history setup into %s',
    (language) => {
      const parsed = new DOMParser().parseFromString(popup, 'text/html');
      const root = parsed.getElementById('browser-history-setup')!;
      document.body.append(root);
      const translate = captureProfileLabels(root);
      document.documentElement.lang = language;
      translate();
      expect(root.textContent).not.toMatch(/[а-яё]/iu);
    },
  );

  it.each(languages)(
    'translates generated labels, status and placeholders into %s',
    (language) => {
      for (const source of [
        'Цель',
        'Предпочитаемая глубина',
        'Пусть ChatGPT представит меня',
        'Открыть ChatGPT',
        'Вставьте запрос в Claude и отправьте его.',
        'Профиль не сохранён: данные были удалены. Начните настройку заново.',
        'Личный контекст: {count} · хранится локально.',
      ]) {
        expect(profileText(source, { count: 3 }, language)).not.toMatch(
          /[а-яё]|\{\w+\}/iu,
        );
      }
    },
  );
});
