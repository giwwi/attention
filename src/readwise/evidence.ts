import {
  canonicalizeHistoryPage,
  fingerprintHistoryUrl,
} from '../history/evidence';
import {
  buildLocalSearchIndex,
  isLocalSearchIndex,
  type LocalSearchIndex,
} from '../evidence/local-search-index';

export const READWISE_EVIDENCE_KEY = 'readwiseEvidence';
export const READWISE_SETTINGS_KEY = 'readwiseSettings';
export const READWISE_TOKEN_KEY = 'readwiseToken';

const MAX_SOURCES = 1_000;
const MAX_HIGHLIGHTS = 2_000;
const MAX_HIGHLIGHT_LENGTH = 700;
const MAX_NOTE_LENGTH = 360;
const MAX_TAGS = 12;

export interface ReadwiseSourceEvidence {
  id: string;
  title: string;
  author: string | null;
  category: string | null;
  hostname: string | null;
  urlFingerprint: string | null;
  tags: string[];
  highlightCount: number;
  noteCount: number;
  lastHighlightedAt: string | null;
}

export interface ReadwiseHighlightEvidence {
  id: string;
  sourceId: string;
  sourceTitle: string;
  text: string;
  note: string | null;
  tags: string[];
  attentionStrength: number;
  highlightedAt: string | null;
}

export interface ReadwiseEvidence {
  schemaVersion: 1;
  generatedAt: string;
  sourceCount: number;
  highlightCount: number;
  noteCount: number;
  excludedSourceCount: number;
  sources: ReadwiseSourceEvidence[];
  highlights: ReadwiseHighlightEvidence[];
  searchIndex: LocalSearchIndex;
}

export interface ReadwiseSettings {
  connected: boolean;
  lastSyncedAt: string | null;
  /** Revision of evidence content; unlike lastSyncedAt it changes only on data changes. */
  evidenceUpdatedAt?: string | null;
  sourceCount: number;
  highlightCount: number;
  noteCount: number;
  excludedSourceCount: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/gu, ' ').trim().slice(0, maxLength)
    : '';
}

function optionalText(value: unknown, maxLength: number): string | null {
  const text = boundedText(value, maxLength);
  return text || null;
}

function identifier(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') {
    const normalized = String(value).trim().slice(0, 120);
    return normalized || null;
  }
  return null;
}

function safeIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function tagNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = value
    .map((item) => {
      if (typeof item === 'string') return boundedText(item, 80);
      return boundedText(record(item)?.name, 80);
    })
    .filter(Boolean);
  return [...new Set(names)].slice(0, MAX_TAGS);
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1;
}

function sourceUrl(item: Record<string, unknown>): string {
  return (
    boundedText(item.source_url, 2_048) || boundedText(item.unique_url, 2_048)
  );
}

function latestDate(values: Array<string | null>): string | null {
  return (
    values
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
  );
}

function readwiseSearchIndex(
  highlights: ReadwiseHighlightEvidence[],
  generatedAt: string,
): LocalSearchIndex {
  return buildLocalSearchIndex(
    highlights.map((highlight) => ({
      id: highlight.id,
      text: [
        highlight.sourceTitle,
        highlight.text,
        highlight.note ?? '',
        ...highlight.tags,
      ].join(' '),
    })),
    generatedAt,
  );
}

function finalizeReadwiseEvidence(
  sources: ReadwiseSourceEvidence[],
  highlights: ReadwiseHighlightEvidence[],
  excludedSourceCount: number,
  generatedAt: string,
): ReadwiseEvidence {
  highlights.sort((left, right) =>
    (right.highlightedAt ?? '').localeCompare(left.highlightedAt ?? ''),
  );
  sources.sort((left, right) =>
    (right.lastHighlightedAt ?? '').localeCompare(left.lastHighlightedAt ?? ''),
  );
  const retainedHighlights = highlights.slice(0, MAX_HIGHLIGHTS);
  const retainedIds = new Set(
    retainedHighlights.map((highlight) => highlight.sourceId),
  );
  const retainedSources = sources
    .filter(
      (source) => retainedIds.has(source.id) || source.highlightCount === 0,
    )
    .slice(0, MAX_SOURCES);
  return {
    schemaVersion: 1,
    generatedAt,
    sourceCount: retainedSources.length,
    highlightCount: retainedHighlights.length,
    noteCount: retainedHighlights.filter((highlight) => highlight.note).length,
    excludedSourceCount,
    sources: retainedSources,
    highlights: retainedHighlights,
    searchIndex: readwiseSearchIndex(retainedHighlights, generatedAt),
  };
}

export function ensureReadwiseSearchIndex(
  evidence: Omit<ReadwiseEvidence, 'searchIndex'> & {
    searchIndex?: LocalSearchIndex;
  },
): ReadwiseEvidence {
  if (isLocalSearchIndex(evidence.searchIndex, evidence.generatedAt)) {
    return evidence as ReadwiseEvidence;
  }
  return {
    ...evidence,
    searchIndex: readwiseSearchIndex(evidence.highlights, evidence.generatedAt),
  };
}

export async function buildReadwiseEvidence(
  rawSources: unknown[],
  now = new Date(),
): Promise<ReadwiseEvidence> {
  const sources: ReadwiseSourceEvidence[] = [];
  const highlights: ReadwiseHighlightEvidence[] = [];
  let excludedSourceCount = 0;

  for (const rawSource of rawSources) {
    const item = record(rawSource);
    const sourceId = identifier(item?.user_book_id);
    if (!item || !sourceId || booleanValue(item.is_deleted)) continue;

    const title = boundedText(item.title ?? item.readable_title, 300);
    if (!title) continue;
    const rawUrl = sourceUrl(item);
    const canonical = rawUrl ? canonicalizeHistoryPage(rawUrl, title) : null;
    if (rawUrl && !canonical) excludedSourceCount += 1;
    const urlFingerprint = canonical
      ? await fingerprintHistoryUrl(canonical.canonicalUrl)
      : null;
    const rawHighlights = Array.isArray(item.highlights) ? item.highlights : [];
    const sourceHighlights: ReadwiseHighlightEvidence[] = [];
    const dates: Array<string | null> = [];

    for (const rawHighlight of rawHighlights) {
      const highlight = record(rawHighlight);
      const highlightId = identifier(highlight?.id);
      const text = boundedText(highlight?.text, MAX_HIGHLIGHT_LENGTH);
      if (
        !highlight ||
        !highlightId ||
        !text ||
        booleanValue(highlight.is_deleted) ||
        booleanValue(highlight.is_discard)
      ) {
        continue;
      }
      const note = optionalText(highlight.note, MAX_NOTE_LENGTH);
      const highlightedAt =
        safeIsoDate(highlight.highlighted_at) ??
        safeIsoDate(highlight.updated_at) ??
        safeIsoDate(highlight.created_at);
      dates.push(highlightedAt);
      sourceHighlights.push({
        id: highlightId,
        sourceId,
        sourceTitle: title,
        text,
        note,
        tags: tagNames(highlight.tags),
        attentionStrength: note
          ? 0.9
          : booleanValue(highlight.is_favorite)
            ? 0.82
            : 0.72,
        highlightedAt,
      });
    }

    sourceHighlights.sort((left, right) =>
      (right.highlightedAt ?? '').localeCompare(left.highlightedAt ?? ''),
    );
    highlights.push(...sourceHighlights);
    sources.push({
      id: sourceId,
      title,
      author: optionalText(item.author, 180),
      category: optionalText(item.category, 80),
      hostname: canonical?.hostname ?? null,
      urlFingerprint,
      tags: tagNames(item.book_tags),
      highlightCount: sourceHighlights.length,
      noteCount: sourceHighlights.filter((highlight) => highlight.note).length,
      lastHighlightedAt: latestDate(dates),
    });
  }

  const generatedAt = now.toISOString();
  return finalizeReadwiseEvidence(
    sources,
    highlights,
    excludedSourceCount,
    generatedAt,
  );
}

function changedSourceIds(rawSources: unknown[]): Set<string> {
  return new Set(
    rawSources
      .map((source) => identifier(record(source)?.user_book_id))
      .filter((id): id is string => Boolean(id)),
  );
}

export async function mergeReadwiseEvidence(
  previous: ReadwiseEvidence,
  rawChangedSources: unknown[],
  now = new Date(),
): Promise<ReadwiseEvidence> {
  const touched = changedSourceIds(rawChangedSources);
  if (touched.size === 0) return previous;
  const changed = await buildReadwiseEvidence(rawChangedSources, now);
  const mergedSources = [
    ...previous.sources.filter((source) => !touched.has(source.id)),
    ...changed.sources,
  ];
  const mergedHighlights = [
    ...previous.highlights.filter(
      (highlight) => !touched.has(highlight.sourceId),
    ),
    ...changed.highlights,
  ];
  const candidate = finalizeReadwiseEvidence(
    mergedSources,
    mergedHighlights,
    Math.max(previous.excludedSourceCount, changed.excludedSourceCount),
    now.toISOString(),
  );
  const unchanged =
    JSON.stringify(candidate.sources) === JSON.stringify(previous.sources) &&
    JSON.stringify(candidate.highlights) ===
      JSON.stringify(previous.highlights) &&
    candidate.excludedSourceCount === previous.excludedSourceCount;
  return unchanged ? previous : candidate;
}

export function isReadwiseEvidence(value: unknown): value is ReadwiseEvidence {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ReadwiseEvidence>;
  return (
    item.schemaVersion === 1 &&
    typeof item.generatedAt === 'string' &&
    typeof item.sourceCount === 'number' &&
    typeof item.highlightCount === 'number' &&
    typeof item.noteCount === 'number' &&
    Array.isArray(item.sources) &&
    Array.isArray(item.highlights) &&
    (item.searchIndex === undefined ||
      isLocalSearchIndex(item.searchIndex, item.generatedAt))
  );
}
