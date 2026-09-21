import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OptionalAi } from '../src/onboarding/optional-ai';
import { OPTIONAL_AI_PENDING_KEY } from '../src/onboarding/optional-ai-state';
import {
  AI_ANALYZER_SETTINGS_KEY,
  AI_GATEWAY_DEFAULT_MODEL_ID,
} from '../src/analyzer/settings';
import { PRIVACY_SETTINGS_KEY } from '../src/privacy/settings';
import { DATA_GENERATION_KEY } from '../src/privacy/data-operations';
import { DataTestStorage, installDataLocks } from './helpers/data-locks';

const TEST_KEY = 'test-only-api-key-not-a-real-credential';
let storage: DataTestStorage;
let current = true;
const onComplete = vi.fn();
const fetchSpy = vi.fn();
function setup(): OptionalAi {
  return new OptionalAi({
    getLanguage: () => 'ru',
    isCurrent: () => current,
    onComplete,
  });
}
function keyInput(): HTMLInputElement {
  return document.querySelector('#optional-ai-key')!;
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
  storage.data[OPTIONAL_AI_PENDING_KEY] = true;
  vi.stubGlobal('chrome', { storage: { local: storage } });
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  current = false;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('optional AI onboarding', () => {
  it('skips without saving an entered key, opting into cloud AI or sending a request', async () => {
    const step = setup();
    await step.show();
    keyInput().value = TEST_KEY;
    expect(keyInput().type).toBe('password');
    const link = step.root.querySelector<HTMLAnchorElement>(
      '#optional-ai-create-key',
    )!;
    expect(link.href).toContain('vercel.com/d?');
    expect(link.target).toBe('_blank');
    click('optional-ai-skip');
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(storage.data[OPTIONAL_AI_PENDING_KEY]).toBeUndefined();
    expect(storage.data[AI_ANALYZER_SETTINGS_KEY]).toBeUndefined();
    expect(storage.data[PRIVACY_SETTINGS_KEY]).toBeUndefined();
    expect(keyInput().value).toBe('');
    expect(step.root.hidden).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('saves the key and explicit cloud opt-in through private settings without testing the key remotely', async () => {
    const step = setup();
    await step.show();
    keyInput().value = ` ${TEST_KEY} `;
    click('optional-ai-connect');
    click('optional-ai-connect');
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(storage.data[AI_ANALYZER_SETTINGS_KEY]).toMatchObject({
      provider: 'vercel-ai-gateway',
      model: AI_GATEWAY_DEFAULT_MODEL_ID,
      apiKey: TEST_KEY,
    });
    expect(storage.data[PRIVACY_SETTINGS_KEY]).toMatchObject({
      localOnly: false,
    });
    expect(storage.data[OPTIONAL_AI_PENDING_KEY]).toBeUndefined();
    expect(keyInput().value).toBe('');
    expect(document.body.textContent).not.toContain(TEST_KEY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an empty or incomplete key while leaving skip usable', async () => {
    const step = setup();
    await step.show();
    for (const key of ['', 'short']) {
      keyInput().value = key;
      click('optional-ai-connect');
      expect(keyInput().getAttribute('aria-invalid')).toBe('true');
      expect(onComplete).not.toHaveBeenCalled();
      expect(storage.data[AI_ANALYZER_SETTINGS_KEY]).toBeUndefined();
    }
    expect(
      document.getElementById('optional-ai-status')!.textContent,
    ).toContain('целиком');
    click('optional-ai-skip');
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  });

  it('preserves a previously saved model and privacy choice when continuing without changes', async () => {
    const existing = {
      provider: 'vercel-ai-gateway',
      model: 'test/custom-model',
      apiKey: TEST_KEY,
      updatedAt: '2026-09-21',
    };
    storage.data[AI_ANALYZER_SETTINGS_KEY] = existing;
    storage.data[PRIVACY_SETTINGS_KEY] = {
      localOnly: true,
      updatedAt: '2026-09-21',
    };
    const step = setup();
    await step.show();
    expect(keyInput().value).toBe('');
    expect(
      document.getElementById('optional-ai-status')!.textContent,
    ).toContain('уже сохранён');
    expect(document.getElementById('optional-ai-skip')!.textContent).toBe(
      'Продолжить с текущими настройками',
    );
    click('optional-ai-skip');
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(storage.data[AI_ANALYZER_SETTINGS_KEY]).toEqual(existing);
    expect(storage.data[PRIVACY_SETTINGS_KEY]).toMatchObject({
      localOnly: true,
    });
  });

  it('allows skipping after a settings read failure', async () => {
    vi.spyOn(storage, 'get').mockRejectedValueOnce(
      new Error('Storage unavailable'),
    );
    const step = setup();
    await step.show();
    expect(document.getElementById('optional-ai-status')!.hidden).toBe(false);
    click('optional-ai-skip');
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  });

  it('keeps the step pending after a save failure and never prints secret-bearing errors', async () => {
    const step = setup();
    await step.show();
    vi.spyOn(storage, 'set').mockRejectedValueOnce(
      new Error(`Could not save ${TEST_KEY}`),
    );
    keyInput().value = TEST_KEY;
    click('optional-ai-connect');
    await vi.waitFor(() =>
      expect(document.getElementById('optional-ai-status')!.hidden).toBe(false),
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(storage.data[OPTIONAL_AI_PENDING_KEY]).toBe(true);
    expect(storage.data[PRIVACY_SETTINGS_KEY]).toBeUndefined();
    expect(document.body.textContent).not.toContain(TEST_KEY);
    click('optional-ai-skip');
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  });

  it('does not restore a key if erasure invalidates the operation before commit', async () => {
    const step = setup();
    await step.show();
    const originalGet = storage.get.bind(storage);
    let generationReads = 0;
    vi.spyOn(storage, 'get').mockImplementation(async (keys) => {
      if (keys === DATA_GENERATION_KEY && ++generationReads === 2)
        storage.data = { [DATA_GENERATION_KEY]: 'erased' };
      return originalGet(keys);
    });
    keyInput().value = TEST_KEY;
    click('optional-ai-connect');
    await vi.waitFor(() => expect(keyInput().value).toBe(''));
    expect(storage.data[AI_ANALYZER_SETTINGS_KEY]).toBeUndefined();
    expect(storage.data[PRIVACY_SETTINGS_KEY]).toBeUndefined();
    expect(onComplete).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
