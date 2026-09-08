import { createArticleMap } from '../reading/blocks';
import type { ArticleBlock, ArticleMap } from '../reading/types';

const BLOCKS = 'p, ul, ol, blockquote, table, pre, dd, h2, h3, h4';
const EXCLUDED =
  'nav, aside, footer, form, [hidden], [aria-hidden="true"], [role="navigation"], [data-attention-preview], [data-attention-novel-passages]';

/** IDs derive from original page blocks, not the rewritten Readability clone. */
export function collectReadingBlocks(root: HTMLElement): {
  map: ArticleMap;
  elements: Map<string, HTMLElement>;
} {
  let section = '';
  const sources: HTMLElement[] = [];
  const blocks: Omit<ArticleBlock, 'id'>[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(BLOCKS)) {
    if (element.closest(EXCLUDED)) continue;
    if (
      element.parentElement?.closest('p, ul, ol, blockquote, table, pre, dd') &&
      element.parentElement.closest('p, ul, ol, blockquote, table, pre, dd') !==
        root
    )
      continue;
    if (element.matches('h2, h3, h4')) {
      section = `${blocks.length}:${element.textContent?.trim() ?? ''}`;
      continue;
    }
    const sourceText = element.matches('table')
      ? Array.from((element as HTMLTableElement).rows)
          .map((row) =>
            Array.from(row.cells)
              .map((cell) => cell.textContent?.trim() ?? '')
              .join(' | '),
          )
          .join(' • ')
      : element.matches('ul,ol')
        ? Array.from(element.children)
            .map((child) => child.textContent?.trim() ?? '')
            .join(' • ')
        : (element.textContent ?? '');
    const text = sourceText.replace(/\s+/gu, ' ').trim();
    if (text.length < 10) continue;
    const kind = element.matches('ul,ol')
      ? 'list'
      : element.matches('table')
        ? 'table'
        : element.matches('blockquote')
          ? 'quote'
          : element.matches('pre')
            ? 'code'
            : 'paragraph';
    blocks.push({ text, section, kind });
    sources.push(element);
  }
  const map = createArticleMap(blocks);
  return {
    map,
    elements: new Map(
      map.blocks.map((block, index) => [block.id, sources[index]!]),
    ),
  };
}
