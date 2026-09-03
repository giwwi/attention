import type { ScrollDepth } from '../shared/types';

const READING_ROOT_SELECTOR = [
  'main article',
  'main [role="article"]',
  'article',
  '[role="article"]',
  'main',
].join(', ');

export function findReadingRoot(document: Document): HTMLElement | null {
  const primaryHeadings = Array.from(
    document.querySelectorAll<HTMLElement>(
      'h1, [role="heading"][aria-level="1"], [itemprop="headline"]',
    ),
  );
  for (const heading of primaryHeadings) {
    const articleRoot = heading.closest<HTMLElement>(
      'article, [role="article"], [data-testid*="post-body" i], [data-testid="post"]',
    );
    if (
      articleRoot &&
      (articleRoot.matches('article, [role="article"]') ||
        Array.from(articleRoot.querySelectorAll('p')).some(
          (paragraph) => normalizedLength(paragraph.textContent) >= 80,
        ))
    ) {
      return articleRoot;
    }
  }
  for (const heading of primaryHeadings) {
    const main = heading.closest<HTMLElement>('main');
    if (main) return main;
  }
  const fallback = document.querySelector(READING_ROOT_SELECTOR);
  return fallback instanceof HTMLElement ? fallback : null;
}

export function findReadingEndTarget(
  root: HTMLElement | null,
): HTMLElement | null {
  if (!root) return null;
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      'p, li, blockquote, pre, figure, video, h2, h3',
    ),
  );
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const element = candidates[index];
    if (
      element &&
      (element.matches('pre, figure, video') ||
        normalizedLength(element.textContent) >= 40)
    ) {
      return element;
    }
  }
  return root;
}

function normalizedLength(value: string | null): number {
  return (value ?? '').replace(/\s+/g, ' ').trim().length;
}

export function readingProgressFromBounds(
  top: number,
  bottom: number,
  viewportHeight: number,
): number | null {
  const height = bottom - top;
  if (!Number.isFinite(height) || height <= 0 || viewportHeight <= 0) {
    return null;
  }
  const passed = Math.min(height, Math.max(0, viewportHeight - top));
  return Math.round((passed / height) * 100);
}

export function currentReadingProgress(
  root: HTMLElement | null,
): number | null {
  if (!root) return null;
  if (root.scrollHeight > root.clientHeight + 1 && root.clientHeight > 0) {
    return Math.round(
      Math.min(
        100,
        Math.max(
          0,
          ((root.scrollTop + root.clientHeight) / root.scrollHeight) * 100,
        ),
      ),
    );
  }
  const bounds = root.getBoundingClientRect();
  return readingProgressFromBounds(
    bounds.top,
    bounds.bottom,
    window.innerHeight,
  );
}

export function quantizeReadingProgress(progress: number): ScrollDepth {
  if (progress >= 95) return 100;
  if (progress >= 75) return 75;
  if (progress >= 50) return 50;
  if (progress >= 25) return 25;
  return 0;
}
