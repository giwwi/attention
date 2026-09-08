import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const popupHtml = readFileSync('public/popup.html', 'utf8');

function popupDocument(): Document {
  return new DOMParser().parseFromString(popupHtml, 'text/html');
}

describe('compact popup settings', () => {
  it('uses the popup only to open the page card and navigate to saved items or settings', () => {
    const document = popupDocument();
    expect(
      document.querySelector('#launcher-home #open-page-card'),
    ).not.toBeNull();
    expect(document.querySelectorAll('#launcher-home button')).toHaveLength(1);
    expect(
      document.querySelector('#launcher-navigation #open-popup-settings'),
    ).not.toBeNull();
    expect(
      document.querySelector('#launcher-navigation #open-saved-materials'),
    ).not.toBeNull();
    for (const id of [
      'decision-context',
      'result',
      'evaluation-result',
      'scenario-select',
      'intent',
      'available-minutes',
      'runtime-version',
      'runtime-diagnostic',
    ]) {
      expect(document.getElementById(id)).toBeNull();
    }
    expect(document.querySelectorAll('[data-decision]')).toHaveLength(0);
    const settings = document.querySelector('#settings-home');
    for (const id of [
      'profile-bar',
      'open-ai-settings',
      'novel-passage-highlights',
      'interface-language',
      'open-privacy-settings',
    ]) {
      expect(settings?.querySelector(`#${id}`)).not.toBeNull();
    }
    expect(
      settings?.querySelector('details #open-voluntary-pilot'),
    ).not.toBeNull();
    expect(settings?.querySelector('#open-saved-materials')).toBeNull();
    const languages = Array.from(
      document.querySelectorAll<HTMLOptionElement>(
        '#interface-language option',
      ),
      (option) => option.value,
    );
    expect(languages).toEqual([
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
  });

  it('keeps every popup id unique after moving controls into settings', () => {
    const document = popupDocument();
    const ids = Array.from(document.querySelectorAll<HTMLElement>('[id]')).map(
      (element) => element.id,
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('starts with profile import and keeps short setup out of the cold path', () => {
    const document = popupDocument();
    const firstValue = document.querySelector('#first-value-onboarding');
    const advancedProfile = document.querySelector('#profile-onboarding');

    expect(firstValue).toBeNull();
    expect(
      advancedProfile?.querySelector('#skip-profile')?.hasAttribute('hidden'),
    ).toBe(true);
    expect(
      advancedProfile
        ?.querySelector('#profile-other-methods')
        ?.hasAttribute('open'),
    ).toBe(false);
    expect(
      advancedProfile
        ?.querySelector('#open-quick-profile')
        ?.closest('[hidden]'),
    ).not.toBeNull();
    expect(
      advancedProfile?.querySelector('#open-quick-profile'),
    ).not.toBeNull();
    expect(
      advancedProfile?.querySelector('[data-profile-source="chatgpt"]'),
    ).not.toBeNull();
    expect(
      advancedProfile?.querySelector('[data-profile-source="claude"]'),
    ).not.toBeNull();
    expect(
      advancedProfile?.querySelector('#open-browser-history'),
    ).not.toBeNull();
    expect(
      advancedProfile?.querySelector('#open-readwise-settings'),
    ).not.toBeNull();
    expect(
      advancedProfile?.querySelector('#open-obsidian-settings'),
    ).not.toBeNull();
    expect(
      advancedProfile?.querySelector('#open-browser-history')?.textContent,
    ).toContain('Настроить историю браузера');
    expect(
      document.querySelector('#import-browser-history')?.textContent,
    ).toContain('Разрешить и обработать');
  });
});
