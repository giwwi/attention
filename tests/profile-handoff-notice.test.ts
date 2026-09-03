import { afterEach, describe, expect, it, vi } from 'vitest';
import { installChatGptProfileHandoffNotice } from '../src/content/profile-handoff-notice';
import {
  createProfileHandoffState,
  saveProfileHandoffState,
} from '../src/onboarding/handoff/state';
import { PROFILE_PROVIDERS } from '../src/profile/providers';

class MemoryStorage {
  readonly values: Record<string, unknown> = {};

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    if (typeof keys === 'string') return { [keys]: this.values[keys] };
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

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document
    .querySelectorAll('[data-attention-profile-handoff-notice="true"]')
    .forEach((element) => element.remove());
});

describe('ChatGPT profile handoff notice', () => {
  it('explains that the prompt is copied and disappears after paste', async () => {
    const storage = new MemoryStorage();
    await saveProfileHandoffState(
      {
        ...createProfileHandoffState('chatgpt'),
        method: 'clipboard-and-web',
        promptCopied: true,
        providerOpened: true,
      },
      storage,
    );

    const host = await installChatGptProfileHandoffNotice({
      currentUrl: 'https://chatgpt.com/',
      storage,
      platform: 'MacIntel',
    });

    expect(host?.shadowRoot?.textContent).toContain(
      'Промпт Attention уже скопирован',
    );
    expect(host?.shadowRoot?.textContent).toContain('⌘V');
    document.dispatchEvent(new Event('paste', { bubbles: true }));
    expect(host?.isConnected).toBe(false);
  });

  it('copies the same profile prompt again when requested', async () => {
    const storage = new MemoryStorage();
    await saveProfileHandoffState(
      {
        ...createProfileHandoffState('chatgpt'),
        method: 'clipboard-and-web',
        promptCopied: true,
      },
      storage,
    );
    const copyText = vi.fn().mockResolvedValue(undefined);
    const host = await installChatGptProfileHandoffNotice({
      currentUrl: 'https://chatgpt.com/',
      storage,
      copyText,
    });

    host?.shadowRoot?.querySelector<HTMLButtonElement>('.copy')?.click();
    await vi.waitFor(() => {
      expect(copyText).toHaveBeenCalledWith(PROFILE_PROVIDERS.chatgpt.prompt);
    });
    expect(host?.shadowRoot?.textContent).toContain('Скопировано ✓');
  });

  it('does not appear outside an active ChatGPT import', async () => {
    const storage = new MemoryStorage();
    await saveProfileHandoffState(createProfileHandoffState('claude'), storage);

    await expect(
      installChatGptProfileHandoffNotice({
        currentUrl: 'https://chatgpt.com/',
        storage,
      }),
    ).resolves.toBeNull();
    await expect(
      installChatGptProfileHandoffNotice({
        currentUrl: 'https://example.com/',
        storage,
      }),
    ).resolves.toBeNull();
  });
});
