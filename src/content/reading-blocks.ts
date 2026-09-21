import { createArticleMap, isPassageQualification } from '../reading/blocks';
import type { ArticleBlock, ArticleMap } from '../reading/types';

const BLOCKS = 'p, ul, ol, li, blockquote, table, pre, dd, h2, h3, h4';
const EXCLUDED =
  'nav, aside, footer, form, button, [hidden], [aria-hidden="true"], [role="navigation"], .subscription-widget, .subscribe-widget, .subscribe-footer, [data-attention-preview], [data-attention-novel-passages]';

function isPromotion(text: string): boolean {
  if (text.length > 450) return false;
  return /(?:is a reader-supported publication|consider becoming a (?:paid )?subscriber|thanks for reading[.!].*subscribe|^subscribe (?:now|to (?:my|our|this|the) (?:newsletter|publication))|^leave a comment[.!]?$|^подпишитесь на (?:нашу|мою|эту) рассылку|^оформите подписку|^оставить комментарий[.!]?$|^abonnieren sie (?:unseren|diesen|meinen) newsletter|^jetzt abonnieren[.!]?$)/iu.test(
    text,
  );
}

function splitList(element: Element): boolean {
  // Keep ordered instructions together; resource lists and nested entries are independent.
  return (
    element.matches('ul') ||
    !!element.closest('li') ||
    Array.from(element.children).filter((item) => item.querySelector('a[href]'))
      .length >= 2
  );
}

/** A parent entry's highlight must never include the nested entries it introduces. */
export function readingBlockRanges(element: HTMLElement): Range[] {
  const doc = element.ownerDocument;
  if (!element.matches('li')) {
    const range = doc.createRange();
    range.selectNodeContents(element);
    return [range];
  }
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const ranges: Range[] = [];
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (
      parent?.closest('li') === element &&
      !parent.closest(EXCLUDED) &&
      node.textContent?.trim()
    ) {
      const range = doc.createRange();
      range.selectNodeContents(node);
      ranges.push(range);
    }
    node = walker.nextNode();
  }
  return ranges;
}

/** IDs derive from original page blocks, not the rewritten Readability clone. */
export function collectReadingBlocks(root: HTMLElement): {
  map: ArticleMap;
  elements: Map<string, HTMLElement>;
} {
  let section = '';
  const sources: HTMLElement[] = [];
  const blocks: (Omit<ArticleBlock, 'id'> & { contextIndices?: number[] })[] =
    [];
  const sourceIndices = new Map<Element, number>();
  const qualifications = new Map<number, Element[]>();
  const intactLists = Array.from(root.querySelectorAll('ol')).filter(
    (list) => !splitList(list),
  );
  for (const element of root.querySelectorAll<HTMLElement>(BLOCKS)) {
    if (element.closest(EXCLUDED)) continue;
    const container = element.parentElement?.closest(
      'p, blockquote, table, pre, dd',
    );
    if (container && container !== root) continue;
    const outerList = element.parentElement?.closest('ul,ol');
    if (outerList && !splitList(outerList)) continue;
    if (intactLists.some((list) => list !== element && list.contains(element)))
      continue;
    if (element.matches('ul,ol') && splitList(element)) continue;
    if (!element.matches('li') && element.parentElement?.closest('li,ul,ol'))
      continue;
    if (element.matches('h2,h3,h4')) {
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
      : element.matches('li')
        ? readingBlockRanges(element)
            .map((range) => range.toString())
            .join(' ')
        : element.matches('ul,ol')
          ? Array.from(element.children)
              .map((child) => child.textContent?.trim() ?? '')
              .join(' • ')
          : (element.textContent ?? '');
    const text = sourceText.replace(/\s+/gu, ' ').trim();
    if (text.length < 10 || isPromotion(text)) continue;
    const kind = element.matches('li')
      ? 'list-item'
      : element.matches('ul,ol')
        ? 'list'
        : element.matches('table')
          ? 'table'
          : element.matches('blockquote')
            ? 'quote'
            : element.matches('pre')
              ? 'code'
              : 'paragraph';
    const contextIndices: number[] = [];
    if (kind === 'list-item') {
      const parent = element.parentElement?.closest('li');
      const parentIndex = parent ? sourceIndices.get(parent) : undefined;
      if (parentIndex !== undefined) {
        contextIndices.push(
          ...(blocks[parentIndex]!.contextIndices ?? []),
          parentIndex,
        );
      } else {
        const intro = element.parentElement?.previousElementSibling;
        const introIndex = intro ? sourceIndices.get(intro) : undefined;
        if (
          introIndex !== undefined &&
          blocks[introIndex]!.section === section &&
          blocks[introIndex]!.kind === 'paragraph' &&
          blocks[introIndex]!.text.length <= 600
        ) {
          contextIndices.push(introIndex);
        }
      }
      const following: Element[] = [];
      let list = element.parentElement;
      while (list?.matches('ul,ol')) {
        let sibling = list.nextElementSibling;
        while (
          sibling?.matches('p') &&
          isPassageQualification(sibling.textContent?.trim() ?? '')
        ) {
          following.push(sibling);
          sibling = sibling.nextElementSibling;
        }
        list = list.parentElement?.closest('li')?.parentElement ?? null;
      }
      qualifications.set(blocks.length, following);
    }
    sourceIndices.set(element, blocks.length);
    blocks.push({
      text,
      section,
      kind,
      ...(contextIndices.length ? { contextIndices } : {}),
    });
    sources.push(element);
  }
  for (const [index, following] of qualifications) {
    const ids = following.flatMap((element) => {
      const target = sourceIndices.get(element);
      return target !== undefined &&
        blocks[target]!.section === blocks[index]!.section
        ? [target]
        : [];
    });
    if (ids.length)
      blocks[index]!.contextIndices = [
        ...(blocks[index]!.contextIndices ?? []),
        ...ids,
      ];
  }
  const map = createArticleMap(blocks);
  return {
    map,
    elements: new Map(
      map.blocks.map((block, index) => [block.id, sources[index]!]),
    ),
  };
}
