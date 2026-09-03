import { recordPerformanceMetric } from '../performance/metrics';

function normalized(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

function fingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function buildPageCaptureSignature(
  document: Document,
  pageUrl: string,
  articleRoot: HTMLElement | null,
  titleElement: HTMLElement | null,
): string {
  const articleText = normalized(articleRoot?.textContent);
  const edgeSample = `${articleText.slice(0, 240)}\n${articleText.slice(-240)}`;
  return [
    pageUrl,
    document.title,
    document.documentElement.lang,
    normalized(titleElement?.textContent),
    articleText.length,
    articleRoot?.querySelectorAll('p').length ?? 0,
    fingerprint(edgeSample),
  ].join('\n');
}

/** A one-entry cache for the expensive Readability capture. */
export class PageCaptureCache<T> {
  private entry: { signature: string; value: T } | null = null;

  get(signature: string, factory: () => T): T {
    if (this.entry?.signature === signature) {
      recordPerformanceMetric('cache.page-capture.hit', 0);
      return this.entry.value;
    }
    recordPerformanceMetric('cache.page-capture.miss', 0);
    const value = factory();
    this.entry = { signature, value };
    return value;
  }

  invalidate(): void {
    this.entry = null;
  }
}
