const TITLE_SELECTOR = [
  'h1',
  '[role="heading"][aria-level="1"]',
  '[itemprop="headline"]',
  '.article-title',
  '.post-title',
  '.entry-title',
  '[class*="article-title" i]',
  '[class*="post-title" i]',
  '[class*="entry-title" i]',
  'a[href]',
].join(', ');

const TITLE_SEPARATORS = [' | ', ' - ', ' · ', ' — ', ': '] as const;

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizedTitle(value: string | null | undefined): string {
  return normalizedText(value).toLowerCase();
}

function documentTitleAliases(
  document: Document,
  extractedTitle?: string,
): string[] {
  return Array.from(
    new Set(
      [
        extractedTitle,
        document.title,
        document.querySelector<HTMLMetaElement>('meta[property="og:title"]')
          ?.content,
        document.querySelector<HTMLMetaElement>('meta[name="twitter:title"]')
          ?.content,
      ]
        .map(normalizedTitle)
        .filter(Boolean),
    ),
  );
}

function titleMatchScore(candidate: string, aliases: string[]): number {
  if (!candidate || candidate.length < 6 || candidate.length > 240) return 0;
  let best = 0;
  for (const alias of aliases) {
    if (alias === candidate) {
      best = Math.max(best, 5_000);
      continue;
    }
    if (
      candidate.length >= 12 &&
      TITLE_SEPARATORS.some(
        (separator) =>
          alias.startsWith(`${candidate}${separator}`) ||
          candidate.startsWith(`${alias}${separator}`),
      )
    ) {
      best = Math.max(best, 4_500);
    }
  }
  return best;
}

function substantialTextLength(element: Element): number {
  return normalizedText(element.textContent).length;
}

function articleRootForTitle(element: HTMLElement): HTMLElement | null {
  return (
    element.closest<HTMLElement>('article, [role="article"]') ??
    element.closest<HTMLElement>(
      '[data-testid*="post-body" i], [data-testid="post"], [class*="post-viewer" i]',
    )
  );
}

interface ArticleTitleCandidate {
  element: HTMLElement;
  root: HTMLElement;
  score: number;
}

function isChromeTranslatedDocument(document: Document): boolean {
  return (
    document.documentElement.classList.contains('translated-ltr') ||
    document.documentElement.classList.contains('translated-rtl')
  );
}

function appearsBeforeFirstParagraph(
  element: HTMLElement,
  root: HTMLElement,
): boolean {
  const firstParagraph = root.querySelector('p');
  return (
    !firstParagraph ||
    Boolean(
      element.compareDocumentPosition(firstParagraph) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  );
}

/**
 * Chrome Translate rewrites visible text but leaves og:title/twitter:title in
 * the source language. Substack's authenticated reader can additionally keep
 * a stale document.title while rendering the translated post title as a link.
 * In that specific state, recover the lead title structurally from the most
 * substantial article instead of weakening normal title matching.
 */
function translatedArticleCandidates(
  document: Document,
): ArticleTitleCandidate[] {
  if (!isChromeTranslatedDocument(document)) return [];

  return Array.from(
    document.querySelectorAll<HTMLElement>('article, [role="article"]'),
  )
    .flatMap((root) => {
      const textLength = substantialTextLength(root);
      const paragraphCount = root.querySelectorAll('p').length;
      if (textLength < 200 || paragraphCount === 0) return [];

      return Array.from(root.querySelectorAll<HTMLElement>(TITLE_SELECTOR))
        .filter((element) => {
          const text = normalizedText(element.textContent);
          return (
            text.length >= 12 &&
            text.length <= 240 &&
            appearsBeforeFirstParagraph(element, root) &&
            !element.closest('nav, aside, footer, [role="navigation"]')
          );
        })
        .map((element): ArticleTitleCandidate => {
          const text = normalizedText(element.textContent);
          const href = element.closest<HTMLAnchorElement>('a[href]')?.href;
          const semanticBonus = element.matches(
            'h1, [role="heading"][aria-level="1"], [itemprop="headline"]',
          )
            ? 2_000
            : 0;
          const articleLinkBonus = href && /\/p\//i.test(href) ? 1_500 : 0;
          const titleStyleBonus =
            /(?:title|headline|font-display|weight-bold|size-\d+)/i.test(
              element.className,
            )
              ? 500
              : 0;
          return {
            element,
            root,
            score:
              semanticBonus +
              articleLinkBonus +
              titleStyleBonus +
              Math.min(500, text.length * 2) +
              Math.min(5_000, textLength) +
              Math.min(2_000, paragraphCount * 50),
          };
        });
    })
    .sort((left, right) => right.score - left.score);
}

function currentArticleCandidates(
  document: Document,
  extractedTitle?: string,
): ArticleTitleCandidate[] {
  const aliases = documentTitleAliases(document, extractedTitle);
  if (aliases.length === 0) return [];
  return Array.from(document.querySelectorAll<HTMLElement>(TITLE_SELECTOR))
    .map((element): ArticleTitleCandidate | null => {
      const matchScore = titleMatchScore(
        normalizedTitle(element.textContent),
        aliases,
      );
      if (matchScore === 0) return null;
      const root = articleRootForTitle(element);
      if (!root) return null;
      const textLength = substantialTextLength(root);
      const paragraphCount = root.querySelectorAll('p').length;
      const semanticBonus = element.matches(
        'h1, [role="heading"][aria-level="1"], [itemprop="headline"]',
      )
        ? 400
        : 0;
      return {
        element,
        root,
        score:
          matchScore +
          semanticBonus +
          Math.min(3_000, textLength) +
          Math.min(1_500, paragraphCount * 50),
      };
    })
    .filter(
      (candidate): candidate is ArticleTitleCandidate => candidate !== null,
    )
    .sort((left, right) => right.score - left.score);
}

/**
 * Selects the currently open article when an SPA keeps its feed mounted under
 * a modal reader. Matching the document title prevents the first background
 * feed card from becoming the captured material; content size disambiguates
 * duplicate title links that exist in both the feed and the reader.
 */
export function findCurrentArticleRoot(
  document: Document,
  extractedTitle?: string,
): HTMLElement | null {
  const translated = translatedArticleCandidates(document)[0];
  if (translated) return translated.root;
  return (
    currentArticleCandidates(document, extractedTitle)[0]?.root ??
    document.querySelector<HTMLElement>('article, main')
  );
}

export function findCurrentArticleTitleElement(
  document: Document,
  extractedTitle?: string,
): HTMLElement | null {
  // Translation can leave a stale SPA document.title that still matches a
  // background feed card. Prefer the structural translated candidate before
  // consulting source-language metadata in this one well-defined state.
  const translatedTitle = translatedArticleCandidates(document)[0]?.element;
  if (translatedTitle) return translatedTitle;

  const matched = currentArticleCandidates(document, extractedTitle)[0]
    ?.element;
  if (matched) return matched;

  // Some reader shells keep the article body in <article> but render its h1
  // in a detached post header. This fallback is deliberately limited to an
  // explicit article-header region so an arbitrary feed heading cannot win.
  const detachedHeader = document.querySelector<HTMLElement>(
    '[data-testid*="post-header" i] h1, [class*="post-header" i] h1, [class*="article-header" i] h1',
  );
  const text = normalizedText(detachedHeader?.textContent);
  return text.length >= 6 && text.length <= 240 ? detachedHeader : null;
}
