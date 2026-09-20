import { afterEach, describe, expect, it, vi } from 'vitest';
import { installProfileHandoffNotice } from '../src/content/profile-handoff-notice';
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
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'execCommand');
  document.body.replaceChildren();
  document
    .querySelectorAll('[data-attention-profile-handoff-notice="true"]')
    .forEach((element) => element.remove());
});

describe('ChatGPT profile handoff notice', () => {
  it('can copy from its own field when the page blocks the Clipboard API', async () => {
    const storage = new MemoryStorage();
    await saveProfileHandoffState(
      {
        ...createProfileHandoffState('chatgpt'),
        method: 'clipboard-and-web',
        promptCopied: true,
      },
      storage,
    );
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Permissions policy')),
      },
    });
    const execCopy = vi.fn((command: string) => {
      expect(command).toBe('copy');
      const host = document.querySelector(
        '[data-attention-profile-handoff-notice]',
      );
      expect(host?.shadowRoot?.querySelector('textarea')?.value).toBe(
        PROFILE_PROVIDERS.chatgpt.prompt,
      );
      return true;
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCopy,
    });
    const host = await installProfileHandoffNotice({
      currentUrl: 'https://chatgpt.com/',
      storage,
      language: 'en',
    });
    host!.shadowRoot!.querySelector<HTMLButtonElement>('.copy')!.click();
    await vi.waitFor(() =>
      expect(host?.shadowRoot?.textContent).toContain('Copied ✓'),
    );
    expect(execCopy).toHaveBeenCalledOnce();
    expect(host?.shadowRoot?.querySelector('textarea')).toBeNull();
  });
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

    const host = await installProfileHandoffNotice({
      currentUrl: 'https://chatgpt.com/',
      storage,
      platform: 'MacIntel',
      language: 'ru',
    });

    expect(host?.shadowRoot?.textContent).toContain(
      'Промпт Attention уже скопирован',
    );
    expect(host?.shadowRoot?.textContent).toContain('⌘V');
    expect(host?.shadowRoot?.textContent).toContain('скопируйте весь ответ');
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
    const host = await installProfileHandoffNotice({
      currentUrl: 'https://chatgpt.com/',
      storage,
      copyText,
      language: 'ru',
    });

    host?.shadowRoot?.querySelector<HTMLButtonElement>('.copy')?.click();
    await vi.waitFor(() => {
      expect(copyText).toHaveBeenCalledWith(PROFILE_PROVIDERS.chatgpt.prompt);
    });
    expect(host?.shadowRoot?.textContent).toContain('Скопировано ✓');
  });

  it('uses the setup language returned by the background, including before vault creation', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          state: {
            profileImportProvider: 'chatgpt',
            profileImportStage: 'waiting-for-response',
            method: 'clipboard-and-web',
            promptCopied: true,
            language: 'de',
          },
        }),
      },
    });
    const host = await installProfileHandoffNotice({
      currentUrl: 'https://chatgpt.com/',
      platform: 'Win32',
    });
    expect(host?.lang).toBe('de');
    expect(host?.shadowRoot?.textContent).toContain(
      'Dein Attention-Prompt ist kopiert',
    );
    expect(host?.shadowRoot?.textContent).toContain('Ctrl+V');
    expect(host?.shadowRoot?.textContent).toContain('die gesamte Antwort');
    vi.unstubAllGlobals();
  });

  it('does not claim clipboard success when copying failed, then recovers on retry', async () => {
    const storage = new MemoryStorage();
    await saveProfileHandoffState(
      {
        ...createProfileHandoffState('chatgpt'),
        method: 'clipboard-and-web',
        promptCopied: false,
      },
      storage,
    );
    const copyText = vi
      .fn()
      .mockRejectedValueOnce(new Error('Clipboard denied'))
      .mockResolvedValue(undefined);
    const host = await installProfileHandoffNotice({
      currentUrl: 'https://chatgpt.com/',
      storage,
      copyText,
      language: 'en',
    });
    const title = host!.shadowRoot!.querySelector('strong')!;
    const button = host!.shadowRoot!.querySelector<HTMLButtonElement>('.copy')!;
    expect(title.textContent).toBe('Copy the prompt');
    button.click();
    await vi.waitFor(() =>
      expect(host?.shadowRoot?.textContent).toContain('Could not copy.'),
    );
    expect(title.textContent).toBe('Copy the prompt');
    button.click();
    await vi.waitFor(() =>
      expect(title.textContent).toBe('Your Attention prompt is copied'),
    );
    expect(host?.shadowRoot?.textContent).toContain(
      'Paste it into the ChatGPT message box',
    );
  });

  it('does not appear outside an active ChatGPT import', async () => {
    const storage = new MemoryStorage();
    await saveProfileHandoffState(createProfileHandoffState('claude'), storage);

    await expect(
      installProfileHandoffNotice({
        currentUrl: 'https://chatgpt.com/',
        storage,
      }),
    ).resolves.toBeNull();
    await expect(
      installProfileHandoffNotice({
        currentUrl: 'https://example.com/',
        storage,
      }),
    ).resolves.toBeNull();
  });
});
