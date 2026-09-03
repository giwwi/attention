import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const popupHtml = readFileSync('public/popup.html', 'utf8');

function popupDocument(): Document {
  return new DOMParser().parseFromString(popupHtml, 'text/html');
}

describe('compact popup settings', () => {
  it('keeps the popup focused on persistent evaluation settings', () => {
    const document = popupDocument();
    const settings = document.querySelector('#settings-home');

    expect(settings).not.toBeNull();
    expect(settings?.querySelector('.settings-intro')).toBeNull();
    expect(settings?.querySelector('#scenario-select')).not.toBeNull();
    expect(settings?.querySelector('#intent')).not.toBeNull();
    expect(settings?.querySelector('#novel-passage-highlights')).not.toBeNull();
    expect(settings?.querySelectorAll('[data-time]')).toHaveLength(0);
    expect(settings?.querySelector('#settings-save-state')).toBeNull();
    expect(settings?.querySelector('#profile-bar')).not.toBeNull();
    expect(settings?.querySelector('#open-ai-settings')).not.toBeNull();
    expect(settings?.querySelector('#open-readwise-settings')).toBeNull();
    expect(settings?.querySelector('#open-obsidian-settings')).toBeNull();
    expect(document.querySelector('#readwise-token')).not.toBeNull();
    expect(settings?.querySelector('#open-history-settings')).toBeNull();
    expect(settings?.querySelector('#open-saved-materials')).not.toBeNull();
    expect(settings?.querySelector('[data-decision="save"]')).toBeNull();

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

  it('delivers value before asking for a deep personal profile', () => {
    const document = popupDocument();
    const firstValue = document.querySelector('#first-value-onboarding');
    const advancedProfile = document.querySelector('#profile-onboarding');

    expect(
      firstValue?.querySelectorAll('[data-first-value-scenario]'),
    ).toHaveLength(4);
    expect(firstValue?.querySelector('#first-value-interest')).not.toBeNull();
    expect(firstValue?.querySelector('[data-profile-source]')).toBeNull();
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
