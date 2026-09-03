import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadwiseController } from '../src/popup/controllers/readwise-controller';

function setupDom(): void {
  document.body.innerHTML = `
    <section id="profile-onboarding"></section>
    <section id="saved-materials-view" hidden></section>
    <section id="ai-settings" hidden></section>
    <section id="privacy-settings" hidden></section>
    <section id="result" hidden></section>
    <button id="open-readwise-settings" aria-expanded="false"></button>
    <span id="readwise-home-status"></span>
    <section id="readwise-settings" hidden>
      <button id="close-readwise-settings"></button>
      <p id="readwise-eyebrow"></p>
      <h2 id="readwise-settings-title"></h2>
      <p id="readwise-intro"></p>
      <p id="readwise-settings-status"></p>
      <p id="readwise-summary"></p>
      <label><span id="readwise-token-label"></span><input id="readwise-token" /></label>
      <button id="connect-readwise"></button>
      <button id="sync-readwise"></button>
      <button id="disconnect-readwise"></button>
      <p id="readwise-privacy-note"></p>
      <span id="readwise-token-link"></span>
    </section>
    <p id="status"></p>
    <p id="readwise-navigation-description"></p>
  `;
  const panel = document.querySelector<HTMLElement>('#readwise-settings');
  if (panel) panel.scrollIntoView = vi.fn();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('Readwise settings controller', () => {
  it('opens from and returns to the personal profile settings', async () => {
    setupDom();
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          remove: vi.fn().mockResolvedValue(undefined),
        },
      },
      runtime: { sendMessage: vi.fn() },
    });

    const profileRoot = document.querySelector<HTMLElement>(
      '#profile-onboarding',
    )!;
    const panel = document.querySelector<HTMLElement>('#readwise-settings')!;
    new ReadwiseController({
      status: document.querySelector<HTMLParagraphElement>('#status')!,
      profileRoot,
      savedMaterialsView: document.querySelector<HTMLElement>(
        '#saved-materials-view',
      )!,
      aiSettingsPanel: document.querySelector<HTMLElement>('#ai-settings')!,
      privacySettingsPanel:
        document.querySelector<HTMLElement>('#privacy-settings')!,
      result: document.querySelector<HTMLElement>('#result')!,
      getLanguage: () => 'ru',
      onEvidenceChanged: vi.fn(),
    });

    document
      .querySelector<HTMLButtonElement>('#open-readwise-settings')
      ?.click();
    await vi.waitFor(() => expect(panel.hidden).toBe(false));
    expect(profileRoot.hidden).toBe(true);

    document
      .querySelector<HTMLButtonElement>('#close-readwise-settings')
      ?.click();
    expect(panel.hidden).toBe(true);
    expect(profileRoot.hidden).toBe(false);
  });
});
