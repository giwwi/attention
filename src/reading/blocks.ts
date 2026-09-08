import { stableTextFingerprint } from '../analyzer/material-features';
import type { PageCapture } from '../shared/types';
import type { ArticleBlock, ArticleMap } from './types';

export const MAX_PASSAGE_CHARACTERS = 6_000;
export const MAX_ARTICLE_BLOCKS = 800;
export const MAX_ARTICLE_CHARACTERS = 240_000;
export const cleanBlockText = (text: string): string =>
  text.replace(/\s+/gu, ' ').trim();

export function createArticleMap(
  blocks: Omit<ArticleBlock, 'id'>[],
  complete = true,
): ArticleMap {
  let characters = 0;
  const accepted: ArticleBlock[] = [];
  for (const item of blocks) {
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
    accepted.push({
      ...item,
      text,
      id: `b${accepted.length}-${stableTextFingerprint(`${item.section}\n${text}`)}`,
    });
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

const DEPENDENT_START =
  /^(?:this|these|those|it|such|therefore|thus|as a result|however|but|instead|for example|это|этот|эта|эти|такой|такая|такие|поэтому|таким образом|однако|но |например|dies|daher|jedoch|cependant|donc|sin embargo|por lo tanto|tuttavia|quindi|因此|然而|但是|هذا|هذه|لذلك|لكن|इसलिए|हालाँकि)(?:\b|\s|[，,])/iu;
const CAVEAT_START =
  /^(?:however|but|yet|unless|except|only|note that|in contrast|nevertheless|this (?:only|does not|result|finding|limitation)|these (?:results|findings|limitations)|однако|но |при этом|впрочем|кроме|только|важно|следует учесть|это (?:не|верно|справедливо)|эти (?:результаты|выводы)|allerdings|jedoch|nur |cependant|pourtant|toutefois|sin embargo|solo |tuttavia|però|しかし|ただし|然而|但是|不过|但|لكن|إلا|हालाँकि|लेकिन)/iu;

/** Whole contiguous blocks, including introductions and nearby qualifications. */
export function passageWindow(
  map: ArticleMap,
  coreId: string,
  requestedIds: string[] = [],
): ArticleBlock[] {
  const core = map.blocks.findIndex((block) => block.id === coreId);
  if (core < 0) return [];
  const first = map.blocks[core]!;
  let start = core;
  let end = core;
  for (const id of requestedIds) {
    const index = map.blocks.findIndex((block) => block.id === id);
    if (
      index < 0 ||
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
    if (!previous || previous.section !== first.section) {
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
        ['paragraph', 'list', 'table', 'quote', 'code'].includes(block.kind),
    ) &&
    map.blocks.reduce((sum, block) => sum + block.text.length, 0) <=
      MAX_ARTICLE_CHARACTERS &&
    new Set(map.blocks.map((block) => block.id)).size === map.blocks.length &&
    map.fingerprint === stableTextFingerprint(JSON.stringify(map.blocks))
  );
}
