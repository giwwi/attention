import { textTokens } from '../analyzer/text-match';

const MAX_INDEX_TOKENS_PER_DOCUMENT = 120;
const MAX_QUERY_CANDIDATES = 256;

export interface LocalSearchDocument {
  id: string;
  text: string;
}

/**
 * Serializable inverted index kept next to connector data. It contains only
 * token -> document id postings; the original text stays in the connector's
 * local storage and is fetched only for the small candidate set.
 */
export interface LocalSearchIndex {
  schemaVersion: 2;
  builtForVersion: string;
  documentCount: number;
  documentIds: string[];
  postings: Record<string, string[]>;
}

export function buildLocalSearchIndex(
  documents: LocalSearchDocument[],
  builtForVersion: string,
): LocalSearchIndex {
  const postings = new Map<string, string[]>();
  for (const document of documents) {
    const tokens = [...textTokens(document.text)].slice(
      0,
      MAX_INDEX_TOKENS_PER_DOCUMENT,
    );
    for (const token of tokens) {
      const ids = postings.get(token);
      if (ids) ids.push(document.id);
      else postings.set(token, [document.id]);
    }
  }
  return {
    schemaVersion: 2,
    builtForVersion,
    documentCount: documents.length,
    documentIds: documents.map((document) => document.id),
    postings: Object.fromEntries(postings),
  };
}

export function updateLocalSearchIndex(
  index: LocalSearchIndex,
  removedDocumentIds: Iterable<string>,
  upserts: LocalSearchDocument[],
  builtForVersion: string,
): LocalSearchIndex {
  const removed = new Set(removedDocumentIds);
  for (const document of upserts) removed.add(document.id);
  const postings: Record<string, string[]> = {};
  for (const [token, ids] of Object.entries(index.postings)) {
    const retained = ids.filter((id) => !removed.has(id));
    if (retained.length > 0) postings[token] = retained;
  }
  for (const document of upserts) {
    const tokens = [...textTokens(document.text)].slice(
      0,
      MAX_INDEX_TOKENS_PER_DOCUMENT,
    );
    for (const token of tokens) {
      const ids = postings[token] ?? [];
      if (!ids.includes(document.id)) ids.push(document.id);
      postings[token] = ids;
    }
  }
  const documentIds = [
    ...index.documentIds.filter((id) => !removed.has(id)),
    ...upserts.map((document) => document.id),
  ];
  return {
    schemaVersion: 2,
    builtForVersion,
    documentCount: documentIds.length,
    documentIds,
    postings,
  };
}

export function isLocalSearchIndex(
  value: unknown,
  builtForVersion?: string,
): value is LocalSearchIndex {
  if (!value || typeof value !== 'object') return false;
  const index = value as Partial<LocalSearchIndex>;
  return (
    index.schemaVersion === 2 &&
    typeof index.builtForVersion === 'string' &&
    (builtForVersion === undefined ||
      index.builtForVersion === builtForVersion) &&
    typeof index.documentCount === 'number' &&
    Array.isArray(index.documentIds) &&
    index.documentIds.every((id) => typeof id === 'string') &&
    Boolean(index.postings) &&
    typeof index.postings === 'object'
  );
}

export function searchLocalIndex(
  index: LocalSearchIndex,
  queryTokens: Set<string>,
  limit = MAX_QUERY_CANDIDATES,
): Set<string> {
  const scores = new Map<string, number>();
  for (const token of queryTokens) {
    if (!Object.hasOwn(index.postings, token)) continue;
    for (const id of index.postings[token] ?? []) {
      scores.set(id, (scores.get(id) ?? 0) + 1);
    }
  }
  return new Set(
    [...scores]
      .filter(([, overlap]) => overlap >= 2)
      .sort((left, right) => right[1] - left[1])
      .slice(0, Math.max(1, limit))
      .map(([id]) => id),
  );
}
