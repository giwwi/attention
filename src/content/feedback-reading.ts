import { findReadingEndTarget, findReadingRoot } from './reading-progress';
import {
  findCurrentArticleRoot,
  findCurrentArticleTitleElement,
} from './article-root';

const FEEDBACK_UI_EXCLUSION_SELECTOR = [
  'nav',
  'aside',
  'footer',
  'form',
  '[role="navigation"]',
  '[role="complementary"]',
  '[aria-hidden="true"]',
  '[hidden]',
  '.subscription-widget',
  '.footnote',
  '.footnote-content',
  '#comments',
  '[id^="comments-" i]',
  '[id*="comments-section" i]',
  '[class*="comments-section" i]',
  '[class*="comment-section" i]',
  '[class*="commentssection" i]',
  '[data-testid*="comments" i]',
  '[role="region"][aria-label*="comment" i]',
  '[data-attention-preview="true"]',
  '[data-attention-outcome-prompt="true"]',
].join(', ');

const DEDICATED_ARTICLE_BODY_SELECTORS = [
  // LessWrong/ForumMagnum: comments are siblings below #postBody, while the
  // authored post itself is isolated in #postContent.
  '#postContent',
  '#postBody .instapaper_body',
  '[itemprop="articleBody"]',
  '[data-testid*="post-body" i]',
  '[data-testid*="article-body" i]',
  '.instapaper_body',
  '[class*="article-body" i]',
  '[class*="post-body" i]',
] as const;

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function substantialTextLength(element: Element): number {
  return normalizedText(element.textContent).length;
}

function findDedicatedArticleBody(document: Document): HTMLElement | null {
  for (const selector of DEDICATED_ARTICLE_BODY_SELECTORS) {
    const match = Array.from(
      document.querySelectorAll<HTMLElement>(selector),
    ).find(
      (element) =>
        !element.closest(FEEDBACK_UI_EXCLUSION_SELECTOR) &&
        substantialTextLength(element) >= 200,
    );
    if (match) return match;
  }
  return null;
}

/**
 * Finds the reading surface only for the feedback tracker. This is deliberately
 * separate from hover-title resolution so changes to reading completion cannot
 * alter the already stable preview-card behavior.
 */
export function findFeedbackReadingRoot(
  document: Document,
  extractedTitle = document.title,
): HTMLElement | null {
  const dedicatedBody = findDedicatedArticleBody(document);
  if (dedicatedBody) return dedicatedBody;

  const expectedTitle = normalizedText(extractedTitle).toLowerCase();
  const matchedTitle = findCurrentArticleTitleElement(document, extractedTitle);
  if (matchedTitle && !matchedTitle.closest(FEEDBACK_UI_EXCLUSION_SELECTOR)) {
    const currentArticle = findCurrentArticleRoot(document, extractedTitle);
    if (currentArticle && substantialTextLength(currentArticle) >= 200) {
      return currentArticle;
    }
  }

  // Authenticated reader shells can omit headings altogether while retaining
  // multiple role=article feed cards behind the open post. Prefer a semantic
  // article containing the extracted title, then the most substantial article.
  const articles = Array.from(
    document.querySelectorAll<HTMLElement>('article'),
  ).filter((article) => substantialTextLength(article) >= 200);
  const titleMatchedArticle = articles.find((article) =>
    expectedTitle
      ? normalizedText(article.textContent)
          .toLowerCase()
          .includes(expectedTitle)
      : false,
  );
  if (titleMatchedArticle) return titleMatchedArticle;
  const largestArticle = articles.sort(
    (left, right) => substantialTextLength(right) - substantialTextLength(left),
  )[0];
  if (largestArticle) return largestArticle;

  return findReadingRoot(document);
}

export function findFeedbackReadingEndTarget(
  root: HTMLElement | null,
): HTMLElement | null {
  if (!root) return null;
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      'p, li, blockquote, pre, figure, video, h2, h3',
    ),
  ).filter((element) => !element.closest(FEEDBACK_UI_EXCLUSION_SELECTOR));
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const element = candidates[index];
    if (
      element &&
      (element.matches('pre, figure, video') ||
        substantialTextLength(element) >= 40)
    ) {
      return element;
    }
  }
  return findReadingEndTarget(root);
}
