import { isElementVisible, normalizeWhitespace } from './extract';

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';

export function findHeadingElement(
  document: Document,
  headingText: string,
): HTMLElement | null {
  const target = normalizeWhitespace(headingText);
  if (!target) return null;

  for (const heading of document.querySelectorAll<HTMLElement>(
    HEADING_SELECTOR,
  )) {
    if (
      isElementVisible(heading) &&
      normalizeWhitespace(heading.textContent ?? '') === target
    ) {
      return heading;
    }
  }
  return null;
}

export function scrollToHeading(
  document: Document,
  headingText: string,
): boolean {
  const heading = findHeadingElement(document, headingText);
  if (!heading) return false;

  heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
  heading.animate?.(
    [
      { backgroundColor: 'rgba(22, 107, 79, 0.18)' },
      { backgroundColor: 'transparent' },
    ],
    { duration: 1_400, easing: 'ease-out' },
  );
  return true;
}
