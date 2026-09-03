import { describe, expect, it, vi } from 'vitest';
import {
  buildPageCaptureSignature,
  PageCaptureCache,
} from '../src/content/page-capture-cache';

function page(content: string, language = 'en') {
  document.documentElement.lang = language;
  document.title = 'Article title';
  document.body.innerHTML = `<article><h1>Article title</h1><p>${content}</p></article>`;
  return {
    root: document.querySelector('article') as HTMLElement,
    title: document.querySelector('h1') as HTMLElement,
  };
}

describe('page capture cache', () => {
  it('reuses one expensive capture for an unchanged article', () => {
    const cache = new PageCaptureCache<object>();
    const factory = vi.fn(() => ({ id: 1 }));

    expect(cache.get('same', factory)).toEqual({ id: 1 });
    expect(cache.get('same', factory)).toEqual({ id: 1 });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('invalidates explicitly on route lifecycle changes', () => {
    const cache = new PageCaptureCache<number>();
    const factory = vi.fn(() => factory.mock.calls.length);
    cache.get('same', factory);
    cache.invalidate();
    cache.get('same', factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('changes the signature for route, translation and equal-length edits', () => {
    const initial = page('alpha beta gamma', 'en');
    const first = buildPageCaptureSignature(
      document,
      'https://example.com/a',
      initial.root,
      initial.title,
    );

    const translated = page('альфа бета гамма', 'ru');
    const second = buildPageCaptureSignature(
      document,
      'https://example.com/a',
      translated.root,
      translated.title,
    );
    expect(second).not.toBe(first);

    const edited = page('delta zeta omega', 'en');
    const third = buildPageCaptureSignature(
      document,
      'https://example.com/a',
      edited.root,
      edited.title,
    );
    expect(third).not.toBe(first);

    const newRoute = buildPageCaptureSignature(
      document,
      'https://example.com/b',
      edited.root,
      edited.title,
    );
    expect(newRoute).not.toBe(third);
  });
});
