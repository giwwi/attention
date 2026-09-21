import { stableTextFingerprint } from '../analyzer/material-features';
import type { PageCapture } from '../shared/types';
import type { ArticleBlock, ArticleMap } from './types';

export const MAX_PASSAGE_CHARACTERS = 6_000;
export const MAX_PASSAGE_BLOCKS = 7;
export const MAX_ARTICLE_BLOCKS = 800;
export const MAX_ARTICLE_CHARACTERS = 240_000;
export const cleanBlockText = (text: string): string =>
  text.replace(/\s+/gu, ' ').trim();

export function createArticleMap(
  blocks: (Omit<ArticleBlock, 'id'> & { contextIndices?: number[] })[],
  complete = true,
): ArticleMap {
  let characters = 0;
  const accepted: ArticleBlock[] = [];
  const indices = new Map<number, number>();
  for (const [index, item] of blocks.entries()) {
    const text = cleanBlockText(item.text);
    if (!text) continue;
    characters += text.length;
    if (
      accepted.length >= MAX_ARTICLE_BLOCKS ||
      characters > MAX_ARTICLE_CHARACTERS
    ) {
      complete = false;
      break;
    }
    const { contextIndices, ...block } = item;
    // Resolve structural references after all retained blocks have IDs.
    void contextIndices;
    indices.set(index, accepted.length);
    accepted.push({
      ...block,
      text,
      id: `b${accepted.length}-${stableTextFingerprint(`${item.section}\n${text}`)}`,
    });
  }
  for (const [source, target] of indices) {
    const context = blocks[source]!.contextIndices;
    if (context?.length) {
      if (context.some((index) => !indices.has(index))) complete = false;
      accepted[target]!.contextBlockIds = [...new Set(context)]
        .sort((a, b) => a - b)
        .flatMap((index) =>
          indices.has(index) ? [accepted[indices.get(index)!]!.id] : [],
        );
    }
  }
  return {
    version: 1,
    complete,
    blocks: accepted,
    fingerprint: stableTextFingerprint(JSON.stringify(accepted)),
  };
}

export function articleMap(material: PageCapture): ArticleMap {
  if (material.readingMap) return material.readingMap;
  // Old saved articles have text only. Keep full paragraphs; never invent DOM anchors.
  return createArticleMap(
    material.content
      .split(/\n+/u)
      .filter(Boolean)
      .map((text) => ({
        text,
        section: '',
        kind: 'paragraph' as const,
      })),
  );
}

/** Shared list introductions supply context; individual entries are the reading choices. */
export function isListIntroduction(
  map: ArticleMap,
  block: ArticleBlock,
): boolean {
  return (
    block.kind === 'paragraph' &&
    map.blocks.some((item) => item.contextBlockIds?.includes(block.id))
  );
}

const DEPENDENT_START =
  /^(?:this|these|those|it|such|therefore|thus|as a result|however|but|instead|for example|это|этот|эта|эти|такой|такая|такие|поэтому|таким образом|однако|но |например|dies(?:e|er|es|en|em)?|daher|deshalb|dadurch|damit|dabei|jedoch|zum beispiel|das bedeutet|cependant|donc|sin embargo|por lo tanto|tuttavia|quindi|因此|然而|但是|هذا|هذه|لذلك|لكن|इसलिए|हालाँकि)(?:\b|\s|[，,])/iu;
const CAVEAT_START =
  /^(?:however|but|yet|unless|except|only|note that|in contrast|nevertheless|this (?:only|does not|result|finding|limitation)|these (?:results|findings|limitations)|однако|но |при этом|впрочем|кроме|только|важно|следует учесть|это (?:не|верно|справедливо)|эти (?:результаты|выводы)|allerdings|jedoch|nur |aber |dennoch|sofern|es sei denn|im gegensatz|diese? (?:ergebnisse|einschränkung)|dies gilt|zu beachten|cependant|pourtant|toutefois|sin embargo|solo |tuttavia|però|しかし|ただし|然而|但是|不过|但|لكن|إلا|हालाँकि|लेकिन)/iu;

/** A resource entry can share its introduction without absorbing its siblings. */
function listItemWindow(map: ArticleMap, core: ArticleBlock): ArticleBlock[] {
  const ids = [...(core.contextBlockIds ?? []), core.id];
  const blocks = map.blocks.filter((block) => ids.includes(block.id));
  if (
    blocks.length !== ids.length ||
    blocks.length > MAX_PASSAGE_BLOCKS ||
    blocks.some((block) => block.section !== core.section) ||
    DEPENDENT_START.test(blocks[0]!.text) ||
    blocks.map((block) => block.text).join('\n\n').length >
      MAX_PASSAGE_CHARACTERS
  )
    return [];
  return blocks;
}

export function isPassageQualification(text: string): boolean {
  return CAVEAT_START.test(text);
}

/** Whole blocks, including introductions and nearby qualifications. */
export function passageWindow(
  map: ArticleMap,
  coreId: string,
  requestedIds: string[] = [],
): ArticleBlock[] {
  const core = map.blocks.findIndex((block) => block.id === coreId);
  if (core < 0) return [];
  const first = map.blocks[core]!;
  if (first.kind === 'list-item') {
    const blocks = listItemWindow(map, first);
    return requestedIds.every((id) => blocks.some((block) => block.id === id))
      ? blocks
      : [];
  }
  let start = core;
  let end = core;
  for (const id of requestedIds) {
    const index = map.blocks.findIndex((block) => block.id === id);
    if (
      index < 0 ||
      map.blocks[index]!.kind === 'list-item' ||
      Math.abs(index - core) > 3 ||
      map.blocks[index]!.section !== first.section
    )
      return [];
    start = Math.min(start, index);
    end = Math.max(end, index);
  }
  // At most two preceding blocks: unresolved references are safer to omit.
  for (let step = 0; step < 2; step++) {
    const current = map.blocks[start]!;
    const previous = map.blocks[start - 1];
    const needsIntroduction =
      current.kind === 'list' ||
      current.kind === 'table' ||
      current.kind === 'code' ||
      DEPENDENT_START.test(current.text);
    if (!needsIntroduction) break;
    if (
      !previous ||
      previous.kind === 'list-item' ||
      previous.section !== first.section
    ) {
      if (DEPENDENT_START.test(current.text)) return [];
      break;
    }
    start--;
  }
  if (DEPENDENT_START.test(map.blocks[start]!.text)) return [];
  while (end + 1 < map.blocks.length) {
    const next = map.blocks[end + 1]!;
    const introducedBlock =
      ['list', 'table', 'code'].includes(next.kind) &&
      /[:：]$/u.test(map.blocks[end]!.text);
    if (
      next.section !== first.section ||
      next.kind === 'list-item' ||
      (!CAVEAT_START.test(next.text) && !introducedBlock)
    )
      break;
    end++;
    if (end - start > 6) return [];
  }
  const blocks = map.blocks.slice(start, end + 1);
  if (blocks.some((block) => block.section !== first.section)) return [];
  return blocks.map((block) => block.text).join('\n\n').length <=
    MAX_PASSAGE_CHARACTERS
    ? blocks
    : [];
}

/** Validate a frozen window without expanding it a second time. */
export function exactPassageWindow(
  map: ArticleMap,
  coreId: string,
  ids: string[],
): ArticleBlock[] {
  if (!ids.length || ids.length > MAX_PASSAGE_BLOCKS || !ids.includes(coreId))
    return [];
  const core = map.blocks.find((block) => block.id === coreId);
  if (core?.kind === 'list-item') {
    const blocks = listItemWindow(map, core);
    return blocks.length === ids.length &&
      blocks.every((block, index) => block.id === ids[index])
      ? blocks
      : [];
  }
  const start = map.blocks.findIndex((block) => block.id === ids[0]);
  if (start < 0) return [];
  const blocks = map.blocks.slice(start, start + ids.length);
  if (
    blocks.length !== ids.length ||
    blocks.some(
      (block, index) =>
        block.id !== ids[index] ||
        block.kind === 'list-item' ||
        block.section !== blocks[0]!.section,
    )
  )
    return [];
  if (DEPENDENT_START.test(blocks[0]!.text)) return [];
  const next = map.blocks[start + ids.length];
  const last = blocks.at(-1)!;
  if (
    next?.section === last.section &&
    next.kind !== 'list-item' &&
    (CAVEAT_START.test(next.text) ||
      (['list', 'table', 'code'].includes(next.kind) &&
        /[:：]$/u.test(last.text)))
  )
    return [];
  return blocks.map((block) => block.text).join('\n\n').length <=
    MAX_PASSAGE_CHARACTERS
    ? blocks
    : [];
}

export function isArticleMap(value: unknown): value is ArticleMap {
  if (!value || typeof value !== 'object') return false;
  const map = value as ArticleMap;
  return (
    map.version === 1 &&
    typeof map.complete === 'boolean' &&
    typeof map.fingerprint === 'string' &&
    Array.isArray(map.blocks) &&
    map.blocks.length <= MAX_ARTICLE_BLOCKS &&
    map.blocks.every(
      (block) =>
        block &&
        typeof block.id === 'string' &&
        typeof block.section === 'string' &&
        typeof block.text === 'string' &&
        ['paragraph', 'list', 'list-item', 'table', 'quote', 'code'].includes(
          block.kind,
        ) &&
        (block.contextBlockIds === undefined ||
          (block.kind === 'list-item' &&
            Array.isArray(block.contextBlockIds) &&
            block.contextBlockIds.length < MAX_PASSAGE_BLOCKS &&
            new Set(block.contextBlockIds).size ===
              block.contextBlockIds.length &&
            block.contextBlockIds.every(
              (id) =>
                typeof id === 'string' &&
                id !== block.id &&
                map.blocks.some(
                  (parent) =>
                    parent.id === id && parent.section === block.section,
                ),
            ))),
    ) &&
    map.blocks.reduce((sum, block) => sum + block.text.length, 0) <=
      MAX_ARTICLE_CHARACTERS &&
    new Set(map.blocks.map((block) => block.id)).size === map.blocks.length &&
    map.fingerprint === stableTextFingerprint(JSON.stringify(map.blocks))
  );
}
