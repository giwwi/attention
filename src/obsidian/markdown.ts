import type { ObsidianFragment, ObsidianNoteRecord } from './types';

const MAX_FRAGMENT_LENGTH = 1_200;
const MIN_FRAGMENT_LENGTH = 70;
const MAX_TAGS = 20;
const MAX_LINKS = 30;

interface FrontmatterResult {
  body: string;
  tags: string[];
  imported: boolean;
  sourceUrl: string | null;
}

interface RawSection {
  heading: string | null;
  lines: string[];
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function unique(values: string[], limit: number): string[] {
  return [...new Set(values.map(normalizeSpaces).filter(Boolean))].slice(
    0,
    limit,
  );
}

function parseFrontmatter(markdown: string): FrontmatterResult {
  if (!markdown.startsWith('---\n') && !markdown.startsWith('---\r\n')) {
    return { body: markdown, tags: [], imported: false, sourceUrl: null };
  }
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/u);
  if (!match) {
    return { body: markdown, tags: [], imported: false, sourceUrl: null };
  }
  const frontmatter = match[1] ?? '';
  const tags: string[] = [];
  const inlineTags = frontmatter.match(/^tags:\s*\[([^\]]*)\]/imu)?.[1];
  if (inlineTags) {
    tags.push(...inlineTags.split(',').map((tag) => tag.replace(/["']/gu, '')));
  }
  const tagBlock = frontmatter.match(
    /^tags:\s*\r?\n((?:\s*-.*\r?\n?)*)/imu,
  )?.[1];
  if (tagBlock) {
    tags.push(
      ...tagBlock.split(/\r?\n/u).map((line) => line.replace(/^\s*-\s*/u, '')),
    );
  }
  const imported =
    /^(?:source|source_url|url|original_url):\s*\S+/imu.test(frontmatter) ||
    /\b(?:readwise|clipping|clippings|imported|webclip)\b/iu.test(frontmatter);
  const sourceUrl =
    frontmatter
      .match(
        /^(?:source|source_url|url|original_url):\s*["']?(https?:\/\/[^\s"']+)/imu,
      )?.[1]
      ?.trim() ?? null;
  return {
    body: markdown.slice(match[0].length),
    tags: unique(tags, MAX_TAGS),
    imported,
    sourceUrl,
  };
}

function stripMarkdown(value: string): string {
  return normalizeSpaces(
    value
      .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      .replace(
        /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu,
        (_match, target: string, alias: string | undefined) => alias ?? target,
      )
      .replace(/<https?:\/\/[^>]+>/gu, ' ')
      .replace(/`([^`]+)`/gu, '$1')
      .replace(/[*_~]+/gu, '')
      .replace(/^\s*(?:[-*+] |\d+[.)] )/gmu, '')
      .replace(/^\s*>\s?/gmu, ''),
  );
}

function noteTitle(path: string, markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/mu)?.[1];
  if (heading) return stripMarkdown(heading).slice(0, 240);
  const filename = path.split('/').at(-1) ?? path;
  return filename.replace(/\.md$/iu, '').trim().slice(0, 240);
}

function wikiLinks(markdown: string): string[] {
  return unique(
    [
      ...markdown.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/gu),
    ].map((match) => match[1] ?? ''),
    MAX_LINKS,
  );
}

function inlineTags(markdown: string): string[] {
  return unique(
    [...markdown.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]{2,80})/gu)].map(
      (match) => match[1] ?? '',
    ),
    MAX_TAGS,
  );
}

function sections(markdown: string): RawSection[] {
  const result: RawSection[] = [{ heading: null, lines: [] }];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/u)) {
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/u)?.[1];
    if (heading) {
      result.push({ heading: stripMarkdown(heading), lines: [] });
      continue;
    }
    result.at(-1)?.lines.push(line);
  }
  return result;
}

function sectionParagraphs(section: RawSection): Array<{
  raw: string;
  quote: boolean;
}> {
  const paragraphs: Array<{ raw: string; quote: boolean }> = [];
  let buffer: string[] = [];
  const flush = (): void => {
    if (buffer.length === 0) return;
    const nonEmpty = buffer.filter((line) => line.trim());
    paragraphs.push({
      raw: buffer.join('\n'),
      quote:
        nonEmpty.length > 0 && nonEmpty.every((line) => /^\s*>/u.test(line)),
    });
    buffer = [];
  };
  for (const line of section.lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return paragraphs;
}

function splitLongText(text: string): string[] {
  if (text.length <= MAX_FRAGMENT_LENGTH) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/u);
  const fragments: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > MAX_FRAGMENT_LENGTH) {
      fragments.push(current);
      current = '';
    }
    if (sentence.length > MAX_FRAGMENT_LENGTH) {
      if (current) fragments.push(current);
      current = '';
      for (
        let index = 0;
        index < sentence.length;
        index += MAX_FRAGMENT_LENGTH
      ) {
        fragments.push(sentence.slice(index, index + MAX_FRAGMENT_LENGTH));
      }
      continue;
    }
    current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) fragments.push(current);
  return fragments;
}

export function parseObsidianNote(input: {
  path: string;
  markdown: string;
  modifiedAt: number;
  size: number;
}): ObsidianNoteRecord {
  const frontmatter = parseFrontmatter(input.markdown);
  const title = noteTitle(input.path, frontmatter.body);
  const tags = unique(
    [...frontmatter.tags, ...inlineTags(frontmatter.body)],
    MAX_TAGS,
  );
  const links = wikiLinks(frontmatter.body);
  const fragments: ObsidianFragment[] = [];

  for (const section of sections(frontmatter.body)) {
    for (const paragraph of sectionParagraphs(section)) {
      const text = stripMarkdown(paragraph.raw);
      if (text.length < MIN_FRAGMENT_LENGTH) continue;
      const kind = paragraph.quote
        ? ('quote' as const)
        : frontmatter.imported
          ? ('imported' as const)
          : ('own-note' as const);
      const attentionStrength =
        kind === 'own-note' ? 0.88 : kind === 'imported' ? 0.56 : 0.5;
      for (const part of splitLongText(text)) {
        if (part.length < MIN_FRAGMENT_LENGTH) continue;
        fragments.push({
          id: `${input.path}:${fragments.length}`,
          notePath: input.path,
          noteTitle: title,
          heading: section.heading,
          text: part,
          tags,
          links,
          kind,
          attentionStrength,
          modifiedAt: input.modifiedAt,
        });
      }
    }
  }

  return {
    path: input.path,
    title,
    modifiedAt: input.modifiedAt,
    size: input.size,
    sourceUrl: frontmatter.sourceUrl,
    sourceUrlFingerprint: undefined,
    fragments,
  };
}
