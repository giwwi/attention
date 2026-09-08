import { passageText } from '../i18n/passages';
import { isTrustedUserInteraction } from './user-interaction';
import { installCardHost } from './card-view';
import { installProfilePrompt } from './profile-prompt';
import { profileCardText } from '../i18n/profile-card';
import { isInHoverRegion } from './hover-region';
import { CardContextControl } from './card-context';
import { cardText, type CardTextKey } from '../i18n/card';
import {
  ATTENTION_CONTEXT_UPDATE_TYPE,
  isAnalysisContextDto,
  type CardOpenResponse,
  type ContextResponse,
} from '../shared/card-messages';
import {
  HOVER_PREVIEW_EVENT_TYPE,
  HOVER_PREVIEW_REQUEST_TYPE,
  SAVE_MATERIAL_REQUEST_TYPE,
  type HoverPreview,
  type HoverPreviewEventMessage,
  type HoverPreviewResponse,
  type HoverPreviewVerdict,
  type MaterialDecision,
  type AnalysisContext,
  type PageCapture,
} from '../shared/types';
import { EXTENSION_RUNTIME_VERSION } from '../shared/version';
import {
  DEFAULT_UI_LANGUAGE,
  formatNovelItem,
  formatUiList,
  uiText,
  type UiLanguage,
} from '../i18n/ui';
import { readingPlanText } from '../i18n/reading-plan';
import { ATTENTION_INPUTS_INVALIDATED_TYPE } from '../background/input-invalidation';
import {
  findCurrentArticleRoot,
  findCurrentArticleTitleElement,
} from './article-root';
import { captureDocument, countWords, calculateReadingTime } from './capture';
import { HOVER_PREVIEW_CONFIG } from './config';
import {
  buildPageCaptureSignature,
  PageCaptureCache,
} from './page-capture-cache';
import { isArticlePagePath } from './page-kind';
import { installRouteWatcher } from './route-watcher';
import { subscribeToScroll } from './scroll-hub';
import {
  findNovelPassageMatches,
  NovelPassageController,
  potentialNewKeyClaims,
  type NovelPassageMatch,
} from './novel-passages';
import { highlightRecommendedSections, scrollToHeading } from './headings';

interface HoverPreviewGlobal {
  __attentionHoverPreviewInstalled?: boolean;
  __attentionHoverPreviewVersion?: string;
  __attentionHoverPreviewAbort?: AbortController;
}

const hoverGlobal = globalThis as typeof globalThis & HoverPreviewGlobal;
const HOVER_CONTRACT_VERSION = 'feed-compact-article-profile-prompt-v19';
const MATERIAL_TITLE_SELECTOR = [
  'h1',
  'h2',
  'h3',
  '[role="heading"]',
  '[itemprop="headline"]',
  '.article-title',
  '.post-title',
  '.entry-title',
  '[class*="article-title" i]',
  '[class*="post-title" i]',
  '[class*="entry-title" i]',
].join(', ');
const CURRENT_PAGE_TITLE_SELECTOR = [
  'h1',
  '[role="heading"][aria-level="1"]',
  '[itemprop="headline"]',
  '.article-title',
  '.post-title',
  '.entry-title',
  '[class*="article-title" i]',
  '[class*="post-title" i]',
  '[class*="entry-title" i]',
].join(', ');
function verdictLabel(
  language: UiLanguage,
  verdict: HoverPreviewVerdict,
): string {
  const keys = {
    read: 'verdictRead',
    maybe: 'verdictMaybe',
    skip: 'verdictSkip',
  } as const;
  return uiText(language, keys[verdict]);
}

const extractedPageCache = new PageCaptureCache<PageCapture | null>();

export function previewVerdict(preview: HoverPreview): HoverPreviewVerdict {
  if (preview.recommendedAction === 'open') return 'read';
  if (preview.recommendedAction === 'skip') return 'skip';
  return 'maybe';
}

export function fullCardDecision(preview: HoverPreview): MaterialDecision {
  if (preview.recommendedAction === 'open') return 'read';
  if (preview.recommendedAction === 'maybe') return 'skim';
  return preview.recommendedAction;
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export interface HoverTargetDetails {
  element: HTMLElement;
  positionElement: HTMLElement;
  url: string;
  title: string;
  snippet: string;
  currentPage: boolean;
}

interface HoverPoint {
  x: number;
  y: number;
}

const NON_CONTENT_APPLICATION_PATH =
  /^\/(?:earnings|billing|settings?|accounts?|dashboard|payments?|wallet|profile|contracts?|referrals?|notifications?|analytics|reports?|login|sign-?in|sign-?up|admin)(?:\/|$)/iu;

function isNonContentApplicationPath(pathname: string): boolean {
  let path = pathname.toLocaleLowerCase();
  try {
    path = decodeURIComponent(path).toLocaleLowerCase();
  } catch {
    /* Literal malformed path. */
  }
  return NON_CONTENT_APPLICATION_PATH.test(path);
}

function suppressApplicationUiPreview(targetUrl: string): boolean {
  // Account pages contain linked headings and promotional cards too. Their
  // destination may be an unrecognized route or another origin, so suppress
  // automatic previews based on the current page before checking the link.
  if (isNonContentApplicationPath(window.location.pathname)) return true;
  let target: URL;
  try {
    target = new URL(targetUrl, window.location.href);
  } catch {
    return true;
  }
  return (
    target.origin === window.location.origin &&
    isNonContentApplicationPath(target.pathname)
  );
}

function canonicalPageUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}

function isCurrentDocumentUrl(value: string): boolean {
  const aliases = [
    window.location.href,
    document.querySelector<HTMLLinkElement>('link[rel~="canonical"][href]')
      ?.href,
    document.querySelector<HTMLMetaElement>('meta[property="og:url"][content]')
      ?.content,
  ].filter((candidate): candidate is string => Boolean(candidate));
  const canonicalValue = canonicalPageUrl(value);
  return aliases.some(
    (candidate) => canonicalPageUrl(candidate) === canonicalValue,
  );
}

function materialScope(element: Element): HTMLElement | null {
  return (
    element.closest<HTMLElement>('article, [role="article"]') ??
    element.closest<HTMLElement>('main') ??
    element.closest<HTMLElement>('[data-testid*="post" i]')
  );
}

function fallbackMaterialScope(document: Document): HTMLElement | null {
  if (isArticlePagePath(window.location.pathname)) {
    const currentArticle = findCurrentArticleRoot(document);
    if (currentArticle) return currentArticle;
  }
  return document.querySelector<HTMLElement>(
    'main article, main [role="article"], article, [role="article"], main',
  );
}

function documentTitleAliases(titleOnly = false): string[] {
  const extractedTitle = titleOnly ? '' : extractedCurrentPageTitle();
  return Array.from(
    new Set(
      [
        document.title,
        document.querySelector<HTMLMetaElement>('meta[property="og:title"]')
          ?.content,
        document.querySelector<HTMLMetaElement>('meta[name="twitter:title"]')
          ?.content,
        extractedTitle,
      ]
        .map((value) => normalizedText(value).toLowerCase())
        .filter(Boolean),
    ),
  );
}

function extractedCurrentPageTitle(): string {
  return currentPageCapture()?.title ?? '';
}

/** URL hints help during hydration; semantic articles also work with ordinary slugs. */
function isCurrentArticleDocument(): boolean {
  if (isNonContentApplicationPath(window.location.pathname)) return false;
  if (isArticlePagePath(window.location.pathname)) return true;
  const root = findCurrentArticleRoot(document);
  const title =
    findCurrentArticleTitleElement(document) ?? root?.querySelector('h1');
  return Boolean(
    root &&
    title &&
    !title.closest('nav, aside, footer') &&
    root.querySelectorAll('article, [role="article"]').length <= 1 &&
    Array.from(root.querySelectorAll('p')).reduce(
      (length, paragraph) =>
        length + normalizedText(paragraph.textContent).length,
      0,
    ) >= 600,
  );
}

function currentPageCapture(): PageCapture | null {
  if (!isCurrentArticleDocument()) return null;
  const matchedTitle = findCurrentArticleTitleElement(document);
  const articleRoot =
    document.querySelector<HTMLElement>(
      '#postContent, [itemprop="articleBody"], .instapaper_body',
    ) ?? findCurrentArticleRoot(document);
  // Substack changes routes before the article body has finished rendering.
  // Include the evolving article size so an early skeleton capture cannot
  // stay cached. Do not use the whole document: on LessWrong the discussion
  // can be much larger than the post and continues hydrating independently.
  const signature = buildPageCaptureSignature(
    document,
    window.location.href,
    articleRoot,
    matchedTitle,
  );
  return extractedPageCache.get(signature, () => {
    try {
      return captureDocument(document, window.location.href);
    } catch {
      return null;
    }
  });
}

function documentTitleMatchScore(
  element: HTMLElement,
  titleOnly = false,
): number {
  const candidate = normalizedComparableTitle(element);
  if (!candidate) return 0;
  return documentTitleAliases(titleOnly).reduce((best, title) => {
    if (title === candidate) return Math.max(best, 1_000);
    if (
      title.startsWith(`${candidate} |`) ||
      title.startsWith(`${candidate} -`) ||
      title.startsWith(`${candidate} ·`)
    ) {
      return Math.max(best, 900);
    }
    if (
      candidate.length >= 20 &&
      (title.startsWith(candidate) || candidate.startsWith(title))
    ) {
      return Math.max(best, 700);
    }
    return best;
  }, 0);
}

function primaryMaterialHeading(scope: HTMLElement | null): HTMLElement | null {
  const metadataMatch = Array.from(
    document.querySelectorAll<HTMLElement>(CURRENT_PAGE_TITLE_SELECTOR),
  )
    .map((heading) => ({
      heading,
      score: documentTitleMatchScore(heading),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.heading;
  if (metadataMatch) return metadataMatch;
  const headings = Array.from(
    scope?.querySelectorAll<HTMLElement>(CURRENT_PAGE_TITLE_SELECTOR) ?? [],
  );
  const firstParagraph = scope?.querySelector('p') ?? null;
  return (
    headings.find(
      (heading) => !firstParagraph || appearsBeforeArticleBody(heading, scope),
    ) ?? null
  );
}

function isCurrentPageTitleHeading(
  heading: HTMLElement | null,
  primaryHeading: HTMLElement | null,
  scope: HTMLElement | null,
  currentRoute: boolean,
  currentDocumentAnchor: boolean,
): heading is HTMLElement {
  if (!heading || isExcludedUiRegion(heading)) {
    return false;
  }
  if (!currentRoute && !currentDocumentAnchor) {
    return Boolean(
      heading === primaryHeading &&
      !heading.closest('a[href]') &&
      heading.closest('article, main') &&
      !findCardLink(heading),
    );
  }
  if (documentTitleMatchScore(heading) > 0 || heading === primaryHeading) {
    return true;
  }

  // Authenticated reader shells (notably substack.com/home/post/...) can omit
  // article metadata and render the title outside the article body. In that
  // layout the title is still the level-one heading before the first article
  // paragraph. A later h1 is a section heading and must not become a preview.
  const readingScope = fallbackMaterialScope(document) ?? scope;
  return (
    heading.matches(CURRENT_PAGE_TITLE_SELECTOR) &&
    appearsBeforeArticleBody(heading, readingScope)
  );
}

function headingAtPoint(point: HoverPoint | undefined): HTMLElement | null {
  if (!point) return null;
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(MATERIAL_TITLE_SELECTOR),
  ).filter((heading) => {
    const bounds = heading.getBoundingClientRect();
    return (
      bounds.width > 0 &&
      bounds.height > 0 &&
      point.x >= bounds.left &&
      point.x <= bounds.right &&
      point.y >= bounds.top &&
      point.y <= bounds.bottom
    );
  });
  return (
    candidates.sort((left, right) => {
      const leftBounds = left.getBoundingClientRect();
      const rightBounds = right.getBoundingClientRect();
      return (
        leftBounds.width * leftBounds.height -
        rightBounds.width * rightBounds.height
      );
    })[0] ?? null
  );
}

function articleTitleCandidateScore(
  heading: HTMLElement,
  expectedTitle: string,
): number {
  const candidate = normalizedComparableTitle(heading);
  if (!candidate) return Number.NEGATIVE_INFINITY;
  let score = 0;
  if (candidate === expectedTitle) score += 10_000;
  else if (
    expectedTitle.length >= 20 &&
    (candidate.startsWith(expectedTitle) || expectedTitle.startsWith(candidate))
  ) {
    score += 2_000;
  } else {
    return Number.NEGATIVE_INFINITY;
  }
  if (heading.matches('h1, [role="heading"][aria-level="1"]')) score += 400;
  if (heading.closest('article, [role="article"], main')) score += 250;
  if (!heading.closest('nav, aside, footer, [role="navigation"]')) score += 150;
  const bounds = heading.getBoundingClientRect();
  if (bounds.width > 0 && bounds.height > 0) {
    score += Math.min(100, Math.round(bounds.height));
  }
  return score;
}

/**
 * Finds the page title from the already extracted article instead of trying to
 * infer it from the event target. Reader shells such as Substack often place a
 * transparent link or the subtitle above the real h1 in the pointer hit-test.
 */
function currentArticleTitleElement(capture: PageCapture): HTMLElement | null {
  const sharedTitle = findCurrentArticleTitleElement(document, capture.title);
  if (sharedTitle) return sharedTitle;
  const expectedTitle = normalizedText(capture.title).toLowerCase();
  if (!expectedTitle) return null;
  // Score semantic headings and exact title links together. A wrapper class
  // such as `post-title-block` often contains both the title and subtitle; if
  // semantic candidates are returned first, that wrapper wins by a prefix
  // match and makes its subtitle behave like the title. An exact link label is
  // more precise, while a real exact h1 still wins through its semantic bonus.
  const preciseTitle = [
    ...document.querySelectorAll<HTMLElement>(CURRENT_PAGE_TITLE_SELECTOR),
    ...document.querySelectorAll<HTMLAnchorElement>('a[href]'),
  ]
    .map((element) => ({
      element,
      score: articleTitleCandidateScore(element, expectedTitle),
    }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score)[0]?.element;
  if (preciseTitle) return preciseTitle;

  const readingScope = fallbackMaterialScope(document);
  const firstParagraph = readingScope?.querySelector('p') ?? null;
  return (
    Array.from(
      document.querySelectorAll<HTMLElement>(CURRENT_PAGE_TITLE_SELECTOR),
    ).find(
      (heading) =>
        !isExcludedUiRegion(heading) &&
        (!firstParagraph ||
          Boolean(
            heading.compareDocumentPosition(firstParagraph) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          )),
    ) ?? null
  );
}

function exactDocumentTitleElement(): HTMLElement | null {
  const sharedTitle = findCurrentArticleTitleElement(document);
  if (sharedTitle) return sharedTitle;
  const expectedTitle = normalizedText(document.title).toLowerCase();
  if (!expectedTitle) return null;
  return (
    [
      ...document.querySelectorAll<HTMLElement>(CURRENT_PAGE_TITLE_SELECTOR),
      ...document.querySelectorAll<HTMLAnchorElement>('a[href]'),
    ].find(
      (element) =>
        !isExcludedUiRegion(element) &&
        normalizedComparableTitle(element) === expectedTitle,
    ) ?? null
  );
}

function firstArticleParagraph(
  title: HTMLElement,
): HTMLParagraphElement | null {
  const titleBounds = title.getBoundingClientRect();
  const readingRoot =
    title.closest<HTMLElement>('article, [role="article"]') ??
    findCurrentArticleRoot(document);
  const paragraphs = Array.from(
    readingRoot?.querySelectorAll<HTMLParagraphElement>('p') ?? [],
  ).filter((paragraph) => normalizedText(paragraph.textContent).length >= 40);
  const visibleParagraph = paragraphs
    .map((paragraph) => ({
      paragraph,
      bounds: paragraph.getBoundingClientRect(),
    }))
    .filter(
      ({ bounds }) =>
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.top >= titleBounds.bottom - 2,
    )
    .sort((left, right) => left.bounds.top - right.bounds.top)[0]?.paragraph;
  if (visibleParagraph) return visibleParagraph;
  return (
    paragraphs.find((paragraph) => isBeforeElement(title, paragraph)) ?? null
  );
}

function pointIsInsideArticleLead(
  point: HoverPoint | undefined,
  title: HTMLElement,
  firstParagraph: HTMLParagraphElement | null,
): boolean {
  if (!point) return false;
  const titleBounds = title.getBoundingClientRect();
  if (titleBounds.width <= 0 || titleBounds.height <= 0) return false;
  const paragraphBounds = firstParagraph?.getBoundingClientRect();
  const paragraphTop =
    paragraphBounds && paragraphBounds.height > 0
      ? paragraphBounds.top
      : titleBounds.bottom + 180;
  const bottom = Math.max(
    titleBounds.bottom,
    Math.min(paragraphTop - 1, titleBounds.bottom + 220),
  );
  return (
    point.x >= titleBounds.left - 24 &&
    point.x <= titleBounds.right + 24 &&
    point.y >= titleBounds.top - 16 &&
    point.y <= bottom
  );
}

function pointIsInsideElement(
  point: HoverPoint | undefined,
  element: HTMLElement,
): boolean {
  if (!point) return false;
  const bounds = element.getBoundingClientRect();
  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

function isBeforeElement(element: Element, reference: Element | null): boolean {
  return Boolean(
    reference &&
    element !== reference &&
    element.compareDocumentPosition(reference) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function appearsAboveElement(
  element: HTMLElement,
  reference: HTMLElement | null,
): boolean {
  if (!reference) return false;
  const elementBounds = element.getBoundingClientRect();
  const referenceBounds = reference.getBoundingClientRect();
  if (
    elementBounds.height > 0 &&
    referenceBounds.height > 0 &&
    elementBounds.bottom <= referenceBounds.top
  ) {
    return true;
  }
  return isBeforeElement(element, reference);
}

/**
 * Resolves the open article as one stable title/lead zone. This intentionally
 * runs before the generic link preview resolver: a link rendered over the
 * title of the current page must never downgrade a full analysis to a compact
 * title-only preview.
 */
function resolveCurrentArticleLeadDetails(
  element: Element,
  point: HoverPoint | undefined,
): HoverTargetDetails | null {
  if (!isCurrentArticleDocument()) return null;
  const capture = currentPageCapture();
  if (!capture?.isArticle || capture.wordCount < 80 || !capture.title) {
    return null;
  }
  const title =
    exactDocumentTitleElement() ?? currentArticleTitleElement(capture);
  if (!title) return null;
  const firstParagraph = firstArticleParagraph(title);
  const hoveredHeading =
    headingAtPoint(point) ??
    element.closest<HTMLElement>(MATERIAL_TITLE_SELECTOR);
  const exactTitleTarget =
    hoveredHeading === title ||
    pointIsInsideElement(point, title) ||
    normalizedComparableTitle(element.closest<HTMLElement>('a[href]')) ===
      normalizedComparableTitle(title);
  const leadHeading = Boolean(
    hoveredHeading &&
    appearsAboveElement(hoveredHeading, firstParagraph) &&
    pointIsInsideArticleLead(point, title, firstParagraph),
  );
  if (!exactTitleTarget && !leadHeading) return null;

  return {
    element: title,
    positionElement: title,
    url: window.location.href,
    title: capture.title,
    snippet: capture.excerpt.slice(
      0,
      HOVER_PREVIEW_CONFIG.maximumSnippetCharacters,
    ),
    currentPage: true,
  };
}

function isCurrentArticleTitleDecoration(
  element: Element,
  point: HoverPoint | undefined,
): boolean {
  if (!isCurrentArticleDocument()) return false;
  const capture = currentPageCapture();
  if (!capture?.isArticle || capture.wordCount < 80 || !capture.title) {
    return false;
  }
  const title =
    exactDocumentTitleElement() ?? currentArticleTitleElement(capture);
  const titleBlock = title?.parentElement;
  if (!title || !titleBlock) return false;
  if (element === title || title.contains(element)) return false;
  if (pointIsInsideElement(point, title)) return false;
  return titleBlock === element || titleBlock.contains(element);
}

function normalizedComparableTitle(element: HTMLElement | null): string {
  return normalizedText(
    element?.innerText || element?.textContent,
  ).toLowerCase();
}

function anchorMatchesHeading(
  anchor: HTMLAnchorElement,
  heading: HTMLElement,
): boolean {
  const anchorTitle = normalizedComparableTitle(anchor);
  const headingTitle = normalizedComparableTitle(heading);
  return Boolean(anchorTitle && headingTitle && anchorTitle === headingTitle);
}

function anchorMatchesDocumentTitle(anchor: HTMLAnchorElement): boolean {
  const anchorTitle = normalizedComparableTitle(anchor);
  if (!anchorTitle) return false;
  return documentTitleAliases().some(
    (title) =>
      title === anchorTitle ||
      title.startsWith(`${anchorTitle} |`) ||
      title.startsWith(`${anchorTitle} -`) ||
      title.startsWith(`${anchorTitle} ·`),
  );
}

function isHeadingPermalink(
  anchor: HTMLAnchorElement,
  heading: HTMLElement | null,
  primaryHeading: HTMLElement | null,
): boolean {
  if (!heading || !primaryHeading || heading === primaryHeading) return false;
  const label = normalizedText(
    anchor.innerText ||
      anchor.textContent ||
      anchor.getAttribute('aria-label') ||
      anchor.getAttribute('title'),
  ).toLowerCase();
  return (
    anchorMatchesHeading(anchor, heading) ||
    label === 'link' ||
    label === 'permalink' ||
    label === 'copy link'
  );
}

function appearsBeforeArticleBody(
  element: Element,
  scope: HTMLElement | null,
): boolean {
  const firstParagraph = scope?.querySelector('p');
  return Boolean(
    firstParagraph &&
    element !== firstParagraph &&
    element.compareDocumentPosition(firstParagraph) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function sharesArticleLeadRegion(
  heading: HTMLElement,
  primaryHeading: HTMLElement,
): boolean {
  const headingScope = materialScope(heading);
  const primaryScope = materialScope(primaryHeading);
  if (headingScope && headingScope === primaryScope) {
    const firstParagraph = headingScope.querySelector('p');
    if (
      firstParagraph &&
      appearsBeforeArticleBody(heading, headingScope) &&
      appearsBeforeArticleBody(primaryHeading, headingScope)
    ) {
      return true;
    }
  }
  const leadSelector =
    'header, [data-testid*="post-header" i], [class*="post-header" i], [class*="article-header" i]';
  const headingLead = heading.closest(leadSelector);
  return Boolean(
    headingLead && headingLead === primaryHeading.closest(leadSelector),
  );
}

function httpUrl(anchor: HTMLAnchorElement): string | null {
  try {
    const url = new URL(anchor.href, window.location.href);
    return /^https?:$/i.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function uniqueLinkedUrls(
  container: HTMLElement,
): Array<{ anchor: HTMLAnchorElement; url: string }> {
  const links = Array.from(
    container.querySelectorAll<HTMLAnchorElement>('a[href]'),
  )
    .map((anchor) => ({ anchor, url: httpUrl(anchor) }))
    .filter(
      (item): item is { anchor: HTMLAnchorElement; url: string } =>
        item.url !== null,
    );
  const unique = new Map<string, HTMLAnchorElement>();
  for (const { anchor, url } of links) {
    if (!unique.has(url)) unique.set(url, anchor);
  }
  return Array.from(unique, ([url, anchor]) => ({ anchor, url }));
}

const CITATION_SELECTOR =
  '[data-citation], [data-citation-id], [data-testid*="citation" i], [role="doc-biblioref"], [role="doc-noteref"], .citation, .citation-link';

function isSourceCitation(element: Element): boolean {
  if (element.closest(CITATION_SELECTOR)) return true;
  const anchor = element.closest<HTMLAnchorElement>('a[href]');
  if (!anchor) return false;
  // Source chips often expose only a domain (with no citation attributes).
  // That label is not an article title, even inside an <article> or table row.
  const label = normalizedText(anchor.innerText || anchor.textContent);
  return /^(?:https?:\/\/)?(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?::\d+)?\/?$/iu.test(
    label,
  );
}

function isExcludedUiRegion(
  element: Element | null,
  titleOnly = false,
): boolean {
  const region = element?.closest(
    'nav, header, footer, aside, [role="navigation"], [role="menubar"], [role="menu"]',
  );
  if (!region) return false;
  if (region.matches('header') && region.closest('article, [role="article"]')) {
    return false;
  }
  if (
    region.matches('header') &&
    element instanceof HTMLElement &&
    documentTitleMatchScore(element, titleOnly) > 0
  ) {
    return false;
  }
  return true;
}

function findCardLink(
  element: Element,
  titleOnly = false,
): {
  card: HTMLElement;
  anchor: HTMLAnchorElement;
  url: string;
} | null {
  let current =
    element instanceof HTMLElement ? element : element.parentElement;
  for (
    let depth = 0;
    current && depth < HOVER_PREVIEW_CONFIG.maximumCardAncestors;
    depth += 1
  ) {
    if (isExcludedUiRegion(current, titleOnly)) return null;
    const links = uniqueLinkedUrls(current);
    const postLinks = links.filter(({ url }) => {
      try {
        return new URL(url).pathname.includes('/p/');
      } catch {
        return false;
      }
    });
    const semanticCard = current.matches(
      'article, [role="article"], li, tr, [data-testid*="post" i]',
    );
    const candidate =
      postLinks.length === 1
        ? postLinks[0]
        : semanticCard && links.length === 1
          ? links[0]
          : undefined;
    const heading = element.closest<HTMLElement>(MATERIAL_TITLE_SELECTOR);
    if (
      candidate &&
      isLikelyMaterialAnchor(candidate.anchor, heading, titleOnly)
    ) {
      return { card: current, anchor: candidate.anchor, url: candidate.url };
    }
    current = current.parentElement;
  }
  return null;
}

function usefulTitle(element: Element | null | undefined): string {
  if (!(element instanceof HTMLElement)) return '';
  const text = normalizedText(element.innerText || element.textContent);
  return text.length >= 6 && text.length <= 240 ? text : '';
}

function isLikelyMaterialAnchor(
  anchor: HTMLAnchorElement,
  heading: HTMLElement | null,
  titleOnly = false,
): boolean {
  if (isExcludedUiRegion(anchor, titleOnly) || isSourceCitation(anchor))
    return false;
  if (heading) return true;
  const title = usefulTitle(anchor);
  if (title.length < 12) return false;
  const titleRegion = anchor.closest(
    '.titleline, [class*="headline" i], [data-testid*="title" i]',
  );
  const tableCell = anchor.closest('td, th, [role="cell"], [role="gridcell"]');
  if (tableCell && !titleRegion) {
    // A link embedded in an explanatory/comparison cell is a reference, not
    // a feed item. Keep descriptive title links in their own cells eligible,
    // without requiring a particular URL shape (including query-based URLs).
    return normalizedText(tableCell.textContent) === title && /\s/u.test(title);
  }
  if (
    anchor.closest(
      'article, [role="article"], .titleline, [class*="headline" i], [data-testid*="post" i], [data-testid*="title" i]',
    )
  ) {
    return true;
  }
  const href = httpUrl(anchor);
  if (!href) return false;
  const url = new URL(href);
  const path = url.pathname.toLocaleLowerCase();
  if (isArticlePagePath(path)) {
    return true;
  }
  const slug = path.split('/').filter(Boolean).at(-1) ?? '';
  return slug.includes('-') && slug.split('-').filter(Boolean).length >= 4;
}

/** Setup-only title detection. Never invokes article extraction or evaluation. */
function profileArticleTitle(): HTMLElement | null {
  if (isNonContentApplicationPath(window.location.pathname)) return null;
  const articlePath = isArticlePagePath(window.location.pathname);
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      `${CURRENT_PAGE_TITLE_SELECTOR}${articlePath ? ', a[href]' : ''}`,
    ),
  );
  const ranked = candidates.flatMap((title) => {
    if (
      !usefulTitle(title) ||
      isExcludedUiRegion(title, true) ||
      isSourceCitation(title)
    )
      return [];
    const score = documentTitleMatchScore(title, true);
    const link =
      title.closest<HTMLAnchorElement>('a[href]') ??
      title.querySelector<HTMLAnchorElement>('a[href]');
    // A reader shell may link its title to the publisher's original URL.
    // Accept that only when the open article's own metadata matches it.
    if (
      link &&
      !isCurrentDocumentUrl(link.href) &&
      !(articlePath && score >= 900)
    )
      return [];
    if (title.matches('a') && score < 900) return [];
    const article = title.closest(
      'article, [role="article"], [itemprop="articleBody"]',
    );
    const primaryHeading = title.matches(
      'h1, [role="heading"][aria-level="1"], [itemprop="headline"]',
    );
    if (!((article && primaryHeading) || (articlePath && score >= 900)))
      return [];
    return [{ title, score }];
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.title ?? null;
}

export function resolveProfileHoverTargetDetails(
  element: Element,
  point?: HoverPoint,
): HoverTargetDetails | null {
  if (isSourceCitation(element) || isExcludedUiRegion(element, true))
    return null;
  const title = profileArticleTitle();
  if (title) {
    const rect = title.getBoundingClientRect();
    const overTitle =
      title.contains(element) ||
      (point &&
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom &&
        rect.width > 0);
    return overTitle
      ? {
          element: title,
          positionElement: title,
          url: window.location.href,
          title: usefulTitle(title),
          snippet: '',
          currentPage: true,
        }
      : null;
  }
  const heading = element.closest<HTMLElement>(MATERIAL_TITLE_SELECTOR);
  const anchor = element.closest<HTMLAnchorElement>('a[href]');
  const direct =
    anchor && isLikelyMaterialAnchor(anchor, heading, true)
      ? httpUrl(anchor)
      : null;
  const card = direct ? null : findCardLink(element, true);
  const target = direct ? anchor! : card?.anchor;
  const url = direct ?? card?.url;
  if (
    !target ||
    !url ||
    isCurrentDocumentUrl(url) ||
    suppressApplicationUiPreview(url)
  )
    return null;
  const label = usefulTitle(heading) || usefulTitle(target);
  if (!label) return null;
  return {
    element: target,
    positionElement: heading ?? target,
    url,
    title: label,
    snippet: '',
    currentPage: false,
  };
}

export function resolveHoverTargetDetails(
  element: Element,
  point?: HoverPoint,
): HoverTargetDetails | null {
  if (isSourceCitation(element)) return null;
  // Subtitles and other decorations commonly share a wrapper whose class
  // contains "post-title". Suppress that wrapper before the broad heading
  // resolver can mistake it for the article title itself.
  if (isCurrentArticleTitleDecoration(element, point)) return null;
  const currentArticleLead = resolveCurrentArticleLeadDetails(element, point);
  if (currentArticleLead) return currentArticleLead;

  const directAnchor = element.closest<HTMLAnchorElement>('a[href]');
  const directHref = directAnchor ? httpUrl(directAnchor) : null;
  const scope = materialScope(element) ?? fallbackMaterialScope(document);
  const primaryHeading = primaryMaterialHeading(scope);
  const geometricHeading = headingAtPoint(point);
  const directHeading =
    geometricHeading ?? element.closest<HTMLElement>(MATERIAL_TITLE_SELECTOR);
  const currentRoute = isCurrentArticleDocument();
  const currentDocumentAnchor = directHref
    ? isCurrentDocumentUrl(directHref)
    : false;
  const directCurrentPageHeading = isCurrentPageTitleHeading(
    directHeading,
    primaryHeading,
    scope,
    currentRoute,
    currentDocumentAnchor,
  )
    ? directHeading
    : null;
  if (
    currentRoute &&
    directHeading &&
    primaryHeading &&
    directHeading !== primaryHeading &&
    sharesArticleLeadRegion(directHeading, primaryHeading)
  ) {
    return null;
  }
  if (
    directAnchor &&
    isHeadingPermalink(directAnchor, directHeading, primaryHeading)
  ) {
    return null;
  }

  const scopeFirstParagraph = scope?.querySelector('p') ?? null;
  if (
    currentRoute &&
    directHeading &&
    !directCurrentPageHeading &&
    (!directAnchor || currentDocumentAnchor || !usefulTitle(directAnchor)) &&
    scopeFirstParagraph &&
    !appearsBeforeArticleBody(directHeading, scope)
  ) {
    return null;
  }
  const currentTitleAnchor = Boolean(
    directAnchor &&
    ((primaryHeading && anchorMatchesHeading(directAnchor, primaryHeading)) ||
      anchorMatchesDocumentTitle(directAnchor)),
  );
  const linkedCurrentPageHeading =
    directCurrentPageHeading ??
    (primaryHeading &&
    !isExcludedUiRegion(primaryHeading) &&
    currentTitleAnchor &&
    (currentRoute || currentDocumentAnchor)
      ? primaryHeading
      : null);
  const internalArticleLink =
    directAnchor &&
    !linkedCurrentPageHeading &&
    (directAnchor.getAttribute('href')?.trim().startsWith('#') ||
      currentDocumentAnchor ||
      (currentRoute && appearsBeforeArticleBody(directAnchor, scope)));
  if (internalArticleLink) return null;
  const directUrl =
    !linkedCurrentPageHeading &&
    directAnchor &&
    isLikelyMaterialAnchor(directAnchor, directHeading)
      ? directHref
      : null;
  const discoveredCardLink = directUrl ? null : findCardLink(element);
  const currentPageHeading =
    linkedCurrentPageHeading ??
    (!discoveredCardLink &&
    directCurrentPageHeading &&
    !isExcludedUiRegion(directCurrentPageHeading)
      ? directCurrentPageHeading
      : null);
  const cardLink = directUrl || currentPageHeading ? null : discoveredCardLink;
  const anchor = directUrl ? directAnchor : cardLink?.anchor;
  const url =
    directUrl ??
    cardLink?.url ??
    (currentPageHeading ? window.location.href : null);
  const card =
    cardLink?.card ??
    anchor?.closest<HTMLElement>('article, [role="article"], li, tr') ??
    currentPageHeading?.closest<HTMLElement>('article, main');

  if ((!anchor && !currentPageHeading) || !url) return null;
  if (suppressApplicationUiPreview(url)) return null;

  const cardHeading = card?.querySelector<HTMLElement>(MATERIAL_TITLE_SELECTOR);
  const sameUrlTitleLink = card
    ? Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
        (candidate) => httpUrl(candidate) === url && usefulTitle(candidate),
      )
    : null;
  const title =
    usefulTitle(directHeading) ||
    usefulTitle(cardHeading) ||
    usefulTitle(sameUrlTitleLink) ||
    usefulTitle(anchor);
  if (!title) return null;

  const target = directHeading ?? cardHeading ?? anchor;
  if (!(target instanceof HTMLElement)) return null;
  const hoverElement =
    linkedCurrentPageHeading && directAnchor
      ? directAnchor.contains(linkedCurrentPageHeading)
        ? directAnchor
        : linkedCurrentPageHeading.contains(directAnchor)
          ? linkedCurrentPageHeading
          : directAnchor
      : directAnchor && directHeading
        ? directAnchor.contains(directHeading)
          ? directAnchor
          : directHeading.contains(directAnchor)
            ? directHeading
            : target
        : target;
  const context =
    card ??
    target.closest('article, [role="article"], li, tr, header') ??
    target.parentElement;

  const contextText = normalizedText(
    context?.textContent ||
      anchor?.getAttribute('aria-label') ||
      anchor?.getAttribute('title') ||
      '',
  );
  const snippet = contextText
    .replace(title, '')
    .trim()
    .slice(0, HOVER_PREVIEW_CONFIG.maximumSnippetCharacters);
  return {
    element: hoverElement,
    positionElement: target,
    url,
    title,
    snippet,
    currentPage:
      Boolean(currentPageHeading) &&
      canonicalPageUrl(url) === canonicalPageUrl(window.location.href),
  };
}

function isHoverPreviewResponse(value: unknown): value is HoverPreviewResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const preview = candidate.preview as Record<string, unknown> | undefined;
  // An already open tab may briefly talk to the previous background runtime
  // while an unpacked extension is being rebuilt. Treat that legacy response
  // as Work so the stable card lifecycle is not interrupted during migration.
  if (preview && preview.scenario === undefined) preview.scenario = 'work';
  return (
    candidate.ok === true &&
    Boolean(preview) &&
    (candidate.saved === undefined || typeof candidate.saved === 'boolean') &&
    (candidate.novelPassageHighlightsEnabled === undefined ||
      typeof candidate.novelPassageHighlightsEnabled === 'boolean') &&
    (candidate.readwiseConnected === undefined ||
      typeof candidate.readwiseConnected === 'boolean') &&
    (candidate.analysisSource === undefined ||
      candidate.analysisSource === 'local' ||
      candidate.analysisSource === 'ai') &&
    (candidate.aiState === undefined ||
      ['ready', 'not-connected', 'local-only', 'error'].includes(
        String(candidate.aiState),
      )) &&
    ['work', 'learn', 'explore', 'relax'].includes(String(preview?.scenario)) &&
    (preview?.utilityScore === null ||
      typeof preview?.utilityScore === 'number') &&
    ['open', 'maybe', 'save', 'skip'].includes(
      String(preview?.recommendedAction),
    ) &&
    typeof preview?.reason === 'string' &&
    typeof preview?.expectedValue === 'string' &&
    typeof preview?.risk === 'string' &&
    ['low', 'medium', 'high'].includes(String(preview?.confidence)) &&
    Array.isArray(preview?.signalIds) &&
    preview.signalIds.every((id) => typeof id === 'string') &&
    typeof preview?.calibrationSampleSize === 'number' &&
    (preview?.components === undefined ||
      (typeof preview.components === 'object' &&
        preview.components !== null)) &&
    (preview?.scenarioSignals === undefined ||
      (typeof preview.scenarioSignals === 'object' &&
        preview.scenarioSignals !== null)) &&
    (preview?.estimatedUsefulMinutes === undefined ||
      typeof preview.estimatedUsefulMinutes === 'number') &&
    (preview?.recommendedSections === undefined ||
      (Array.isArray(preview.recommendedSections) &&
        preview.recommendedSections.every(
          (section) => typeof section === 'string',
        ))) &&
    (preview?.insights === undefined || isPreviewInsights(preview.insights)) &&
    (preview?.source === 'full-analysis' || preview?.source === 'title-preview')
  );
}

function isPreviewInsights(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const insights = value as Record<string, unknown>;
  const quality = insights.qualityBreakdown as
    Record<string, unknown> | undefined;
  const reliability = insights.reliability as
    Record<string, unknown> | undefined;
  return (
    Array.isArray(insights.likelyNewClaims) &&
    insights.likelyNewClaims.every((claim) => typeof claim === 'string') &&
    typeof insights.noveltySummary === 'string' &&
    typeof insights.noveltyConfidence === 'number' &&
    Boolean(quality) &&
    ['evidence', 'reasoning', 'specificity', 'calibration'].every(
      (key) => typeof quality?.[key] === 'number',
    ) &&
    typeof insights.qualitySummary === 'string' &&
    Array.isArray(insights.qualityLimitations) &&
    insights.qualityLimitations.every(
      (limitation) => typeof limitation === 'string',
    ) &&
    typeof insights.qualityConfidence === 'number' &&
    (reliability === undefined ||
      (typeof reliability.languageSupported === 'boolean' &&
        typeof reliability.extractionConfidence === 'number' &&
        typeof reliability.overallConfidence === 'number' &&
        ['high', 'medium', 'low'].includes(String(reliability.level)) &&
        typeof reliability.weakExtraction === 'boolean'))
  );
}

export interface HoverReadingPlan {
  title: string;
  headings: string[];
}

export function materialHoverReadingPlan(
  preview: HoverPreview,
  material: PageCapture,
  language: UiLanguage = DEFAULT_UI_LANGUAGE,
): HoverReadingPlan | null {
  const availableHeadings = new Set(material.headings);
  const headings = (preview.recommendedSections ?? [])
    .filter((heading) => availableHeadings.has(heading))
    .filter((heading, index, values) => values.indexOf(heading) === index)
    .slice(0, 2);
  if (headings.length === 0) return null;
  const representedSections = Math.max(
    headings.length,
    material.headings.length,
  );
  const minutes = Math.max(
    1,
    Math.min(
      material.readingTimeMinutes,
      Math.round(
        material.readingTimeMinutes * (headings.length / representedSections),
      ),
    ),
  );
  return {
    title: readingPlanText(
      language,
      headings.length === 1 ? 'titleSingle' : 'titlePlural',
      {
        total: material.readingTimeMinutes,
        count: headings.length,
        minutes,
      },
    ),
    headings,
  };
}

export function personalValuePromise(
  preview: HoverPreview,
  language: UiLanguage = DEFAULT_UI_LANGUAGE,
  passageMatches?: readonly NovelPassageMatch[],
): string {
  if (preview.insights?.readingPassages) {
    const selection = preview.insights.readingPassages;
    const first = selection.items[0];
    return first
      ? passageText(
          language,
          first.knowledge === 'possibly-new' ? 'possiblyNew' : first.basis,
        )
      : '';
  }
  const claims = passageMatches
    ? passageMatches.map((match) => match.claim)
    : potentialNewKeyClaims(preview.insights?.keyClaims);
  const factCount = claims.filter(
    (claim) => claim.type === 'fact' || claim.type === 'evidence',
  ).length;
  const conclusionCount = claims.length - factCount;
  const parts: string[] = [];
  if (factCount > 0) {
    parts.push(formatNovelItem(language, 'fact', factCount));
  }
  if (conclusionCount > 0) {
    parts.push(formatNovelItem(language, 'conclusion', conclusionCount));
  }
  if (preview.scenario === 'relax') {
    const signals = preview.scenarioSignals;
    if (!signals) return uiText(language, 'tasteUnclear');
    if (signals.enjoymentFit >= 72 && signals.tasteFit >= 62) {
      return uiText(language, 'relaxFit');
    }
    if (signals.effortFit < 45) return uiText(language, 'tooMuchEffort');
    return uiText(language, 'relaxMaybe');
  }
  if (preview.scenario === 'explore') {
    const discoveries = Math.max(parts.length, claims.length);
    if ((preview.scenarioSignals?.serendipity ?? 0) >= 68) {
      return discoveries > 0
        ? uiText(language, 'discoveryLikely', { count: discoveries })
        : uiText(language, 'discoveryConnection');
    }
    return uiText(language, 'discoveryUnclear');
  }
  if (parts.length > 0) {
    return uiText(
      language,
      preview.scenario === 'learn' ? 'likelyPrefix' : 'forYouPrefix',
      { items: formatUiList(language, parts) },
    );
  }

  const fallbackCount = passageMatches
    ? 0
    : (preview.insights?.likelyNewClaims.length ?? 0);
  if (fallbackCount > 0) {
    return uiText(language, 'likelyNewIdea', { count: fallbackCount });
  }
  if ((preview.components?.novelty ?? 50) < 50) {
    return (preview.components?.relevance ?? 0) >= 65
      ? uiText(language, 'topicButLittleNew')
      : uiText(language, 'littleNew');
  }
  return uiText(language, 'noveltyUnclear');
}

export function personalValueReason(
  preview: HoverPreview,
  language: UiLanguage = DEFAULT_UI_LANGUAGE,
): string {
  if (preview.suggestedScenario === 'learn') {
    return uiText(language, 'betterForLearn');
  }
  const signals = preview.scenarioSignals;
  if (preview.scenario === 'relax') {
    if (!signals) return uiText(language, 'leisureDataNeeded');
    if (signals.effortFit < 50) return uiText(language, 'harderThanWanted');
    if (signals.tasteFit >= 70) return uiText(language, 'usualTaste');
    return uiText(language, 'moodUnclear');
  }
  if (preview.scenario === 'learn') {
    if ((signals?.knowledgeFit ?? 50) < 45) {
      return uiText(language, 'levelMismatch');
    }
    if ((preview.components?.novelty ?? 50) < 45) {
      return uiText(language, 'mostlyFamiliar');
    }
    return uiText(language, 'learningNextStep');
  }
  if (preview.scenario === 'explore') {
    if ((signals?.serendipity ?? 50) >= 68) {
      return uiText(language, 'meaningfulConnection');
    }
    return uiText(language, 'noStrongConnection');
  }
  const relevance = preview.components?.relevance ?? 50;
  if (relevance < 50) return uiText(language, 'outsideInterests');
  const relevanceText =
    relevance >= 70
      ? uiText(language, 'topicFits')
      : uiText(language, 'topicPartlyFits');
  const quality = preview.components?.quality ?? 50;
  const breakdown = preview.insights?.qualityBreakdown;
  if (breakdown && breakdown.reasoning < 50) {
    return uiText(language, 'conclusionsUnreliable', { topic: relevanceText });
  }
  if (breakdown && breakdown.evidence < 50) {
    return uiText(language, 'conclusionsNeedEvidence', {
      topic: relevanceText,
    });
  }
  if (quality >= 70) {
    return uiText(language, 'conclusionsConvincing', { topic: relevanceText });
  }
  if (quality < 50) {
    return uiText(language, 'conclusionsRecheck', { topic: relevanceText });
  }
  return uiText(language, 'conclusionsBetterRecheck', { topic: relevanceText });
}

export function materialReadingInfo(
  preview: HoverPreview,
  material: PageCapture,
  language: UiLanguage = DEFAULT_UI_LANGUAGE,
): string {
  const details = [
    uiText(language, 'readingDuration', {
      count: Math.max(1, material.readingTimeMinutes),
    }),
  ];
  const recommendedSectionCount = Math.min(
    2,
    preview.recommendedSections?.length ?? 0,
  );
  if (material.readingTimeMinutes >= 12 && recommendedSectionCount === 2) {
    details.push(
      uiText(language, 'startWithSections', {
        count: recommendedSectionCount,
      }),
    );
  }
  return details.join(' · ');
}

function positionCard(host: HTMLElement, target: HTMLElement): void {
  const rect = target.getBoundingClientRect();
  const expanded = host.dataset.attentionExpanded === 'true';
  const profilePrompt = host.dataset.attentionProfileRequired === 'true';
  const width = Math.min(
    expanded ? 360 : profilePrompt ? 290 : 200,
    window.innerWidth - 20,
  );
  const estimatedHeight =
    expanded || profilePrompt
      ? Math.min(
          host.getBoundingClientRect().height || 320,
          window.innerHeight - 20,
        )
      : 48;
  if (expanded && rect.right + 12 + width <= window.innerWidth - 10) {
    const top = Math.min(
      Math.max(10, rect.top),
      Math.max(10, window.innerHeight - estimatedHeight - 10),
    );
    host.style.left = `${Math.round(rect.right + 12)}px`;
    host.style.top = `${Math.round(top)}px`;
    return;
  }
  const left = Math.min(
    Math.max(10, rect.left),
    Math.max(10, window.innerWidth - width - 10),
  );
  const below = rect.bottom + 9;
  const top =
    below + estimatedHeight <= window.innerHeight
      ? below
      : Math.max(10, rect.top - estimatedHeight - 9);
  host.style.left = `${Math.round(left)}px`;
  host.style.top = `${Math.round(top)}px`;
}

export interface HoverPreviewController {
  dispose(): void;
  openCurrentArticle(): Promise<CardOpenResponse>;
}

export function installHoverPreview(
  options: {
    profileRequired?: boolean;
    onCurrentPageEvaluation?: (capture: PageCapture) => void;
    getUiLanguage?: () => UiLanguage;
    onDecision?: (
      capture: PageCapture,
      decision: MaterialDecision,
    ) => Promise<boolean>;
  } = {},
): HoverPreviewController {
  // Always replace an existing runtime, even when its public version string is
  // identical. During local extension development Chrome can leave the old
  // content-script world alive in an already open SPA tab. Returning early in
  // that situation made a freshly built title-card fix indistinguishable from
  // the stale compact-card implementation.
  hoverGlobal.__attentionHoverPreviewAbort?.abort();
  document
    .querySelectorAll<HTMLElement>('[data-attention-preview="true"]')
    .forEach((element) => element.remove());
  const listenerController = new AbortController();
  hoverGlobal.__attentionHoverPreviewInstalled = true;
  hoverGlobal.__attentionHoverPreviewVersion = EXTENSION_RUNTIME_VERSION;
  hoverGlobal.__attentionHoverPreviewAbort = listenerController;

  const view = installCardHost();
  const currentLanguage = (): UiLanguage =>
    options.getUiLanguage?.() ?? DEFAULT_UI_LANGUAGE;
  const profileRequired = options.profileRequired === true;
  const profilePrompt = profileRequired
    ? installProfilePrompt(view, currentLanguage, listenerController.signal)
    : null;
  const resolveTarget = profileRequired
    ? resolveProfileHoverTargetDetails
    : resolveHoverTargetDetails;
  const openLabel = (): string =>
    profileRequired
      ? profileCardText(currentLanguage(), 'create')
      : readingPlanText(currentLanguage(), 'open');
  view.host.dataset.attentionVersion = EXTENSION_RUNTIME_VERSION;
  view.host.dataset.attentionContract = HOVER_CONTRACT_VERSION;
  view.host.dataset.attentionExpanded = 'false';
  const cache = new Map<string, HoverPreviewResponse>();
  const savedUrls = new Set<string>();
  const novelPassages = new NovelPassageController();
  let activeTarget: HTMLElement | null = null;
  let activeCacheKey: string | null = null;
  let hoverTimer = 0;
  let leaveTimer = 0;
  let mutationRetryTimer = 0;
  let requestVersion = 0;
  let pendingCardOpen: {
    url: string;
    promise: Promise<CardOpenResponse>;
    resolve: (response: CardOpenResponse) => void;
  } | null = null;
  const settlePendingCardOpen = (response: CardOpenResponse): void => {
    const pending = pendingCardOpen;
    pendingCardOpen = null;
    pending?.resolve(response);
  };
  let readingCandidateAnnouncedForUrl: string | null = null;
  let lastPointerMoveAt = 0;
  let lastPointerElement: Element | null = null;
  let lastPointerPoint: HoverPoint | undefined;
  let observedHoverUrl = canonicalPageUrl(window.location.href);
  let pointerEventCount = 0;
  let activeSaveCapture: PageCapture | null = null;
  let activeNovelMatches: NovelPassageMatch[] = [];
  let activeNovelCapture: PageCapture | null = null;
  let activeReadwiseConnected = false;
  let activeDetails: HoverTargetDetails | null = null;
  let activeRecommendedHeadings: string[] = [];
  let restartHydrationObservation = (): void => undefined;
  let hydrationObservationRoot: HTMLElement | null = null;
  let keyboardTrigger: HTMLButtonElement | null = null;
  let keyboardTitle: HTMLElement | null = null;
  let keyboardOpening = false;
  let focusAfterRefresh: HTMLElement | null = null;
  let primaryDecision: MaterialDecision = 'read';
  let contextPending = false;
  let savingUrl: string | null = null;
  let saveRevision = 0;
  let refreshKeyboardTrigger = (): void => undefined;
  const keyboardInteractionActive = (): boolean =>
    (document.activeElement === view.host &&
      view.host.style.display === 'block') ||
    (keyboardOpening && document.activeElement === keyboardTrigger);
  view.host.dataset.attentionInstalledUrl = observedHoverUrl;
  view.host.dataset.attentionPointerEvents = '0';

  const contextControl = new CardContextControl(
    view.contextSlot,
    async (context: AnalysisContext) => {
      const details = activeDetails;
      if (!details?.currentPage) throw new Error('No active article');
      const pageUrl = window.location.href;
      contextPending = true;
      view.saveButton.disabled = true;
      view.passagesButton.disabled = true;
      try {
        const response: ContextResponse = await chrome.runtime.sendMessage({
          type: ATTENTION_CONTEXT_UPDATE_TYPE,
          url: pageUrl,
          context,
        });
        if (
          !response.ok ||
          !isAnalysisContextDto(response.context) ||
          listenerController.signal.aborted ||
          pageUrl !== window.location.href
        )
          throw new Error('Context update failed');
        handleRuntimeInvalidation({
          type: ATTENTION_INPUTS_INVALIDATED_TYPE,
          changedKeys: ['analysisContext', 'attentionScenario'],
        });
        return response.context;
      } finally {
        contextPending = false;
        view.saveButton.disabled =
          Boolean(savingUrl) || view.host.dataset.attentionSaved === 'true';
        view.passagesButton.disabled = false;
      }
    },
    listenerController.signal,
  );

  const cacheKey = (details: HoverTargetDetails): string => {
    const capture =
      !profileRequired && details.currentPage ? currentPageCapture() : null;
    const hydrationSignature = capture
      ? `${capture.wordCount}:${capture.content.length}`
      : '';
    return `${details.currentPage ? 'current-page' : 'linked-page'}\n${details.url}\n${details.title}\n${hydrationSignature}`;
  };

  const emitPreviewEvent = (
    event: HoverPreviewEventMessage['event'],
    details: HoverTargetDetails,
    preview: HoverPreview,
  ): void => {
    const message: HoverPreviewEventMessage = {
      type: HOVER_PREVIEW_EVENT_TYPE,
      event,
      scenario: preview.scenario,
      url: details.url,
      title: details.title,
      verdict: previewVerdict(preview),
      recommendedAction: preview.recommendedAction,
      source: preview.source,
      signalIds: preview.signalIds,
      occurredAt: new Date().toISOString(),
    };
    void chrome.runtime.sendMessage(message).catch(() => undefined);
  };

  const hide = (options?: { keepPendingOpen?: boolean }): void => {
    if (!options?.keepPendingOpen)
      settlePendingCardOpen({ ok: false, reason: 'unavailable' });
    window.clearTimeout(hoverTimer);
    window.clearTimeout(leaveTimer);
    leaveTimer = 0;
    activeTarget = null;
    activeCacheKey = null;
    activeSaveCapture = null;
    activeNovelMatches = [];
    activeNovelCapture = null;
    activeReadwiseConnected = false;
    activeDetails = null;
    activeRecommendedHeadings = [];
    requestVersion += 1;
    view.host.style.display = 'none';
    view.host.style.pointerEvents = 'none';
    keyboardTrigger?.setAttribute('aria-expanded', 'false');
  };

  view.closeButton.addEventListener(
    'click',
    (event) => {
      if (!isTrustedUserInteraction(event)) return;
      event.preventDefault();
      keyboardOpening = false;
      hide();
      keyboardTrigger?.focus({ preventScroll: true });
    },
    { signal: listenerController.signal },
  );
  for (const disclosure of [view.details, contextControl.details]) {
    disclosure.addEventListener(
      'toggle',
      () => {
        if (activeDetails && view.host.style.display === 'block')
          positionCard(view.host, activeDetails.positionElement);
      },
      { signal: listenerController.signal },
    );
  }

  const scheduleHide = (): void => {
    if (leaveTimer) return;
    leaveTimer = window.setTimeout(hide, 300);
  };

  const cancelScheduledHide = (): void => {
    window.clearTimeout(leaveTimer);
    leaveTimer = 0;
  };

  const handleExpandedPointer = (point: HoverPoint): boolean => {
    if (
      !activeDetails ||
      view.host.style.display !== 'block' ||
      (view.host.dataset.attentionExpanded !== 'true' && !profileRequired)
    )
      return false;
    if (synchronizeHoverRoute()) return false;
    if (
      isInHoverRegion(
        point,
        activeDetails.positionElement.getBoundingClientRect(),
        view.host.getBoundingClientRect(),
      )
    )
      cancelScheduledHide();
    else scheduleHide();
    // A background pointerover/move in the gap must not resolve a new target
    // and immediately hide the card, bypassing its leave timer.
    return true;
  };

  view.host.addEventListener('pointerenter', cancelScheduledHide, {
    signal: listenerController.signal,
  });
  view.host.addEventListener(
    'pointerleave',
    () => {
      if (!keyboardInteractionActive()) scheduleHide();
    },
    {
      signal: listenerController.signal,
    },
  );

  view.saveButton.addEventListener(
    'click',
    (event) => {
      if (!isTrustedUserInteraction(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!activeSaveCapture || view.saveButton.disabled) return;
      const capture = activeSaveCapture;
      const url = canonicalPageUrl(capture.url);
      const revision = ++saveRevision;
      savingUrl = url;
      view.host.focus({ preventScroll: true });
      view.saveButton.disabled = true;
      view.saveButton.textContent = uiText(currentLanguage(), 'saving');
      view.actionStatus.hidden = true;
      void (
        options.onDecision
          ? options.onDecision(capture, 'save').then((ok) => ({ ok }))
          : chrome.runtime.sendMessage({
              type: SAVE_MATERIAL_REQUEST_TYPE,
              capture,
            })
      )
        .then((response: unknown) => {
          if (listenerController.signal.aborted || revision !== saveRevision)
            return;
          const ok =
            Boolean(response) &&
            typeof response === 'object' &&
            (response as Record<string, unknown>).ok === true;
          if (!ok) throw new Error('Save failed');
          savingUrl = null;
          savedUrls.add(url);
          if (activeSaveCapture?.url !== capture.url) return;
          view.host.dataset.attentionSaved = 'true';
          view.saveButton.textContent = uiText(currentLanguage(), 'saved');
          view.saveButton.disabled = true;
          view.actionStatus.hidden = true;
        })
        .catch(() => {
          if (listenerController.signal.aborted || revision !== saveRevision)
            return;
          savingUrl = null;
          if (activeSaveCapture?.url !== capture.url) return;
          view.saveButton.textContent = cardText(
            currentLanguage(),
            'saveForLater',
          );
          view.saveButton.disabled = contextPending;
          view.actionStatus.textContent = uiText(
            currentLanguage(),
            'saveFailed',
          );
          view.actionStatus.hidden = false;
        });
    },
    { signal: listenerController.signal },
  );

  view.passagesButton.addEventListener(
    'click',
    (event) => {
      if (!isTrustedUserInteraction(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (
        contextPending ||
        !activeNovelCapture ||
        activeNovelMatches.length === 0
      )
        return;
      const capture = activeNovelCapture;
      const matches = activeNovelMatches.slice();
      const readwiseConnected = activeReadwiseConnected;
      const shown = novelPassages.show(matches, capture, {
        language: currentLanguage(),
        readwiseConnected,
      });
      if (shown) hide();
      else {
        view.actionStatus.hidden = false;
        view.actionStatus.textContent = passageText(currentLanguage(), 'stale');
      }
    },
    { signal: listenerController.signal },
  );

  view.highlightSectionsButton.addEventListener(
    'click',
    (event) => {
      if (!isTrustedUserInteraction(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (activeRecommendedHeadings.length === 0) return;
      highlightRecommendedSections(
        document,
        activeRecommendedHeadings,
        currentLanguage(),
      );
      scrollToHeading(document, activeRecommendedHeadings[0]!);
      hide();
    },
    { signal: listenerController.signal },
  );

  const runtimeChanges = chrome.runtime.onMessage;
  const handleRuntimeInvalidation = (message: unknown): void => {
    // Chrome may already have snapshotted this listener when the profile gate
    // disposes the runtime earlier in the same broadcast.
    if (listenerController.signal.aborted) return;
    if (!message || typeof message !== 'object') return;
    const type = (message as { type?: unknown }).type;
    if (
      type !== ATTENTION_INPUTS_INVALIDATED_TYPE &&
      type !== 'ATTENTION_UI/LANGUAGE_CHANGED'
    )
      return;
    const changedKeys = (message as { changedKeys?: unknown }).changedKeys;
    const erased =
      Array.isArray(changedKeys) &&
      changedKeys.includes('attentionDataGeneration');
    if (erased) {
      saveRevision += 1;
      savingUrl = null;
    }
    const onlyPassageFeedbackChanged =
      type === ATTENTION_INPUTS_INVALIDATED_TYPE &&
      Array.isArray(changedKeys) &&
      changedKeys.length > 0 &&
      changedKeys.every(
        (key) =>
          key === 'novelPassageFeedback' || key === 'claimMemoryRevision',
      );
    const previous = !erased ? activeDetails : null;
    const restoreKeyboardFocus =
      keyboardOpening || document.activeElement === view.host;
    const focused = (view.card.getRootNode() as ShadowRoot).activeElement;
    if (restoreKeyboardFocus && focused instanceof HTMLElement)
      focusAfterRefresh = focused;
    if (erased) {
      contextControl.reset();
      view.details.open = false;
      focusAfterRefresh = null;
    }
    cache.clear();
    savedUrls.clear();
    // Recompute the recommendation after feedback, but keep the passage the
    // user selected available for the next action (for example, Readwise).
    // Changes to privacy, connections, context or settings still close it.
    if (!onlyPassageFeedbackChanged) novelPassages.clear();
    if (restoreKeyboardFocus) keyboardTrigger?.focus();
    hide({
      keepPendingOpen: Boolean(previous?.element.isConnected && !erased),
    });
    refreshKeyboardTrigger();
    if (previous?.element.isConnected) {
      keyboardOpening = restoreKeyboardFocus;
      schedulePreview(previous.element);
    }
  };
  runtimeChanges?.addListener(handleRuntimeInvalidation);
  listenerController.signal.addEventListener('abort', () => {
    runtimeChanges?.removeListener(handleRuntimeInvalidation);
  });

  const synchronizeHoverRoute = (): boolean => {
    const currentUrl = canonicalPageUrl(window.location.href);
    if (currentUrl === observedHoverUrl) {
      // A SPA can publish the new URL before it swaps the article DOM. Repair
      // an observer that was attached to the outgoing, now detached article.
      if (hydrationObservationRoot && !hydrationObservationRoot.isConnected) {
        restartHydrationObservation();
      }
      if (keyboardTrigger && !keyboardTrigger.isConnected)
        refreshKeyboardTrigger();
      return false;
    }
    observedHoverUrl = currentUrl;
    view.host.dataset.attentionInstalledUrl = currentUrl;
    extractedPageCache.invalidate();
    cache.clear();
    novelPassages.clear();
    contextControl.reset();
    view.details.open = false;
    focusAfterRefresh = null;
    readingCandidateAnnouncedForUrl = null;
    hide();
    restartHydrationObservation();
    refreshKeyboardTrigger();
    return true;
  };

  const show = async (
    details: HoverTargetDetails,
    version: number,
  ): Promise<void> => {
    if (profilePrompt) {
      if (version !== requestVersion || activeTarget !== details.element)
        return;
      profilePrompt.render(details.currentPage);
      view.host.style.display = 'block';
      view.host.style.pointerEvents = 'auto';
      positionCard(view.host, details.positionElement);
      keyboardTrigger?.setAttribute('aria-expanded', 'true');
      if (keyboardOpening) {
        keyboardOpening = false;
        profilePrompt.button.focus({ preventScroll: true });
      }
      settlePendingCardOpen({ ok: true });
      return;
    }
    const key = cacheKey(details);
    // Target resolution already captured the current article. Reuse that
    // cached result instead of cloning and parsing the full page a second time.
    const cachedPageCapture = details.currentPage ? currentPageCapture() : null;
    const pageCapture = cachedPageCapture
      ? {
          ...cachedPageCapture,
          content: cachedPageCapture.content.slice(
            0,
            HOVER_PREVIEW_CONFIG.currentPageContentCharacters,
          ),
        }
      : null;
    let cachedResponse = cache.get(key);
    let preview = cachedResponse?.preview;
    // A title-only result must never pin the current article to compact mode.
    // This can happen on pages with transparent linked overlays (notably
    // Substack): pointerover first sees the link, while pointermove later maps
    // the same DOM node to the real article heading underneath it.
    if (details.currentPage && preview?.source !== 'full-analysis') {
      preview = undefined;
      cachedResponse = undefined;
      cache.delete(key);
    }
    if (!preview) {
      const response: unknown = await chrome.runtime.sendMessage({
        type: HOVER_PREVIEW_REQUEST_TYPE,
        url: details.url,
        title: details.title,
        snippet: details.snippet,
        ...(pageCapture ? { capture: pageCapture } : {}),
      });
      if (!isHoverPreviewResponse(response)) {
        if (version === requestVersion)
          settlePendingCardOpen({ ok: false, reason: 'unavailable' });
        return;
      }
      if (version !== requestVersion || activeTarget !== details.element)
        return;
      cachedResponse = response;
      preview = response.preview;
      const canonicalUrl = canonicalPageUrl(details.url);
      if (response.saved === true) savedUrls.add(canonicalUrl);
      else savedUrls.delete(canonicalUrl);
      cache.set(key, response);
    }
    if (version !== requestVersion || activeTarget !== details.element) return;
    // The open article title requires a full evaluation. Linked materials on
    // feed pages deliberately use the compact title-only recommendation.
    if (
      details.currentPage &&
      (preview.source !== 'full-analysis' ||
        preview.utilityScore === null ||
        !preview.components)
    ) {
      hide();
      return;
    }
    const verdict = previewVerdict(preview);
    const language = currentLanguage();
    view.card.dir = language === 'ar' ? 'rtl' : 'ltr';
    const label = verdictLabel(language, verdict);
    const expanded = details.currentPage;
    primaryDecision = fullCardDecision(preview);
    if (
      expanded &&
      pageCapture &&
      readingCandidateAnnouncedForUrl !== canonicalPageUrl(pageCapture.url) &&
      pageCapture.isArticle &&
      pageCapture.wordCount >= 80
    ) {
      readingCandidateAnnouncedForUrl = canonicalPageUrl(pageCapture.url);
      options.onCurrentPageEvaluation?.(pageCapture);
    }
    const headlineKeys: Record<MaterialDecision, CardTextKey> = {
      read: 'readHeadline',
      skim: 'skimHeadline',
      save: 'saveHeadline',
      skip: 'skipHeadline',
    };
    view.verdict.textContent = expanded
      ? cardText(language, headlineKeys[primaryDecision])
      : label;
    view.card.classList.toggle('expanded', expanded);
    view.host.dataset.attentionExpanded = String(expanded);
    view.host.style.pointerEvents = expanded ? 'auto' : 'none';
    activeSaveCapture = expanded ? cachedPageCapture : null;
    activeNovelMatches =
      expanded &&
      cachedPageCapture &&
      cachedResponse?.novelPassageHighlightsEnabled === true
        ? findNovelPassageMatches(
            document,
            cachedPageCapture,
            preview.insights?.keyClaims,
            undefined,
            preview.insights?.readingPassages,
          )
        : [];
    activeNovelCapture =
      activeNovelMatches.length > 0 ? cachedPageCapture : null;
    activeReadwiseConnected = cachedResponse?.readwiseConnected === true;
    const hasPassages = activeNovelMatches.length > 0;
    view.passagesButton.hidden = !hasPassages;
    view.passagesButton.disabled = contextPending;
    view.passagesButton.dataset.primary = String(hasPassages);
    view.passagesButton.textContent = cardText(
      language,
      activeNovelMatches.length === 1 ? 'passageOne' : 'passages',
      {
        count: activeNovelMatches.length,
      },
    );
    const passageMinutes = Math.max(
      1,
      calculateReadingTime(
        countWords(
          [...new Set(activeNovelMatches.map((match) => match.excerpt))].join(
            ' ',
          ),
        ),
      ),
    );
    const selection = preview.insights?.readingPassages;
    view.passageHint.hidden =
      !expanded ||
      cachedResponse?.novelPassageHighlightsEnabled !== true ||
      (!hasPassages && !selection);
    const passageStatus =
      selection?.status === 'no-context'
        ? 'noContext'
        : !hasPassages
          ? 'empty'
          : 'hint';
    const coverageStatus =
      selection?.status === 'unavailable'
        ? 'unavailable'
        : selection?.coverage === 'partial'
          ? 'partial'
          : null;
    view.passageHint.textContent = [
      coverageStatus ? passageText(language, coverageStatus) : '',
      passageText(language, passageStatus, { minutes: passageMinutes }),
    ]
      .filter(Boolean)
      .join(' ');
    const isSaved = savedUrls.has(canonicalPageUrl(details.url));
    const isSaving = savingUrl === canonicalPageUrl(details.url);
    view.host.dataset.attentionSaved = String(isSaved);
    view.saveButton.dataset.primary = String(!hasPassages);
    view.saveButton.disabled = isSaved || isSaving || contextPending;
    view.saveButton.textContent =
      isSaved || isSaving
        ? uiText(language, isSaved ? 'saved' : 'saving')
        : cardText(language, 'saveForLater');
    const promise = expanded ? personalValuePromise(preview, language) : '';
    const reason = expanded ? personalValueReason(preview, language) : '';
    view.score.textContent = reason;
    view.decisionSummary.textContent = promise;
    view.detailsSummary.textContent = cardText(language, 'details');
    view.closeButton.setAttribute('aria-label', cardText(language, 'close'));
    view.closeButton.title = cardText(language, 'close');
    view.scoreDetail.textContent =
      preview.utilityScore === null
        ? ''
        : cardText(language, 'score', { score: preview.utilityScore });
    if (expanded)
      contextControl.render(
        isAnalysisContextDto(cachedResponse?.context)
          ? cachedResponse.context
          : { scenario: preview.scenario, intent: '', availableMinutes: 15 },
        language,
      );
    const readingPlan =
      expanded && pageCapture
        ? materialHoverReadingPlan(preview, pageCapture, language)
        : null;
    activeRecommendedHeadings = readingPlan?.headings ?? [];
    view.usefulTime.textContent =
      expanded && pageCapture
        ? cardText(language, 'fullReading', {
            minutes: Math.max(1, pageCapture.readingTimeMinutes),
          })
        : '';
    view.readingPlanSections.replaceChildren();
    if (readingPlan) {
      view.readingPlanTitle.textContent = cardText(language, 'sections');
      readingPlan.headings.forEach((heading, index) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.className = 'reading-plan-section';
        button.type = 'button';
        const number = document.createElement('span');
        number.textContent = String(index + 1);
        const label = document.createElement('span');
        label.textContent = heading;
        button.append(number, label);
        button.addEventListener(
          'click',
          (event) => {
            if (!isTrustedUserInteraction(event)) return;
            event.preventDefault();
            event.stopPropagation();
            highlightRecommendedSections(
              document,
              readingPlan.headings,
              currentLanguage(),
            );
            scrollToHeading(document, heading);
            hide();
          },
          { signal: listenerController.signal },
        );
        item.append(button);
        view.readingPlanSections.append(item);
      });
    }
    view.readingPlan.hidden = !readingPlan;
    view.highlightSectionsButton.textContent = readingPlanText(
      language,
      'highlight',
    );
    view.actionStatus.hidden = true;
    const primaryButton = hasPassages ? view.passagesButton : view.saveButton;
    view.host.dataset.attentionPlan = readingPlan?.title ?? '';
    const weakExtraction =
      expanded && preview.insights?.reliability?.weakExtraction === true;
    view.reliabilityNote.textContent = weakExtraction
      ? uiText(language, 'weakExtraction')
      : '';
    view.reliabilityNote.classList.toggle('has-warning', weakExtraction);
    view.host.dataset.attentionWeakExtraction = String(weakExtraction);
    const analysisSource = cachedResponse?.analysisSource ?? 'local';
    const aiState = cachedResponse?.aiState ?? 'not-connected';
    view.analysisSource.textContent = uiText(
      language,
      analysisSource === 'ai' ? 'checkedWithAi' : 'localAnalysisSource',
    );
    view.analysisSource.dataset.source = analysisSource;
    view.aiButton.disabled =
      analysisSource === 'ai' ||
      aiState === 'local-only' ||
      aiState === 'not-connected';
    view.aiButton.hidden = analysisSource === 'ai';
    view.aiButton.textContent = uiText(
      language,
      analysisSource === 'ai'
        ? 'checkedWithAi'
        : aiState === 'local-only'
          ? 'aiBlockedLocalOnly'
          : aiState === 'not-connected'
            ? 'aiNotConnected'
            : aiState === 'error'
              ? 'retryWithAi'
              : 'checkWithAi',
    );
    view.host.dataset.attentionAnalysisSource = analysisSource;
    view.host.dataset.attentionAiState = aiState;
    view.card.dataset.verdict = verdict;
    view.host.dataset.attentionAction = preview.recommendedAction;
    view.host.dataset.attentionScenario = preview.scenario;
    view.host.dataset.attentionVerdict = verdict;
    view.host.dataset.attentionSource = preview.source;
    view.host.dataset.attentionHeadline = view.verdict.textContent;
    view.host.dataset.attentionScore = String(preview.utilityScore ?? '');
    view.host.dataset.attentionDecision = primaryDecision;
    view.host.dataset.attentionReadingInfo = view.usefulTime.textContent;
    view.host.dataset.attentionPointerEvents = String(pointerEventCount);
    view.host.setAttribute('role', expanded ? 'dialog' : 'status');
    view.host.setAttribute('aria-label', expanded ? 'Attention' : label);
    view.host.style.display = 'block';
    positionCard(view.host, details.positionElement);
    keyboardTrigger?.setAttribute('aria-expanded', String(expanded));
    if (keyboardOpening) {
      keyboardOpening = false;
      const focusTarget =
        focusAfterRefresh?.isConnected &&
        !focusAfterRefresh.closest('details:not([open])') &&
        !focusAfterRefresh.matches(':disabled')
          ? focusAfterRefresh
          : primaryButton.disabled
            ? view.closeButton
            : primaryButton;
      focusAfterRefresh = null;
      focusTarget.focus({ preventScroll: true });
    }
    emitPreviewEvent('shown', details, preview);
    if (
      details.currentPage &&
      pendingCardOpen?.url === canonicalPageUrl(details.url)
    )
      settlePendingCardOpen({ ok: true });
  };

  view.aiButton.addEventListener(
    'click',
    (event) => {
      if (!isTrustedUserInteraction(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (
        !activeDetails?.currentPage ||
        !activeSaveCapture ||
        !activeCacheKey ||
        view.aiButton.disabled
      ) {
        return;
      }
      const details = activeDetails;
      const capture = {
        ...activeSaveCapture,
        content: activeSaveCapture.content.slice(
          0,
          HOVER_PREVIEW_CONFIG.currentPageContentCharacters,
        ),
      };
      const key = activeCacheKey;
      const version = ++requestVersion;
      view.host.focus({ preventScroll: true });
      view.aiButton.disabled = true;
      view.aiButton.textContent = uiText(currentLanguage(), 'checkingWithAi');
      void chrome.runtime
        .sendMessage({
          type: HOVER_PREVIEW_REQUEST_TYPE,
          url: details.url,
          title: details.title,
          snippet: details.snippet,
          capture,
          analysisMode: 'ai',
        })
        .then(async (response: unknown) => {
          if (!isHoverPreviewResponse(response)) {
            throw new Error('Invalid AI preview response');
          }
          if (
            version !== requestVersion ||
            activeTarget !== details.element ||
            activeCacheKey !== key
          ) {
            return;
          }
          cache.set(key, response);
          await show(details, version);
        })
        .catch(() => {
          if (
            version !== requestVersion ||
            activeTarget !== details.element ||
            activeCacheKey !== key
          ) {
            return;
          }
          view.aiButton.disabled = false;
          view.aiButton.textContent = uiText(currentLanguage(), 'retryWithAi');
        });
    },
    { signal: listenerController.signal },
  );

  const schedulePreview = (element: Element, point?: HoverPoint): void => {
    if (listenerController.signal.aborted) return;
    synchronizeHoverRoute();
    const details = resolveTarget(element, point);
    if (!details) {
      if (activeTarget) hide();
      return;
    }
    // Product contract has two page modes. Feed pages show compact verdicts
    // for material links. Once an article is open, all linked/body previews are
    // silent and only its exact title can show the expanded evaluation.
    if (
      !profileRequired &&
      isCurrentArticleDocument() &&
      !details.currentPage
    ) {
      if (activeTarget) hide();
      return;
    }
    const key = cacheKey(details);
    if (activeTarget === details.element && activeCacheKey === key) return;
    hide({
      keepPendingOpen:
        details.currentPage &&
        pendingCardOpen?.url === canonicalPageUrl(details.url),
    });
    activeTarget = details.element;
    activeDetails = details;
    activeCacheKey = key;
    const version = ++requestVersion;
    hoverTimer = window.setTimeout(
      () => {
        void show(details, version).catch(() => {
          if (version === requestVersion) hide();
        });
      },
      details.currentPage
        ? HOVER_PREVIEW_CONFIG.currentPageDelayMs
        : HOVER_PREVIEW_CONFIG.feedDelayMs,
    );
  };

  const recordPointerEvent = (): void => {
    pointerEventCount += 1;
  };

  refreshKeyboardTrigger = (): void => {
    if (listenerController.signal.aborted) return;
    const capture = profileRequired ? null : currentPageCapture();
    const title = profileRequired
      ? profileArticleTitle()
      : capture?.isArticle && capture.wordCount >= 80
        ? (exactDocumentTitleElement() ?? currentArticleTitleElement(capture))
        : null;
    if (title === keyboardTitle && keyboardTrigger?.isConnected) {
      keyboardTrigger.setAttribute('aria-label', openLabel());
      keyboardTrigger.title = openLabel();
      return;
    }
    keyboardTrigger?.remove();
    keyboardTrigger = null;
    keyboardTitle = title;
    if (!title) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.attentionTrigger = 'true';
    button.textContent = 'Attention';
    button.setAttribute('aria-label', openLabel());
    button.title = openLabel();
    button.setAttribute('aria-controls', view.host.id);
    button.setAttribute('aria-expanded', 'false');
    Object.assign(button.style, {
      display: 'inline-block',
      margin: '8px 0',
      padding: '6px 10px',
      border: '1px solid #166b4f',
      borderRadius: '7px',
      color: '#166b4f',
      background: '#effaf4',
      font: '700 12px/1.4 system-ui, sans-serif',
      cursor: 'pointer',
    });
    button.addEventListener(
      'click',
      (event) => {
        if (!isTrustedUserInteraction(event)) return;
        event.preventDefault();
        event.stopPropagation();
        keyboardOpening = true;
        if (view.host.style.display === 'block' && activeDetails?.currentPage) {
          keyboardOpening = false;
          const primary =
            profilePrompt?.button ??
            (view.passagesButton.hidden
              ? view.saveButton
              : view.passagesButton);
          (primary.disabled ? view.closeButton : primary).focus();
        } else {
          schedulePreview(title);
        }
      },
      { signal: listenerController.signal },
    );
    title.insertAdjacentElement('afterend', button);
    keyboardTrigger = button;
  };

  document.addEventListener(
    'click',
    (event) => {
      if (!isTrustedUserInteraction(event)) return;
      if (!(event.target instanceof Element)) return;
      if (
        event.target === view.host ||
        event.target.closest('[data-attention-trigger]')
      )
        return;
      if (profileRequired) return;
      const details = resolveHoverTargetDetails(event.target);
      if (!details) return;
      const preview = cache.get(cacheKey(details))?.preview;
      if (preview) emitPreviewEvent('opened', details, preview);
    },
    { capture: true, signal: listenerController.signal },
  );

  document.addEventListener(
    'pointerover',
    (event) => {
      if (keyboardInteractionActive()) return;
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-attention-trigger]')) return;
      if (event.target === view.host) {
        cancelScheduledHide();
        return;
      }
      recordPointerEvent();
      lastPointerElement = event.target;
      lastPointerPoint = { x: event.clientX, y: event.clientY };
      if (handleExpandedPointer(lastPointerPoint)) return;
      schedulePreview(event.target, lastPointerPoint);
    },
    { capture: true, signal: listenerController.signal },
  );

  document.addEventListener(
    'pointermove',
    (event) => {
      if (keyboardInteractionActive()) return;
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-attention-trigger]')) return;
      if (event.target === view.host) {
        cancelScheduledHide();
        return;
      }
      recordPointerEvent();
      lastPointerElement = event.target;
      lastPointerPoint = { x: event.clientX, y: event.clientY };
      if (handleExpandedPointer(lastPointerPoint)) return;
      const now = performance.now();
      if (now - lastPointerMoveAt < HOVER_PREVIEW_CONFIG.pointerThrottleMs)
        return;
      lastPointerMoveAt = now;
      const point = lastPointerPoint;
      if (
        !activeTarget &&
        !event.target.closest(`a[href], ${MATERIAL_TITLE_SELECTOR}`) &&
        !(profileRequired ? profileArticleTitle() : headingAtPoint(point))
      ) {
        return;
      }
      schedulePreview(event.target, point);
    },
    { capture: true, signal: listenerController.signal },
  );

  document.addEventListener(
    'focusin',
    (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-attention-trigger]')) return;
      if (event.target === view.host) {
        cancelScheduledHide();
        return;
      }
      schedulePreview(event.target);
    },
    { capture: true, signal: listenerController.signal },
  );

  document.addEventListener(
    'pointerout',
    (event) => {
      if (keyboardInteractionActive()) return;
      const related = event.relatedTarget;
      if (related === view.host || related === keyboardTrigger) {
        cancelScheduledHide();
        return;
      }
      lastPointerElement = related instanceof Element ? related : null;
      if (!(related instanceof Element)) lastPointerPoint = undefined;
      if (!activeTarget) return;
      if (related === view.host) {
        cancelScheduledHide();
        return;
      }
      if (related instanceof Node && activeTarget.contains(related)) return;
      if (handleExpandedPointer({ x: event.clientX, y: event.clientY })) return;
      if (event.target instanceof Node && activeTarget.contains(event.target)) {
        if (profileRequired || view.host.dataset.attentionExpanded === 'true')
          scheduleHide();
        else hide();
      }
    },
    { capture: true, signal: listenerController.signal },
  );
  document.addEventListener(
    'focusout',
    (event) => {
      if (!activeTarget) return;
      const related = event.relatedTarget;
      if (related === view.host || related === keyboardTrigger) return;
      if (event.target === view.host || event.target === keyboardTrigger) {
        keyboardOpening = false;
        hide();
        return;
      }
      if (related instanceof Node && activeTarget.contains(related)) return;
      if (event.target instanceof Node && activeTarget.contains(event.target)) {
        hide();
      }
    },
    { capture: true, signal: listenerController.signal },
  );
  const clearPointerAndHide = (): void => {
    lastPointerElement = null;
    lastPointerPoint = undefined;
    hide();
  };
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        !isTrustedUserInteraction(event) ||
        event.key !== 'Escape' ||
        view.host.style.display !== 'block'
      )
        return;
      event.preventDefault();
      const restoreFocus = document.activeElement === view.host;
      keyboardOpening = false;
      hide();
      if (restoreFocus) keyboardTrigger?.focus();
    },
    { capture: true, signal: listenerController.signal },
  );
  document.documentElement.addEventListener(
    'pointerleave',
    () => {
      if (!keyboardInteractionActive()) clearPointerAndHide();
    },
    {
      signal: listenerController.signal,
    },
  );
  window.addEventListener('blur', clearPointerAndHide, {
    signal: listenerController.signal,
  });
  window.addEventListener(
    'resize',
    () => {
      if (activeDetails && view.host.style.display === 'block')
        positionCard(view.host, activeDetails.positionElement);
    },
    { signal: listenerController.signal },
  );
  subscribeToScroll(() => {
    lastPointerElement = null;
    lastPointerPoint = undefined;
    // Focus and section navigation can scroll after Enter has scheduled the
    // card. Keep an explicit keyboard interaction alive through those events;
    // pointer-only previews still disappear immediately when the page moves.
    if (keyboardInteractionActive() && activeDetails) {
      if (view.host.style.display === 'block')
        positionCard(view.host, activeDetails.positionElement);
      return;
    }
    hide();
  }, listenerController.signal);

  // Substack and similar SPA readers publish the route before the article body
  // is hydrated. Observe only the article/main region, and only for a short
  // startup window. Long-lived feeds and web apps therefore have no permanent
  // whole-document observer.
  let hydrationObserver: MutationObserver | null = null;
  let hydrationStopTimer = 0;
  const stopHydrationObservation = (): void => {
    window.clearTimeout(mutationRetryTimer);
    window.clearTimeout(hydrationStopTimer);
    mutationRetryTimer = 0;
    hydrationStopTimer = 0;
    hydrationObserver?.disconnect();
    hydrationObserver = null;
    hydrationObservationRoot = null;
  };
  restartHydrationObservation = (): void => {
    stopHydrationObservation();
    if (
      !(profileRequired
        ? profileArticleTitle() || isArticlePagePath(window.location.pathname)
        : isCurrentArticleDocument())
    )
      return;
    const observationRoot =
      (profileRequired ? null : findCurrentArticleRoot(document)) ??
      document.querySelector<HTMLElement>('article, main, [role="main"]') ??
      document.body;
    if (!observationRoot || typeof MutationObserver === 'undefined') return;
    hydrationObservationRoot = observationRoot;
    hydrationObserver = new MutationObserver(() => {
      window.clearTimeout(mutationRetryTimer);
      mutationRetryTimer = window.setTimeout(() => {
        refreshKeyboardTrigger();
        if (
          keyboardInteractionActive() ||
          (view.host.style.display === 'block' &&
            view.host.dataset.attentionExpanded === 'true')
        ) {
          return;
        }
        let target =
          lastPointerElement?.isConnected === true ? lastPointerElement : null;
        if (!target && lastPointerPoint && document.elementFromPoint) {
          target = document.elementFromPoint(
            lastPointerPoint.x,
            lastPointerPoint.y,
          );
        }
        if (target) schedulePreview(target, lastPointerPoint);
      }, HOVER_PREVIEW_CONFIG.hydrationRetryMs);
    });
    hydrationObserver.observe(observationRoot, {
      childList: true,
      subtree: true,
    });
    hydrationStopTimer = window.setTimeout(
      stopHydrationObservation,
      HOVER_PREVIEW_CONFIG.hydrationObservationWindowMs,
    );
  };
  installRouteWatcher(synchronizeHoverRoute, listenerController.signal, {
    fallbackIntervalMs: HOVER_PREVIEW_CONFIG.routeWatchIntervalMs,
  });
  restartHydrationObservation();
  refreshKeyboardTrigger();
  listenerController.signal.addEventListener('abort', () => {
    hide();
    keyboardTrigger?.remove();
    view.host.remove();
    stopHydrationObservation();
    novelPassages.clear();
  });
  return {
    dispose: () => listenerController.abort(),
    async openCurrentArticle(): Promise<CardOpenResponse> {
      if (listenerController.signal.aborted)
        return { ok: false, reason: 'unavailable' };
      synchronizeHoverRoute();
      if (profilePrompt) {
        const title = profileArticleTitle();
        const details = title && resolveTarget(title);
        if (!details) return { ok: false, reason: 'not_article' };
        hide();
        activeTarget = details.element;
        activeDetails = details;
        activeCacheKey = cacheKey(details);
        keyboardOpening = true;
        await show(details, ++requestVersion);
        return { ok: true };
      }
      const capture = currentPageCapture();
      const root = capture && findCurrentArticleRoot(document, capture.title);
      if (!capture?.isArticle || capture.wordCount < 80 || !root)
        return { ok: false, reason: 'not_article' };
      const url = canonicalPageUrl(window.location.href);
      if (pendingCardOpen?.url === url) return pendingCardOpen.promise;
      refreshKeyboardTrigger();
      const title = keyboardTitle ?? root;
      const resolved = resolveHoverTargetDetails(title);
      const details: HoverTargetDetails = resolved?.currentPage
        ? resolved
        : {
            element: title,
            positionElement: title,
            title: capture.title,
            url: window.location.href,
            snippet: capture.excerpt,
            currentPage: true,
          };
      hide();
      let resolve!: (response: CardOpenResponse) => void;
      const opened = new Promise<CardOpenResponse>((complete) => {
        resolve = complete;
      });
      pendingCardOpen = { url, promise: opened, resolve };
      keyboardOpening = true;
      focusAfterRefresh = null;
      activeTarget = details.element;
      activeDetails = details;
      activeCacheKey = cacheKey(details);
      const version = ++requestVersion;
      // A settings broadcast can supersede this render while it is awaiting
      // analysis. Keep OPEN attached to the fresh render already scheduled by
      // invalidation; erasure, navigation and user dismissal cancel it in hide.
      void show(details, version).catch(() => {
        if (version === requestVersion) hide();
      });
      return opened;
    },
  };
}
