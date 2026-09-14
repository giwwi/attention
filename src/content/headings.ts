import { isElementVisible, normalizeWhitespace } from './extract';
import { findCurrentArticleRoot } from './article-root';
import { READING_HIGHLIGHT_COLOR } from './reading-highlight';

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
const HIGHLIGHT_ATTRIBUTE = 'data-attention-recommended-section';
const HIGHLIGHT_STYLE_ID = 'attention-recommended-section-style';
const TARGET_ATTRIBUTE = 'data-attention-reading-target';
const targetTimers = new WeakMap<Document, ReturnType<typeof setTimeout>>();
const EXCLUDED_HEADING_REGIONS =
  'nav, aside, footer, [role="navigation"], [role="complementary"], [data-attention-preview], [data-attention-trigger]';

export function findHeadingElement(
  document: Document,
  headingText: string,
  root: ParentNode = findCurrentArticleRoot(document) ?? document,
): HTMLElement | null {
  const target = normalizeWhitespace(headingText);
  if (!target) return null;

  for (const heading of root.querySelectorAll<HTMLElement>(HEADING_SELECTOR)) {
    if (
      isElementVisible(heading) &&
      !heading.closest(EXCLUDED_HEADING_REGIONS) &&
      normalizeWhitespace(heading.textContent ?? '') === target
    ) {
      return heading;
    }
  }
  return null;
}

/** Navigate without leaving a second, persistent selection across the article. */
export function scrollToHeading(
  document: Document,
  headingText: string,
): boolean {
  const heading = findHeadingElement(document, headingText);
  if (!heading) return false;
  clearRecommendedSectionHighlights(document);
  const reducedMotion =
    document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')
      .matches === true;
  heading.scrollIntoView({
    behavior: reducedMotion ? 'instant' : 'smooth',
    block: 'start',
  });
  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `[${TARGET_ATTRIBUTE}] { background-color: ${READING_HIGHLIGHT_COLOR} !important; }`;
  (document.head ?? document.documentElement).append(style);
  heading.setAttribute(TARGET_ATTRIBUTE, 'true');
  targetTimers.set(
    document,
    setTimeout(() => clearRecommendedSectionHighlights(document), 2200),
  );
  return true;
}

/** Also clears the green section decorations left by previous versions. */
export function clearRecommendedSectionHighlights(document: Document): void {
  const timer = targetTimers.get(document);
  if (timer !== undefined) clearTimeout(timer);
  targetTimers.delete(document);
  document.getElementById(HIGHLIGHT_STYLE_ID)?.remove();
  for (const element of document.querySelectorAll<HTMLElement>(
    `[${HIGHLIGHT_ATTRIBUTE}], [${TARGET_ATTRIBUTE}], [data-attention-section-label]`,
  )) {
    element.removeAttribute(HIGHLIGHT_ATTRIBUTE);
    element.removeAttribute('data-attention-section-label');
    element.removeAttribute(TARGET_ATTRIBUTE);
  }
}

/** Compatibility entry point for the existing section-navigation message. */
export function highlightRecommendedSections(
  document: Document,
  headingTexts: string[],
): number {
  clearRecommendedSectionHighlights(document);
  const first = headingTexts.find((text) => findHeadingElement(document, text));
  return first && scrollToHeading(document, first) ? 1 : 0;
}
