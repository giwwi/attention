import {
  HOVER_PREVIEW_EVENT_TYPE,
  HOVER_PREVIEW_REQUEST_TYPE,
  SAVE_MATERIAL_REQUEST_TYPE,
  type HoverPreview,
  type HoverPreviewEventMessage,
  type HoverPreviewResponse,
  type HoverPreviewVerdict,
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
import {
  findCurrentArticleRoot,
  findCurrentArticleTitleElement,
} from './article-root';
import { captureDocument } from './capture';
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

interface HoverPreviewGlobal {
  __attentionHoverPreviewInstalled?: boolean;
  __attentionHoverPreviewVersion?: string;
  __attentionHoverPreviewAbort?: AbortController;
}

const hoverGlobal = globalThis as typeof globalThis & HoverPreviewGlobal;
const HOVER_CONTRACT_VERSION =
  'feed-compact-current-title-expanded-actionable-value-spa-v13';
const SCENARIO_STATE_STORAGE_KEY = 'attentionScenario';
const ANALYSIS_CONTEXT_STORAGE_KEY = 'analysisContext';
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
  const path = decodeURIComponent(pathname).toLocaleLowerCase();
  return NON_CONTENT_APPLICATION_PATH.test(path);
}

function suppressApplicationUiPreview(
  targetUrl: string,
  currentPageHeading: HTMLElement | null,
): boolean {
  let target: URL;
  try {
    target = new URL(targetUrl, window.location.href);
  } catch {
    return true;
  }
  const currentIsApplicationUi = isNonContentApplicationPath(
    window.location.pathname,
  );
  const targetIsApplicationUi =
    target.origin === window.location.origin &&
    isNonContentApplicationPath(target.pathname);
  if (currentPageHeading && currentIsApplicationUi) return true;
  return targetIsApplicationUi;
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

function documentTitleAliases(): string[] {
  const extractedTitle = extractedCurrentPageTitle();
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

function currentPageCapture(): PageCapture | null {
  if (!isArticlePagePath(window.location.pathname)) return null;
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

function documentTitleMatchScore(element: HTMLElement): number {
  const candidate = normalizedComparableTitle(element);
  if (!candidate) return 0;
  return documentTitleAliases().reduce((best, title) => {
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
  if (!isArticlePagePath(window.location.pathname)) return null;
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
  if (!isArticlePagePath(window.location.pathname)) return false;
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

function isExcludedUiRegion(element: Element | null): boolean {
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
    documentTitleMatchScore(element) > 0
  ) {
    return false;
  }
  return true;
}

function findCardLink(element: Element): {
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
    if (isExcludedUiRegion(current)) return null;
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
    if (candidate) {
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
): boolean {
  if (isExcludedUiRegion(anchor)) return false;
  if (heading) return true;
  const title = usefulTitle(anchor);
  if (title.length < 12) return false;
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
  const path = decodeURIComponent(url.pathname).toLocaleLowerCase();
  if (isArticlePagePath(path)) {
    return true;
  }
  const slug = path.split('/').filter(Boolean).at(-1) ?? '';
  return slug.includes('-') && slug.split('-').filter(Boolean).length >= 4;
}

export function resolveHoverTargetDetails(
  element: Element,
  point?: HoverPoint,
): HoverTargetDetails | null {
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
  const currentRoute = isArticlePagePath(window.location.pathname);
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
  if (suppressApplicationUiPreview(url, currentPageHeading)) return null;

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

function installCardHost(): {
  host: HTMLDivElement;
  card: HTMLDivElement;
  verdict: HTMLDivElement;
  score: HTMLDivElement;
  decisionSummary: HTMLDivElement;
  usefulTime: HTMLDivElement;
  reliabilityNote: HTMLDivElement;
  analysisSource: HTMLSpanElement;
  aiButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
  passagesButton: HTMLButtonElement;
} {
  const host = document.createElement('div');
  host.dataset.attentionPreview = 'true';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  Object.assign(host.style, {
    all: 'initial',
    display: 'none',
    position: 'fixed',
    zIndex: '2147483647',
    pointerEvents: 'none',
  });
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .card { display: flex; min-width: 164px; align-items: center; justify-content: center; gap: 7px; border: 1px solid #3fcf8e; border-radius: 10px; padding: 10px 12px; color: #dff9ec; background: #0d2d23; box-shadow: 0 10px 28px rgba(0,0,0,.24), 0 0 0 1px rgba(63,207,142,.12); font: 800 12px/1.2 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: .035em; text-align: center; }
    .card::before { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #42d392; box-shadow: 0 0 0 3px rgba(66,211,146,.14); content: ""; }
    .card[data-verdict="maybe"] { border-color: #8b929a; color: #f0f2f4; background: #292d32; box-shadow: 0 10px 28px rgba(0,0,0,.24), 0 0 0 1px rgba(139,146,154,.12); }
    .card[data-verdict="maybe"]::before { background: #a7adb4; box-shadow: 0 0 0 3px rgba(167,173,180,.14); }
    .card[data-verdict="skip"] { border-color: #e85c5c; color: #ffe5e5; background: #35191c; box-shadow: 0 10px 28px rgba(0,0,0,.24), 0 0 0 1px rgba(232,92,92,.12); }
    .card[data-verdict="skip"]::before { background: #ff6b6b; box-shadow: 0 0 0 3px rgba(255,107,107,.14); }
    .score, .decision-summary, .useful-time, .reliability-note, .analysis-controls, .save-button, .passages-button { display: none; }
    .card.expanded { display: block; box-sizing: border-box; width: min(350px, calc(100vw - 20px)); padding: 14px 15px; font-weight: 500; letter-spacing: 0; text-align: left; }
    .card.expanded::before { display: inline-block; margin: 0 8px 1px 0; }
    .card.expanded .verdict { display: inline; font-size: 12px; font-weight: 800; letter-spacing: .035em; }
    .card.expanded .score { display: block; margin-top: 7px; color: inherit; font-size: 20px; font-weight: 850; line-height: 1.2; }
    .card.expanded .decision-summary { display: block; margin-top: 8px; color: rgba(255,255,255,.82); font-size: 11px; font-weight: 650; line-height: 1.4; }
    .card.expanded .useful-time { display: block; margin-top: 7px; color: rgba(255,255,255,.62); font-size: 10px; font-weight: 650; }
    .card.expanded .reliability-note.has-warning { display: block; margin-top: 8px; border-top: 1px solid rgba(255,255,255,.14); padding-top: 7px; color: rgba(255,255,255,.72); font-size: 9px; font-weight: 650; line-height: 1.35; }
    .card.expanded .analysis-controls { display: flex; align-items: center; justify-content: space-between; gap: 9px; margin-top: 11px; border-top: 1px solid rgba(255,255,255,.14); padding-top: 10px; }
    .analysis-source { color: rgba(255,255,255,.62); font-size: 9px; font-weight: 700; line-height: 1.25; }
    .card.expanded .ai-button, .card.expanded .save-button, .card.expanded .passages-button:not([hidden]) { display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,.28); border-radius: 8px; padding: 7px 10px; color: inherit; background: rgba(255,255,255,.08); font: 750 10px/1 Inter, ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
    .card.expanded .save-button, .card.expanded .passages-button:not([hidden]) { margin-top: 9px; }
    .card.expanded .passages-button:not([hidden]) { margin-right: 6px; border-color: rgba(126,226,184,.48); background: rgba(63,207,142,.12); }
    .card.expanded .ai-button:not(:disabled) { border-color: rgba(126,226,184,.58); background: rgba(63,207,142,.14); }
    .card.expanded .ai-button:hover, .card.expanded .save-button:hover, .card.expanded .passages-button:hover { background: rgba(255,255,255,.15); }
    .card.expanded .ai-button:focus-visible, .card.expanded .save-button:focus-visible, .card.expanded .passages-button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
    .card.expanded .ai-button:disabled, .card.expanded .save-button:disabled, .card.expanded .passages-button:disabled { cursor: default; opacity: .62; }
  `;
  const card = document.createElement('div');
  card.className = 'card';
  const verdict = document.createElement('div');
  verdict.className = 'verdict';
  const score = document.createElement('div');
  score.className = 'score';
  const decisionSummary = document.createElement('div');
  decisionSummary.className = 'decision-summary';
  const usefulTime = document.createElement('div');
  usefulTime.className = 'useful-time';
  const reliabilityNote = document.createElement('div');
  reliabilityNote.className = 'reliability-note';
  const analysisControls = document.createElement('div');
  analysisControls.className = 'analysis-controls';
  const analysisSource = document.createElement('span');
  analysisSource.className = 'analysis-source';
  const aiButton = document.createElement('button');
  aiButton.className = 'ai-button';
  aiButton.type = 'button';
  analysisControls.append(analysisSource, aiButton);
  const saveButton = document.createElement('button');
  saveButton.className = 'save-button';
  saveButton.type = 'button';
  saveButton.textContent = 'Сохранить';
  const passagesButton = document.createElement('button');
  passagesButton.className = 'passages-button';
  passagesButton.type = 'button';
  passagesButton.hidden = true;
  card.append(
    verdict,
    score,
    decisionSummary,
    usefulTime,
    reliabilityNote,
    analysisControls,
    passagesButton,
    saveButton,
  );
  shadow.append(style, card);
  document.documentElement.append(host);
  return {
    host,
    card,
    verdict,
    score,
    decisionSummary,
    usefulTime,
    reliabilityNote,
    analysisSource,
    aiButton,
    saveButton,
    passagesButton,
  };
}

export function personalValuePromise(
  preview: HoverPreview,
  language: UiLanguage = DEFAULT_UI_LANGUAGE,
  passageMatches?: readonly NovelPassageMatch[],
): string {
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
  const width = expanded ? 350 : 200;
  const estimatedHeight = expanded ? 190 : 48;
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

export function installHoverPreview(
  options: {
    onCurrentPageEvaluation?: (capture: PageCapture) => void;
    getUiLanguage?: () => UiLanguage;
  } = {},
): void {
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
  let restartHydrationObservation = (): void => undefined;
  let hydrationObservationRoot: HTMLElement | null = null;
  view.host.dataset.attentionInstalledUrl = observedHoverUrl;
  view.host.dataset.attentionPointerEvents = '0';

  const cacheKey = (details: HoverTargetDetails): string => {
    const capture = details.currentPage ? currentPageCapture() : null;
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

  const hide = (): void => {
    window.clearTimeout(hoverTimer);
    window.clearTimeout(leaveTimer);
    activeTarget = null;
    activeCacheKey = null;
    activeSaveCapture = null;
    activeNovelMatches = [];
    activeNovelCapture = null;
    activeReadwiseConnected = false;
    activeDetails = null;
    requestVersion += 1;
    view.host.style.display = 'none';
    view.host.style.pointerEvents = 'none';
  };

  const scheduleHide = (): void => {
    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(hide, 180);
  };

  const cancelScheduledHide = (): void => {
    window.clearTimeout(leaveTimer);
  };

  view.host.addEventListener('pointerenter', cancelScheduledHide, {
    signal: listenerController.signal,
  });
  view.host.addEventListener('pointerleave', hide, {
    signal: listenerController.signal,
  });

  view.saveButton.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!activeSaveCapture || view.saveButton.disabled) return;
      const capture = activeSaveCapture;
      view.saveButton.disabled = true;
      view.saveButton.textContent = uiText(currentLanguage(), 'saving');
      void chrome.runtime
        .sendMessage({
          type: SAVE_MATERIAL_REQUEST_TYPE,
          capture,
        })
        .then((response: unknown) => {
          const ok =
            Boolean(response) &&
            typeof response === 'object' &&
            (response as Record<string, unknown>).ok === true;
          if (!ok) throw new Error('Save failed');
          savedUrls.add(canonicalPageUrl(capture.url));
          view.host.dataset.attentionSaved = 'true';
          view.saveButton.textContent = uiText(currentLanguage(), 'saved');
        })
        .catch(() => {
          view.saveButton.textContent = uiText(currentLanguage(), 'saveFailed');
          window.setTimeout(() => {
            if (view.host.style.display === 'block') {
              view.saveButton.textContent = uiText(currentLanguage(), 'save');
              view.saveButton.disabled = false;
            }
          }, 1400);
        });
    },
    { signal: listenerController.signal },
  );

  view.passagesButton.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!activeNovelCapture || activeNovelMatches.length === 0) return;
      novelPassages.show(activeNovelMatches, activeNovelCapture, {
        language: currentLanguage(),
        readwiseConnected: activeReadwiseConnected,
      });
    },
    { signal: listenerController.signal },
  );

  const handleScenarioStorageChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (
      areaName !== 'local' ||
      (!changes[SCENARIO_STATE_STORAGE_KEY] &&
        !changes[ANALYSIS_CONTEXT_STORAGE_KEY] &&
        !changes.novelPassageHighlightsEnabled)
    )
      return;
    cache.clear();
    hide();
  };
  const storageChanges = chrome.storage?.onChanged;
  storageChanges?.addListener(handleScenarioStorageChange);
  listenerController.signal.addEventListener('abort', () => {
    storageChanges?.removeListener(handleScenarioStorageChange);
  });

  const synchronizeHoverRoute = (): boolean => {
    const currentUrl = canonicalPageUrl(window.location.href);
    if (currentUrl === observedHoverUrl) {
      // A SPA can publish the new URL before it swaps the article DOM. Repair
      // an observer that was attached to the outgoing, now detached article.
      if (hydrationObservationRoot && !hydrationObservationRoot.isConnected) {
        restartHydrationObservation();
      }
      return false;
    }
    observedHoverUrl = currentUrl;
    view.host.dataset.attentionInstalledUrl = currentUrl;
    extractedPageCache.invalidate();
    cache.clear();
    novelPassages.clear();
    readingCandidateAnnouncedForUrl = null;
    hide();
    restartHydrationObservation();
    return true;
  };

  const show = async (
    details: HoverTargetDetails,
    version: number,
  ): Promise<void> => {
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
      if (!isHoverPreviewResponse(response)) return;
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
    view.verdict.textContent =
      expanded && preview.utilityScore !== null
        ? `${label} · ${preview.utilityScore}%`
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
          )
        : [];
    activeNovelCapture =
      activeNovelMatches.length > 0 ? cachedPageCapture : null;
    activeReadwiseConnected = cachedResponse?.readwiseConnected === true;
    view.passagesButton.hidden = activeNovelMatches.length === 0;
    view.passagesButton.textContent = uiText(language, 'showPotentialNew', {
      count: activeNovelMatches.length,
    });
    const isSaved = savedUrls.has(canonicalPageUrl(details.url));
    view.host.dataset.attentionSaved = String(isSaved);
    view.saveButton.disabled = isSaved;
    view.saveButton.textContent = uiText(language, isSaved ? 'saved' : 'save');
    const promise = expanded
      ? personalValuePromise(preview, language, activeNovelMatches)
      : '';
    const reason = expanded ? personalValueReason(preview, language) : '';
    view.score.textContent = promise;
    view.decisionSummary.textContent = reason;
    view.usefulTime.textContent =
      expanded && pageCapture
        ? materialReadingInfo(preview, pageCapture, language)
        : '';
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
      analysisSource === 'ai' ? 'aiAnalysisSource' : 'localAnalysisSource',
    );
    view.aiButton.disabled =
      analysisSource === 'ai' ||
      aiState === 'local-only' ||
      aiState === 'not-connected';
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
    view.host.dataset.attentionVerdict = verdict;
    view.host.dataset.attentionSource = preview.source;
    view.host.dataset.attentionHeadline = view.verdict.textContent;
    view.host.dataset.attentionReadingInfo = view.usefulTime.textContent;
    view.host.dataset.attentionPointerEvents = String(pointerEventCount);
    view.host.setAttribute(
      'aria-label',
      expanded && preview.utilityScore !== null
        ? `${label}, ${uiText(language, 'percentSpoken', { count: preview.utilityScore })}. ${promise}. ${reason}. ${view.usefulTime.textContent}. ${view.analysisSource.textContent}. ${view.reliabilityNote.textContent}.`.trim()
        : label,
    );
    positionCard(view.host, details.positionElement);
    view.host.style.display = 'block';
    emitPreviewEvent('shown', details, preview);
  };

  view.aiButton.addEventListener(
    'click',
    (event) => {
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
    synchronizeHoverRoute();
    const details = resolveHoverTargetDetails(element, point);
    if (!details) {
      if (activeTarget) hide();
      return;
    }
    // Product contract has two page modes. Feed pages show compact verdicts
    // for material links. Once an article is open, all linked/body previews are
    // silent and only its exact title can show the expanded evaluation.
    if (isArticlePagePath(window.location.pathname) && !details.currentPage) {
      if (activeTarget) hide();
      return;
    }
    const key = cacheKey(details);
    if (activeTarget === details.element && activeCacheKey === key) return;
    hide();
    activeTarget = details.element;
    activeDetails = details;
    activeCacheKey = key;
    const version = ++requestVersion;
    hoverTimer = window.setTimeout(
      () => {
        void show(details, version).catch(hide);
      },
      details.currentPage
        ? HOVER_PREVIEW_CONFIG.currentPageDelayMs
        : HOVER_PREVIEW_CONFIG.feedDelayMs,
    );
  };

  const recordPointerEvent = (): void => {
    pointerEventCount += 1;
  };

  document.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target === view.host) return;
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
      if (!(event.target instanceof Element)) return;
      if (event.target === view.host) {
        cancelScheduledHide();
        return;
      }
      recordPointerEvent();
      lastPointerElement = event.target;
      lastPointerPoint = { x: event.clientX, y: event.clientY };
      schedulePreview(event.target, lastPointerPoint);
    },
    { capture: true, signal: listenerController.signal },
  );

  document.addEventListener(
    'pointermove',
    (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target === view.host) {
        cancelScheduledHide();
        return;
      }
      recordPointerEvent();
      lastPointerElement = event.target;
      lastPointerPoint = { x: event.clientX, y: event.clientY };
      const now = performance.now();
      if (now - lastPointerMoveAt < HOVER_PREVIEW_CONFIG.pointerThrottleMs)
        return;
      lastPointerMoveAt = now;
      const point = lastPointerPoint;
      if (
        !activeTarget &&
        !event.target.closest(`a[href], ${MATERIAL_TITLE_SELECTOR}`) &&
        !headingAtPoint(point)
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
      const related = event.relatedTarget;
      lastPointerElement = related instanceof Element ? related : null;
      if (!(related instanceof Element)) lastPointerPoint = undefined;
      if (!activeTarget) return;
      if (related === view.host) {
        cancelScheduledHide();
        return;
      }
      if (related instanceof Node && activeTarget.contains(related)) return;
      if (event.target instanceof Node && activeTarget.contains(event.target)) {
        if (view.host.dataset.attentionExpanded === 'true') scheduleHide();
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
  document.documentElement.addEventListener(
    'pointerleave',
    clearPointerAndHide,
    {
      signal: listenerController.signal,
    },
  );
  window.addEventListener('blur', clearPointerAndHide, {
    signal: listenerController.signal,
  });
  subscribeToScroll(clearPointerAndHide, listenerController.signal);

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
    if (!isArticlePagePath(window.location.pathname)) return;
    const observationRoot =
      findCurrentArticleRoot(document) ??
      document.querySelector<HTMLElement>('article, main, [role="main"]') ??
      document.body;
    if (!observationRoot || typeof MutationObserver === 'undefined') return;
    hydrationObservationRoot = observationRoot;
    hydrationObserver = new MutationObserver(() => {
      window.clearTimeout(mutationRetryTimer);
      mutationRetryTimer = window.setTimeout(() => {
        if (
          view.host.style.display === 'block' &&
          view.host.dataset.attentionExpanded === 'true'
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
  listenerController.signal.addEventListener('abort', () => {
    stopHydrationObservation();
    novelPassages.clear();
  });
}
