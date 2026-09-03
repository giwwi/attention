import { Readability } from '@mozilla/readability';
import type { PageCapture, PageStructureSignals } from '../shared/types';
import {
  findCurrentArticleRoot,
  findCurrentArticleTitleElement,
} from './article-root';
import { extractVisibleText, normalizeWhitespace } from './extract';
import { EXTRACTION_CONFIG } from './config';
import { measureSync } from '../performance/metrics';

function findMetaContent(document: Document, keys: string[]): string | null {
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
  for (const meta of document.querySelectorAll('meta')) {
    const key = (meta.getAttribute('property') ?? meta.getAttribute('name'))
      ?.trim()
      .toLowerCase();
    const content = meta.getAttribute('content')?.trim();
    if (key && content && normalizedKeys.has(key)) return content;
  }
  return null;
}

function siteNameFromUrl(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function calculateReadingTime(wordCount: number): number {
  return wordCount === 0
    ? 0
    : Math.max(1, Math.ceil(wordCount / EXTRACTION_CONFIG.wordsPerMinute));
}

function extractHeadings(content: string, fallbackRoot: ParentNode): string[] {
  const parsed = new DOMParser().parseFromString(content, 'text/html');
  const source = parsed.querySelectorAll('h1, h2, h3').length
    ? parsed
    : fallbackRoot;
  const seen = new Set<string>();
  const headings: string[] = [];

  for (const heading of source.querySelectorAll('h1, h2, h3')) {
    const text = normalizeWhitespace(heading.textContent ?? '');
    if (!text || seen.has(text)) continue;
    seen.add(text);
    headings.push(text);
    if (headings.length === EXTRACTION_CONFIG.maximumHeadings) break;
  }
  return headings;
}

function extractArticleText(content: string): string {
  if (!content) return '';
  const parsed = new DOMParser().parseFromString(content, 'text/html');
  return extractVisibleText(parsed.body);
}

function structureSignals(
  content: string,
  fallbackRoot: ParentNode,
): PageStructureSignals {
  const parsed = content
    ? new DOMParser().parseFromString(content, 'text/html')
    : null;
  const source = parsed?.body.childElementCount ? parsed.body : fallbackRoot;
  const meaningful = (element: Element): boolean =>
    normalizeWhitespace(element.textContent ?? '').length >= 40;
  const links = [
    ...source.querySelectorAll<HTMLAnchorElement>('a[href]'),
  ].filter((link) => {
    const href = link.getAttribute('href')?.trim() ?? '';
    return (
      href !== '' && !href.startsWith('#') && !href.startsWith('javascript:')
    );
  });
  const citationLinkCount = links.filter((link) => {
    const href = link.href.toLowerCase();
    return (
      /(?:doi\.org|arxiv\.org|pubmed|researchgate|semanticscholar|\.pdf(?:$|[?#]))/u.test(
        href,
      ) ||
      Boolean(
        link.closest(
          'sup, [role="doc-biblioref"], .citation, .citations, .footnote, .footnotes, .reference, .references',
        ),
      )
    );
  }).length;
  return {
    paragraphCount: [...source.querySelectorAll('p')].filter(meaningful).length,
    headingCount: source.querySelectorAll('h1, h2, h3').length,
    linkCount: links.length,
    citationLinkCount,
    quoteCount: source.querySelectorAll('blockquote, q').length,
    listItemCount: [...source.querySelectorAll('li')].filter(meaningful).length,
    tableCount: source.querySelectorAll('table').length,
  };
}

function readabilityDocument(
  document: Document,
  root: HTMLElement | null,
): Document {
  if (!root) return document.cloneNode(true) as Document;
  const scoped = document.implementation.createHTMLDocument(document.title);
  scoped.documentElement.lang = document.documentElement.lang;
  for (const metadata of document.querySelectorAll(
    'meta, link[rel~="canonical"]',
  )) {
    scoped.head.append(metadata.cloneNode(true));
  }
  scoped.body.append(root.cloneNode(true));
  return scoped;
}

function captureDocumentInternal(
  document: Document,
  pageUrl: string,
  capturedAt = new Date(),
): PageCapture {
  const root = findCurrentArticleRoot(document);
  const matchedTitle = findCurrentArticleTitleElement(document);
  const documentClone = readabilityDocument(document, root);
  let article: ReturnType<Readability['parse']> = null;
  try {
    article = new Readability(documentClone, {
      charThreshold: EXTRACTION_CONFIG.readabilityCharacterThreshold,
      maxElemsToParse: EXTRACTION_CONFIG.readabilityMaximumElements,
    }).parse();
  } catch {
    // Extremely large or malformed pages still receive the semantic fallback.
  }
  const fallbackText = root
    ? extractVisibleText(root)
    : extractVisibleText(document.body);
  const readabilityText = extractArticleText(article?.content ?? '');
  const hasReadableArticle =
    readabilityText.length >=
    EXTRACTION_CONFIG.minimumReadableArticleCharacters;
  const content = hasReadableArticle ? readabilityText : fallbackText;
  const extractionMethod = hasReadableArticle
    ? 'readability'
    : root
      ? 'semantic'
      : 'visible-text';
  const title = normalizeWhitespace(
    matchedTitle?.textContent ||
      article?.title ||
      findMetaContent(document, ['og:title', 'twitter:title']) ||
      document.title,
  );
  const excerpt = normalizeWhitespace(
    article?.excerpt ||
      findMetaContent(document, [
        'description',
        'og:description',
        'twitter:description',
      ]) ||
      content.slice(0, 240),
  );
  const wordCount = countWords(content);
  const structure = structureSignals(
    hasReadableArticle ? (article?.content ?? '') : '',
    root ?? document.body,
  );

  return {
    title,
    url: pageUrl,
    content,
    excerpt,
    byline:
      normalizeWhitespace(
        article?.byline ||
          findMetaContent(document, ['author', 'article:author']) ||
          '',
      ) || null,
    siteName:
      normalizeWhitespace(
        article?.siteName ||
          findMetaContent(document, ['og:site_name', 'application-name']) ||
          siteNameFromUrl(pageUrl),
      ) || 'Unknown source',
    publishedTime:
      article?.publishedTime ||
      findMetaContent(document, [
        'article:published_time',
        'date',
        'datepublished',
      ]) ||
      root?.querySelector('time[datetime]')?.getAttribute('datetime') ||
      document.querySelector('time[datetime]')?.getAttribute('datetime') ||
      null,
    language: article?.lang || document.documentElement.lang.trim() || null,
    wordCount,
    readingTimeMinutes: calculateReadingTime(wordCount),
    headings: extractHeadings(article?.content ?? '', root ?? document),
    isArticle: Boolean(hasReadableArticle || root),
    extractionMethod,
    structure,
    capturedAt: capturedAt.toISOString(),
  };
}

export function captureDocument(
  document: Document,
  pageUrl: string,
  capturedAt = new Date(),
): PageCapture {
  return measureSync('extraction.capture-document', () =>
    captureDocumentInternal(document, pageUrl, capturedAt),
  );
}
