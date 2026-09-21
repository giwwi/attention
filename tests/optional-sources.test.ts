import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OptionalSources } from '../src/onboarding/optional-sources';
import { OPTIONAL_SOURCES_PENDING_KEY } from '../src/onboarding/optional-sources-state';
import { OPTIONAL_AI_PENDING_KEY } from '../src/onboarding/optional-ai-state';
import { DataTestStorage, installDataLocks } from './helpers/data-locks';
import { READWISE_SETTINGS_KEY } from '../src/readwise/evidence';

let storage: DataTestStorage;
const openReadwise = vi.fn<(onClose: () => void) => Promise<void>>();
const openHistory = vi.fn<(onClose: () => void) => void>();
const onComplete = vi.fn();
let current = true;
function setup(): OptionalSources {
  return new OptionalSources({
    getLanguage: () => 'ru',
    isCurrent: () => current,
    openReadwise,
    openHistory,
    onComplete,
  });
}
function click(id: string): void {
  document.getElementById(id)!.click();
}
beforeEach(() => {
  vi.resetAllMocks();
  current = true;
  document.documentElement.lang = 'ru';
  document.body.innerHTML = readFileSync('public/popup.html', 'utf8');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  installDataLocks();
  storage = new DataTestStorage();
  storage.data[OPTIONAL_SOURCES_PENDING_KEY] = true;
  vi.stubGlobal('chrome', {
    storage: { local: storage },
    runtime: {
      getURL: (file: string) => `chrome-extension://test/${file}`,
      sendMessage: vi.fn(),
    },
    tabs: { create: vi.fn().mockResolvedValue({ id: 2 }) },
    permissions: { request: vi.fn() },
  });
  openReadwise.mockResolvedValue(undefined);
});
afterEach(() => {
  current = false;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('optional sources after profile creation', () => {
  it('can be shown and skipped without requesting access, creating tabs or importing data', async () => {
    const step = setup();
    await step.show();
    expect(step.root.hidden).toBe(false);
    expect(step.root.textContent).toContain('Это необязательно.');
    expect(chrome.permissions.request).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    click('optional-sources-continue');
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(storage.data[OPTIONAL_SOURCES_PENDING_KEY]).toBeUndefined();
    expect(storage.data[OPTIONAL_AI_PENDING_KEY]).toBe(true);
    expect(step.root.hidden).toBe(true);
    expect(openReadwise).not.toHaveBeenCalled();
    expect(openHistory).not.toHaveBeenCalled();
  });

  it('returns from connection details, reflects a successful connection and keeps setup resumable', async () => {
    const step = setup();
    await step.show();
    click('optional-readwise');
    await vi.waitFor(() => expect(openReadwise).toHaveBeenCalledOnce());
    expect(step.root.hidden).toBe(true);
    storage.data[READWISE_SETTINGS_KEY] = {
      connected: true,
      lastSyncedAt: null,
      sourceCount: 2,
      highlightCount: 3,
      noteCount: 1,
      excludedSourceCount: 0,
    };
    openReadwise.mock.calls[0]![0]();
    await vi.waitFor(() =>
      expect(
        document.getElementById('optional-readwise-status')!.textContent,
      ).toBe('Добавлено'),
    );
    expect(
      document.getElementById('optional-sources-continue')!.textContent,
    ).toBe('Продолжить');
    expect(storage.data[OPTIONAL_SOURCES_PENDING_KEY]).toBe(true);
    click('optional-history');
    expect(openHistory).toHaveBeenCalledOnce();
    openHistory.mock.calls[0]![0]();
    await vi.waitFor(() => expect(step.root.hidden).toBe(false));
    expect(chrome.permissions.request).not.toHaveBeenCalled();
  });

  it('opens Obsidian separately and does not close setup', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    const step = setup();
    await step.show();
    click('optional-obsidian');
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/obsidian.html',
    });
    expect(step.root.hidden).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(storage.data[OPTIONAL_SOURCES_PENDING_KEY]).toBe(true);
  });

  it('allows skipping after a failed connection without claiming success', async () => {
    openReadwise.mockRejectedValue(new Error('Network unavailable'));
    const step = setup();
    await step.show();
    click('optional-readwise');
    await vi.waitFor(() =>
      expect(document.getElementById('optional-sources-error')!.hidden).toBe(
        false,
      ),
    );
    expect(step.root.hidden).toBe(false);
    expect(document.getElementById('optional-readwise-status')!.hidden).toBe(
      true,
    );
    click('optional-sources-continue');
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  });

  it('ignores a connection callback after setup has been invalidated', async () => {
    const step = setup();
    await step.show();
    click('optional-history');
    current = false;
    openHistory.mock.calls[0]![0]();
    await Promise.resolve();
    expect(step.root.hidden).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
