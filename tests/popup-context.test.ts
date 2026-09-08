import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsController } from '../src/popup/controllers/settings-controller';
import {
  normalizeUiLanguage,
  SUPPORTED_UI_LANGUAGES,
  uiText,
} from '../src/i18n/ui';
import { popupText } from '../src/i18n/popup';
import { createDefaultScenarioState } from '../src/scenario/scenario';
import { DataTestStorage, installDataLocks } from './helpers/data-locks';
import { DATA_GENERATION_KEY } from '../src/privacy/data-operations';

const html = readFileSync('tests/fixtures/popup-controller.html', 'utf8');
let storage: DataTestStorage;

beforeEach(() => {
  document.documentElement.innerHTML = new DOMParser().parseFromString(
    html,
    'text/html',
  ).documentElement.innerHTML;
  storage = new DataTestStorage();
  vi.stubGlobal('chrome', { storage: { local: storage.area } });
  installDataLocks();
});
afterEach(() => vi.unstubAllGlobals());

function controller(onContextChanged = vi.fn()) {
  return new SettingsController({
    status: document.querySelector<HTMLParagraphElement>('#status')!,
    onEvaluationInvalidated: vi.fn(),
    onContextChanged,
    onTranslated: vi.fn(),
    onLanguageChanged: vi.fn(),
  });
}

function change(id: string, value: string): void {
  const element = document.getElementById(id) as HTMLSelectElement;
  element.value = value;
  element.dispatchEvent(new Event('change'));
}

describe('popup context is persistent and refreshes the displayed evaluation', () => {
  it('restores a time budget and waits for persistence before requesting a new evaluation', async () => {
    storage.data = {
      attentionScenario: createDefaultScenarioState(),
      analysisContext: {
        scenario: 'work',
        intent: 'Check model routing',
        availableMinutes: 5,
      },
    };
    const refreshed: unknown[] = [];
    const settings = controller(
      vi.fn(() => {
        refreshed.push(structuredClone(storage.data.analysisContext));
      }),
    );
    await settings.initializeScenario();
    expect(settings.currentContext().availableMinutes).toBe(5);
    change('available-minutes', '30');
    await vi.waitFor(() => expect(refreshed).toHaveLength(1));
    expect(refreshed[0]).toMatchObject({
      availableMinutes: 30,
      intent: 'Check model routing',
    });
    change('scenario-select', 'learn');
    await vi.waitFor(() => expect(refreshed).toHaveLength(2));
    expect(refreshed[1]).toMatchObject({
      scenario: 'learn',
      availableMinutes: 30,
    });
  });

  it('persists the last edited intent and refreshes after the debounce', async () => {
    const onContextChanged = vi.fn();
    const settings = controller(onContextChanged);
    await settings.initializeScenario();
    const intent = document.querySelector<HTMLInputElement>('#intent')!;
    intent.value = 'First draft';
    intent.dispatchEvent(new Event('input'));
    intent.value = 'Specific current task';
    intent.dispatchEvent(new Event('input'));
    await vi.waitFor(() => expect(onContextChanged).toHaveBeenCalledOnce());
    expect(storage.data.analysisContext).toMatchObject({
      intent: 'Specific current task',
      availableMinutes: 15,
    });
  });

  it('does not restore context when data is erased during the intent debounce', async () => {
    const onContextChanged = vi.fn();
    const settings = controller(onContextChanged);
    await settings.initializeScenario();
    const intent = document.querySelector<HTMLInputElement>('#intent')!;
    intent.value = 'Pending private topic';
    intent.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await storage.clear();
    await storage.set({ [DATA_GENERATION_KEY]: 'erased' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(storage.data).toEqual({ [DATA_GENERATION_KEY]: 'erased' });
    expect(onContextChanged).not.toHaveBeenCalled();
  });

  it.each(SUPPORTED_UI_LANGUAGES)(
    'renders the first-value and decision labels in %s',
    async (language) => {
      storage.data.interfaceLanguage = language;
      const settings = controller();
      await settings.initializeLanguage();
      expect(document.documentElement.lang).toBe(language);
      expect(document.documentElement.dir).toBe(
        language === 'ar' ? 'rtl' : 'ltr',
      );
      expect(document.querySelector('#complete-first-value')?.textContent).toBe(
        uiText(language, 'showFirstResult'),
      );
      expect(
        document.querySelector('#available-minutes option[value="5"]')
          ?.textContent,
      ).toBe(uiText(language, 'minutesShort', { count: 5 }));
      expect(document.querySelector('#save-actual-utility')?.textContent).toBe(
        popupText(language, 'saveOutcome'),
      );
      expect(document.querySelector('#back-to-result')?.textContent).toBe(
        popupText(language, 'currentArticle'),
      );
      expect(document.querySelector('#decision-title')?.textContent).toBe(
        popupText(language, 'chooseDecision'),
      );
      expect(
        document.querySelector('[data-decision="save"] small')?.textContent,
      ).toBe(popupText(language, 'saveHint'));
      expect(
        document.querySelector('[data-popup-i18n="articleLanguage"]')
          ?.textContent,
      ).toBe(popupText(language, 'articleLanguage'));
      expect(normalizeUiLanguage(document.documentElement.lang)).toBe(language);
    },
  );
});
