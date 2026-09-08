import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installHoverPreview,
  resolveProfileHoverTargetDetails,
} from '../src/content/hover-preview';
import { installProfilePrompt } from '../src/content/profile-prompt';
import { installCardHost } from '../src/content/card-view';
import { PROFILE_SETUP_OPEN_TYPE } from '../src/vault/messages';
import { captureDocument } from '../src/content/capture';

const interaction = vi.hoisted(() => ({ trusted: false }));
vi.mock('../src/content/user-interaction', () => ({
  isTrustedUserInteraction: () => interaction.trusted,
}));
vi.mock('../src/content/capture', async (original) => ({
  ...(await original<object>()),
  captureDocument: vi.fn(() => {
    throw new Error('No article extraction before profile');
  }),
}));
let dispose: (() => void) | undefined;
let abort: AbortController;
let send: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  interaction.trusted = false;
  abort = new AbortController();
  send = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } });
  vi.mocked(captureDocument).mockClear();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  abort.abort();
  document.body.replaceChildren();
  document.title = '';
  window.history.replaceState({}, '', '/');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('setup cards before a personal profile', () => {
  it.each([true, false])(
    'shows an actionable %s article-mode prompt with no capture or analysis',
    async (article) => {
      window.history.replaceState({}, '', article ? '/article/one' : '/feed');
      document.body.innerHTML = article
        ? '<article><h1>How to choose what is worth reading</h1><p>Private article body.</p></article>'
        : '<article><a href="https://example.com/?id=42"><h2>How to choose what is worth reading</h2></a></article>';
      const controller = installHoverPreview({
        profileRequired: true,
        getUiLanguage: () => 'ru',
      });
      dispose = controller.dispose;
      document
        .querySelector('h1,h2')!
        .dispatchEvent(new Event('pointerover', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(500);
      const host = document.querySelector<HTMLElement>(
        '[data-attention-preview]',
      )!;
      expect(host.style.display).toBe('block');
      expect(host.style.pointerEvents).toBe('auto');
      expect(host.dataset.attentionExpanded).toBe(String(article));
      expect(host.dataset.attentionProfileRequired).toBe('true');
      expect(host.dataset.attentionSource).toBeUndefined();
      expect(host.getAttribute('role')).toBe('dialog');
      if (article)
        expect(await controller.openCurrentArticle()).toEqual({ ok: true });
      document
        .querySelector('a')
        ?.addEventListener('click', (event) => event.preventDefault());
      interaction.trusted = true;
      document
        .querySelector('h1,h2')!
        .dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true }),
        );
      await vi.advanceTimersByTimeAsync(100);
      expect(captureDocument).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      dispose();
      expect(document.querySelector('[data-attention-preview]')).toBeNull();
      expect(document.querySelector('[data-attention-trigger]')).toBeNull();
    },
  );

  it('recognizes a linked Substack reader title without extracting the article or activating the subtitle', () => {
    window.history.replaceState({}, '', '/home/post/p-123');
    document.title = 'A rigorous guide to allocating attention';
    document.body.innerHTML =
      '<div class="post-title-block"><a href="https://publisher.example/p/attention">A rigorous guide to allocating attention</a><div>Here is the subtitle</div></div><div class="post-body"><p>Private article body.</p></div>';
    expect(
      resolveProfileHoverTargetDetails(document.querySelector('a')!)
        ?.currentPage,
    ).toBe(true);
    expect(
      resolveProfileHoverTargetDetails(
        document.querySelector('.post-title-block > div')!,
      ),
    ).toBeNull();
    expect(captureDocument).not.toHaveBeenCalled();
  });

  it('keeps an h1 linked feed item compact and does not treat the feed as an article', () => {
    document.body.innerHTML =
      '<article><h1><a href="https://example.com/?id=42">A rigorous guide to allocating attention</a></h1></article>';
    expect(
      resolveProfileHoverTargetDetails(document.querySelector('a')!)
        ?.currentPage,
    ).toBe(false);
    expect(captureDocument).not.toHaveBeenCalled();
  });

  it('does not mistake a comparison-table source for setup-worthy material', () => {
    document.body.innerHTML =
      '<article><table><tr><td>Feedly Market Intelligence</td><td>Team news service <a href="https://feedly.com">feedly.com</a></td></tr></table></article>';
    for (const target of document.querySelectorAll('a, td, tr'))
      expect(resolveProfileHoverTargetDetails(target)).toBeNull();
    expect(captureDocument).not.toHaveBeenCalled();
  });

  it('opens only the fixed setup route on a trusted gesture and allows retry after failure', async () => {
    const view = installCardHost();
    const prompt = installProfilePrompt(view, () => 'ru', abort.signal);
    prompt.render(true);
    expect(view.card.textContent).toContain('Можно добавить профиль из обоих.');
    expect(prompt.button.textContent).toBe('Создать мой профиль');
    prompt.button.click();
    expect(send).not.toHaveBeenCalled();
    interaction.trusted = true;
    send.mockResolvedValueOnce({ ok: false });
    prompt.button.click();
    prompt.button.click();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(view.card.textContent).toContain('Попробуйте ещё раз.');
    expect(prompt.button.disabled).toBe(false);
    prompt.button.click();
    await vi.advanceTimersByTimeAsync(1);
    expect(send.mock.calls).toEqual([
      [{ type: PROFILE_SETUP_OPEN_TYPE }],
      [{ type: PROFILE_SETUP_OPEN_TYPE }],
    ]);
  });
});
