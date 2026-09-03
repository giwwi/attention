export interface PageMessageSender {
  url?: string;
  frameId?: number;
  tab?: {
    id?: number;
    url?: string;
  };
}

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Validates page messages against the tab's current URL. `sender.url` belongs
 * to the document that created the content-script context and can remain on the
 * previous route after a History API navigation. `sender.tab.url` reflects the
 * URL currently shown in the tab, so it must be checked first for SPA pages.
 */
export function messageSenderMatchesPage(
  sender: PageMessageSender,
  expectedUrl: string,
): boolean {
  if (typeof sender.tab?.id !== 'number') return false;
  if (sender.frameId !== undefined && sender.frameId !== 0) return false;

  const expected = canonicalUrl(expectedUrl);
  if (!expected) return false;

  return [sender.tab.url, sender.url].some((candidate) => {
    if (!candidate) return false;
    return canonicalUrl(candidate) === expected;
  });
}
