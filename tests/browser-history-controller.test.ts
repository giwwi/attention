import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserHistoryController } from '../src/popup/controllers/browser-history-controller';

function setupDom(): void {
  document.body.innerHTML = `
    <section id="browser-history-setup" hidden></section>
    <section id="profile-onboarding"></section>
    <section id="settings-home"></section>
    <button id="open-browser-history"></button>
    <button id="close-browser-history"></button>
    <button id="import-browser-history"></button>
    <button id="delete-browser-history"></button>
    <p id="browser-history-status"></p>
    <div id="browser-history-result" hidden></div>
    <p id="browser-history-summary"></p>
    <input type="radio" name="history-period" value="7" />
    <input type="radio" name="history-period" value="30" checked />
    <input type="radio" name="history-period" value="90" />
  `;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('browser history settings controller', () => {
  it('does not request the same Chrome permission again when it is already granted', async () => {
    setupDom();
    const contains = vi.fn().mockResolvedValue(true);
    const request = vi.fn().mockResolvedValue(true);
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      processedUrlCount: 2,
      totalVisitCount: 3,
      excludedUrlCount: 0,
      permissionRevoked: true,
    });
    vi.stubGlobal('chrome', {
      permissions: {
        contains,
        request,
        remove: vi.fn().mockResolvedValue(true),
      },
      runtime: { sendMessage },
      storage: {
        local: { get: vi.fn().mockResolvedValue({}), remove: vi.fn() },
      },
    });

    const controller = new BrowserHistoryController();
    controller.initialize();
    document
      .querySelector<HTMLButtonElement>('#import-browser-history')
      ?.click();

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    expect(contains).toHaveBeenCalledWith({ permissions: ['history'] });
    expect(request).not.toHaveBeenCalled();
  });
});
