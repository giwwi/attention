const EXCLUDED_ELEMENTS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

export function isElementVisible(
  element: Element,
  cache = new WeakMap<Element, boolean>(),
): boolean {
  const cached = cache.get(element);
  if (cached !== undefined) return cached;

  const view = element.ownerDocument.defaultView;
  if (!view) return true;
  const style = view.getComputedStyle(element);
  const isHidden =
    element.hasAttribute('hidden') ||
    element.getAttribute('aria-hidden') === 'true' ||
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0';
  const isVisible =
    !isHidden &&
    (!element.parentElement || isElementVisible(element.parentElement, cache));

  cache.set(element, isVisible);
  return isVisible;
}

export function extractVisibleText(root: HTMLElement = document.body): string {
  const visibilityCache = new WeakMap<Element, boolean>();
  const ownerDocument = root.ownerDocument;
  const nodeFilter = ownerDocument.defaultView?.NodeFilter ?? NodeFilter;
  const walker = ownerDocument.createTreeWalker(root, nodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (
        !parent ||
        EXCLUDED_ELEMENTS.has(parent.tagName) ||
        !isElementVisible(parent, visibilityCache) ||
        !normalizeWhitespace(node.textContent ?? '')
      ) {
        return nodeFilter.FILTER_REJECT;
      }
      return nodeFilter.FILTER_ACCEPT;
    },
  });

  const parts: string[] = [];
  let node = walker.nextNode();
  while (node) {
    parts.push(node.textContent ?? '');
    node = walker.nextNode();
  }
  return normalizeWhitespace(parts.join(' '));
}
