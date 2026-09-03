import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UI_LANGUAGE,
  SUPPORTED_UI_LANGUAGES,
  formatNovelItem,
  normalizeUiLanguage,
  uiText,
} from '../src/i18n/ui';

describe('interface localization', () => {
  it('supports the MVP language set and defaults the public build to English', () => {
    expect(SUPPORTED_UI_LANGUAGES).toEqual([
      'ru',
      'en',
      'de',
      'es',
      'fr',
      'it',
      'zh',
      'ar',
      'hi',
    ]);
    expect(DEFAULT_UI_LANGUAGE).toBe('en');
    expect(normalizeUiLanguage('unknown')).toBe('en');
  });

  it('translates decisions and interpolates values', () => {
    expect(uiText('en', 'verdictRead')).toBe('PROBABLY READ');
    expect(uiText('zh', 'usefulMinutes', { count: 7 })).toContain('7');
    expect(uiText('ar', 'outcomeYes')).toContain('استحقت');
    expect(uiText('hi', 'save')).toBe('सहेजें');
    expect(formatNovelItem('ru', 'fact', 5)).toBe('5 новых фактов');
  });

  it('localizes the value-first onboarding in every supported language', () => {
    for (const language of SUPPORTED_UI_LANGUAGES) {
      expect(uiText(language, 'quickStartScenarioTitle')).not.toBe('');
      expect(uiText(language, 'showFirstResult')).not.toBe('');
    }
    expect(uiText('en', 'quickStartEyebrow')).toBe('Quick start');
    expect(uiText('de', 'skip')).toBe('Überspringen');
    expect(uiText('zh', 'showFirstResult')).toContain('结果');
  });
});
