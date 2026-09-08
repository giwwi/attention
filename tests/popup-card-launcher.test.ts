import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { openCardOnActiveTab } from '../src/popup/card-launcher';
import { ATTENTION_CARD_OPEN_TYPE } from '../src/shared/card-messages';
import { popupLauncherText } from '../src/i18n/popup-launcher';
import type { UiLanguage } from '../src/i18n/ui';

const query = vi.fn();
const sendMessage = vi.fn();
const executeScript = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue([{ id: 4, url: 'https://example.test/article' }]);
  executeScript.mockResolvedValue([]);
  vi.stubGlobal('chrome', {
    tabs: { query, sendMessage },
    scripting: { executeScript },
  });
});
describe('page card launcher', () => {
  it('keeps navigation unavailable until popup initialization chooses the initial view', () => {
    const popup = new DOMParser().parseFromString(
      readFileSync('public/popup.html', 'utf8'),
      'text/html',
    );
    expect(popup.querySelector<HTMLElement>('#launcher-home')!.hidden).toBe(
      true,
    );
    expect(
      popup.querySelector<HTMLElement>('#launcher-navigation')!.hidden,
    ).toBe(true);
    expect(
      popup.querySelector<HTMLButtonElement>('#open-page-card')!.disabled,
    ).toBe(true);
  });
  it('opens an existing card without injecting or requesting a second evaluation', async () => {
    sendMessage.mockResolvedValue({ ok: true });
    expect(await openCardOnActiveTab()).toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(4, {
      type: ATTENTION_CARD_OPEN_TYPE,
    });
    expect(executeScript).not.toHaveBeenCalled();
  });
  it('injects the content bundle and retries once when the listener is missing', async () => {
    sendMessage
      .mockRejectedValueOnce(new Error('No receiver'))
      .mockResolvedValueOnce({ ok: true });
    expect(await openCardOnActiveTab()).toEqual({ ok: true });
    expect(executeScript).toHaveBeenCalledExactlyOnceWith({
      target: { tabId: 4 },
      files: ['content.js'],
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
  it('does not treat an explicit non-article response as a missing runtime', async () => {
    sendMessage.mockResolvedValue({ ok: false, reason: 'not_article' });
    expect(await openCardOnActiveTab()).toEqual({
      ok: false,
      reason: 'not_article',
    });
    expect(executeScript).not.toHaveBeenCalled();
  });
  it('leaves protected pages untouched', async () => {
    query.mockResolvedValue([{ id: 4, url: 'chrome://extensions/' }]);
    expect(await openCardOnActiveTab()).toEqual({
      ok: false,
      reason: 'protected_page',
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });
  it('stops after one failed retry', async () => {
    sendMessage.mockRejectedValue(new Error('No receiver'));
    expect(await openCardOnActiveTab()).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(executeScript).toHaveBeenCalledTimes(1);
  });
  it('does not inject after the accepted data operation was cancelled', async () => {
    sendMessage.mockRejectedValue(new Error('No receiver'));
    const assertCurrent = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('cancelled'));
    await expect(openCardOnActiveTab(assertCurrent)).rejects.toThrow(
      'cancelled',
    );
    expect(executeScript).not.toHaveBeenCalled();
  });
  it('provides complete launcher and recovery labels in all nine languages', () => {
    const languages: UiLanguage[] = [
      'en',
      'ru',
      'de',
      'es',
      'fr',
      'it',
      'zh',
      'ar',
      'hi',
    ];
    for (const language of languages) {
      for (const key of [
        'open',
        'explanation',
        'protectedPage',
        'notArticle',
        'unavailable',
        'back',
        'settings',
        'saved',
      ] as const) {
        expect(popupLauncherText(language, key).length).toBeGreaterThan(0);
      }
    }
    expect(
      new Set(languages.map((language) => popupLauncherText(language, 'open')))
        .size,
    ).toBe(9);
  });
});
