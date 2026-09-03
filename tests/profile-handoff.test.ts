import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHATGPT_PROFILE_URL,
  CLAUDE_PROFILE_WEB_URL,
  buildClaudeProfileDeepLink,
  launchClaudeWebFallback,
  launchProfileHandoff,
  prepareChatGptProfileHandoff,
  type ProfileHandoffEnvironment,
} from '../src/onboarding/handoff/launchers';
import {
  PROFILE_IMPORT_HANDOFF_KEY,
  PROFILE_IMPORT_HANDOFF_MAX_AGE_MS,
  clearProfileHandoffState,
  createProfileHandoffState,
  loadProfileHandoffState,
  saveProfileHandoffState,
} from '../src/onboarding/handoff/state';
import { ProfileOnboarding } from '../src/onboarding/profile-onboarding';
import { PROFILE_PROVIDERS } from '../src/profile/providers';

class MemoryStorage {
  readonly values: Record<string, unknown> = {};

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    if (typeof keys === 'string') return { [keys]: this.values[keys] };
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map((key) => [key, this.values[key]]));
    }
    return { ...this.values };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      delete this.values[key];
    }
  }
}

function handoffEnvironment(options?: {
  copyFails?: boolean;
  failUrl?: string;
}): {
  environment: ProfileHandoffEnvironment;
  copied: string[];
  opened: string[];
} {
  const copied: string[] = [];
  const opened: string[] = [];
  return {
    copied,
    opened,
    environment: {
      async copyText(text) {
        if (options?.copyFails) throw new Error('clipboard unavailable');
        copied.push(text);
      },
      async openUrl(url) {
        opened.push(url);
        if (url === options?.failUrl) throw new Error('protocol unavailable');
      },
    },
  };
}

function onboardingFixture(): void {
  document.body.innerHTML = `
    <section id="profile-onboarding" hidden>
      <div id="profile-source-step"></div>
      <div id="profile-quick-step" hidden></div>
      <div id="profile-quick-review-step" hidden></div>
      <div id="profile-prompt-step" hidden></div>
      <div id="profile-review-step" hidden></div>
      <div id="profile-merge-step" hidden></div>
    </section>
    <h2 id="profile-provider-title"></h2>
    <p id="profile-handoff-status"></p>
    <ol id="profile-handoff-instructions"></ol>
    <button id="reopen-profile-provider"></button>
    <button id="open-claude-web-fallback"></button>
    <button id="show-profile-prompt"></button>
    <div id="profile-manual-prompt" hidden></div>
    <textarea id="profile-export-prompt"></textarea>
    <textarea id="profile-import-json"></textarea>
    <ul id="profile-validation-errors"></ul>
    <p id="profile-review-source"></p>
    <div id="profile-review-content"></div>
    <ul id="profile-review-errors"></ul>
    <div id="profile-conflicts"></div>
    <div id="profile-bar" hidden></div>
    <span id="profile-bar-text"></span>
    <button id="delete-profile"></button>
    <textarea id="quick-profile-internet"></textarea>
    <textarea id="quick-profile-knowledge"></textarea>
    <textarea id="quick-profile-leisure"></textarea>
    <p id="quick-profile-error" hidden></p>
    <div id="profile-quick-summary"></div>
    <button id="generate-quick-profile"></button>
    <button id="open-quick-profile"></button>
    <button id="profile-quick-back"></button>
    <button id="profile-quick-review-back"></button>
    <button id="cancel-quick-profile"></button>
    <button id="save-quick-profile"></button>
    <button id="skip-profile"></button>
    <button id="profile-prompt-back"></button>
    <button id="copy-profile-prompt"></button>
    <button id="validate-profile"></button>
    <button id="cancel-profile-review"></button>
    <button id="save-profile"></button>
    <button id="cancel-profile-merge"></button>
    <button id="confirm-profile-merge"></button>
    <button id="open-profile-import"></button>
    <button data-profile-source="chatgpt"></button>
  `;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('profile provider handoff', () => {
  it('can prepare the ChatGPT clipboard handoff before opening the site', async () => {
    const { environment, copied, opened } = handoffEnvironment();
    const prompt = PROFILE_PROVIDERS.chatgpt.prompt;

    await expect(
      prepareChatGptProfileHandoff(prompt, environment),
    ).resolves.toEqual({
      method: 'clipboard-and-web',
      promptCopied: true,
    });
    expect(copied).toEqual([prompt]);
    expect(opened).toEqual([]);
  });

  it('copies the existing ChatGPT prompt and opens ChatGPT', async () => {
    const { environment, copied, opened } = handoffEnvironment();
    const prompt = PROFILE_PROVIDERS.chatgpt.prompt;
    const prepared = vi.fn();

    const result = await launchProfileHandoff(
      'chatgpt',
      prompt,
      environment,
      prepared,
    );

    expect(copied).toEqual([prompt]);
    expect(opened).toEqual([CHATGPT_PROFILE_URL]);
    expect(result).toEqual({
      provider: 'chatgpt',
      method: 'clipboard-and-web',
      promptCopied: true,
      providerOpened: true,
    });
    expect(prepared).toHaveBeenCalledWith({
      method: 'clipboard-and-web',
      promptCopied: true,
    });
  });

  it('still opens ChatGPT when automatic clipboard writing fails', async () => {
    const { environment, opened } = handoffEnvironment({ copyFails: true });
    const result = await launchProfileHandoff(
      'chatgpt',
      PROFILE_PROVIDERS.chatgpt.prompt,
      environment,
    );

    expect(opened).toEqual([CHATGPT_PROFILE_URL]);
    expect(result.promptCopied).toBe(false);
    expect(result.providerOpened).toBe(true);
  });

  it('encodes the exact existing Claude prompt in the deep link', async () => {
    const { environment, copied, opened } = handoffEnvironment();
    const prompt = PROFILE_PROVIDERS.claude.prompt;
    const result = await launchProfileHandoff('claude', prompt, environment);

    expect(opened).toEqual([buildClaudeProfileDeepLink(prompt)]);
    expect(decodeURIComponent(opened[0]?.split('?q=')[1] ?? '')).toBe(prompt);
    expect(copied).toEqual([]);
    expect(result.method).toBe('deep-link');
  });

  it('falls back to copy plus Claude web when the deep link is rejected', async () => {
    const prompt = PROFILE_PROVIDERS.claude.prompt;
    const deepLink = buildClaudeProfileDeepLink(prompt);
    const { environment, copied, opened } = handoffEnvironment({
      failUrl: deepLink,
    });

    const result = await launchProfileHandoff('claude', prompt, environment);

    expect(opened).toEqual([deepLink, CLAUDE_PROFILE_WEB_URL]);
    expect(copied).toEqual([prompt]);
    expect(result).toMatchObject({
      method: 'clipboard-and-web',
      promptCopied: true,
      providerOpened: true,
    });
  });

  it('offers the same safe web fallback when protocol failure is not observable', async () => {
    const prompt = PROFILE_PROVIDERS.claude.prompt;
    const { environment, copied, opened } = handoffEnvironment();

    const result = await launchClaudeWebFallback(prompt, environment);

    expect(copied).toEqual([prompt]);
    expect(opened).toEqual([CLAUDE_PROFILE_WEB_URL]);
    expect(result).toMatchObject({
      provider: 'claude',
      method: 'clipboard-and-web',
      promptCopied: true,
    });
  });

  it('keeps the other-AI route completely manual', async () => {
    const { environment, copied, opened } = handoffEnvironment();
    const result = await launchProfileHandoff(
      'other',
      PROFILE_PROVIDERS.other.prompt,
      environment,
    );

    expect(copied).toEqual([]);
    expect(opened).toEqual([]);
    expect(result.method).toBe('manual');
  });
});

describe('profile handoff persistence', () => {
  it('shows the paste instruction before ChatGPT is opened', async () => {
    const storage = new MemoryStorage();
    const createTab = vi.fn().mockResolvedValue({ id: 42 });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('chrome', {
      storage: { local: storage },
      tabs: { create: createTab },
    });
    onboardingFixture();

    const onboarding = new ProfileOnboarding({ onComplete: vi.fn() });
    await onboarding.initialize(false);
    document
      .querySelector<HTMLButtonElement>('[data-profile-source="chatgpt"]')
      ?.click();

    await vi.waitFor(() => {
      expect(
        document.getElementById('profile-handoff-status')?.textContent,
      ).toContain('Запрос уже скопирован');
    });
    expect(writeText).toHaveBeenCalledWith(PROFILE_PROVIDERS.chatgpt.prompt);
    expect(createTab).not.toHaveBeenCalled();
    expect(
      document.getElementById('reopen-profile-provider')?.textContent,
    ).toBe('Открыть ChatGPT');

    document
      .querySelector<HTMLButtonElement>('#reopen-profile-provider')
      ?.click();
    await vi.waitFor(() => {
      expect(createTab).toHaveBeenCalledWith({
        url: CHATGPT_PROFILE_URL,
        active: true,
      });
    });
  });

  it('persists and clears the minimal waiting state', async () => {
    const storage = new MemoryStorage();
    const state = createProfileHandoffState(
      'chatgpt',
      new Date('2026-08-26T10:00:00Z'),
    );
    await saveProfileHandoffState(state, storage);

    await expect(
      loadProfileHandoffState(storage, new Date('2026-08-26T11:00:00Z')),
    ).resolves.toEqual(state);
    expect(storage.values[PROFILE_IMPORT_HANDOFF_KEY]).toEqual(state);

    await clearProfileHandoffState(storage);
    await expect(loadProfileHandoffState(storage)).resolves.toBeNull();
  });

  it('removes stale waiting state instead of restoring an old session', async () => {
    const storage = new MemoryStorage();
    const startedAt = new Date('2026-08-24T10:00:00Z');
    await saveProfileHandoffState(
      createProfileHandoffState('claude', startedAt),
      storage,
    );

    const now = new Date(
      startedAt.getTime() + PROFILE_IMPORT_HANDOFF_MAX_AGE_MS + 1,
    );
    await expect(loadProfileHandoffState(storage, now)).resolves.toBeNull();
    expect(storage.values[PROFILE_IMPORT_HANDOFF_KEY]).toBeUndefined();
  });

  it.each(['chatgpt', 'claude', 'other'] as const)(
    'restores the %s waiting screen when the popup is reopened',
    async (provider) => {
      const storage = new MemoryStorage();
      await saveProfileHandoffState(
        createProfileHandoffState(provider),
        storage,
      );
      vi.stubGlobal('chrome', { storage: { local: storage } });
      onboardingFixture();

      const onboarding = new ProfileOnboarding({ onComplete: vi.fn() });
      await expect(onboarding.initialize(false)).resolves.toBe(true);

      expect(document.getElementById('profile-onboarding')?.hidden).toBe(false);
      expect(document.getElementById('profile-prompt-step')?.hidden).toBe(
        false,
      );
      expect(
        (
          document.getElementById(
            'profile-export-prompt',
          ) as HTMLTextAreaElement
        ).value,
      ).toBe(PROFILE_PROVIDERS[provider].prompt);
      expect(document.getElementById('profile-import-json')).not.toBeNull();
      expect(document.getElementById('profile-manual-prompt')?.hidden).toBe(
        provider !== 'other',
      );
    },
  );
});
