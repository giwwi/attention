import { isElementVisible, normalizeWhitespace } from './extract';
import { findCurrentArticleRoot } from './article-root';
import { readingPlanText } from '../i18n/reading-plan';
import { DEFAULT_UI_LANGUAGE, type UiLanguage } from '../i18n/ui';

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
const HIGHLIGHT_ATTRIBUTE = 'data-attention-recommended-section';
const HIGHLIGHT_STYLE_ID = 'attention-recommended-section-style';
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

function headingLevel(element: HTMLElement): number {
  return Number(element.tagName.slice(1));
}

function ensureHighlightStyle(document: Document): void {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    [${HIGHLIGHT_ATTRIBUTE}="heading"] {
      position: relative !important;
      border-radius: 6px !important;
      outline: 3px solid rgba(22, 107, 79, 0.34) !important;
      outline-offset: 5px !important;
      background: rgba(224, 244, 234, 0.72) !important;
    }
    [${HIGHLIGHT_ATTRIBUTE}="heading"]::before {
      content: attr(data-attention-section-label) !important;
      display: block !important;
      width: max-content !important;
      margin: 0 0 7px !important;
      border-radius: 999px !important;
      padding: 4px 8px !important;
      color: #fff !important;
      background: #166b4f !important;
      font: 700 10px/1.2 ui-sans-serif, system-ui, sans-serif !important;
      letter-spacing: .04em !important;
      text-transform: uppercase !important;
    }
    [${HIGHLIGHT_ATTRIBUTE}="content"] {
      border-left: 3px solid rgba(22, 107, 79, 0.38) !important;
      padding-left: max(12px, 0.75em) !important;
      background: linear-gradient(90deg, rgba(224, 244, 234, 0.42), transparent 72%) !important;
    }
  `;
  (document.head ?? document.documentElement).append(style);
}

export function clearRecommendedSectionHighlights(document: Document): void {
  for (const element of document.querySelectorAll<HTMLElement>(
    `[${HIGHLIGHT_ATTRIBUTE}]`,
  )) {
    element.removeAttribute(HIGHLIGHT_ATTRIBUTE);
    element.removeAttribute('data-attention-section-label');
  }
}

export function highlightRecommendedSections(
  document: Document,
  headingTexts: string[],
  language: UiLanguage = DEFAULT_UI_LANGUAGE,
): number {
  clearRecommendedSectionHighlights(document);
  const uniqueHeadings = headingTexts.filter(
    (heading, index, values) => values.indexOf(heading) === index,
  );
  const matches = uniqueHeadings
    .map((heading) => findHeadingElement(document, heading))
    .filter((heading): heading is HTMLElement => heading !== null);
  if (matches.length === 0) return 0;

  ensureHighlightStyle(document);
  for (const heading of matches) {
    heading.setAttribute(HIGHLIGHT_ATTRIBUTE, 'heading');
    heading.setAttribute(
      'data-attention-section-label',
      readingPlanText(language, 'recommended'),
    );
    const level = headingLevel(heading);
    let sibling = heading.nextElementSibling;
    while (sibling) {
      if (
        sibling instanceof HTMLElement &&
        /^H[1-6]$/.test(sibling.tagName) &&
        headingLevel(sibling) <= level
      ) {
        break;
      }
      if (sibling instanceof HTMLElement) {
        sibling.setAttribute(HIGHLIGHT_ATTRIBUTE, 'content');
      }
      sibling = sibling.nextElementSibling;
    }
  }
  return matches.length;
}
