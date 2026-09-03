import {
  buildReadwiseEvidence,
  mergeReadwiseEvidence,
  type ReadwiseEvidence,
} from './evidence';

const AUTH_URL = 'https://readwise.io/api/v2/auth/';
const EXPORT_URL = 'https://readwise.io/api/v2/export/';
const HIGHLIGHTS_URL = 'https://readwise.io/api/v2/highlights/';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_EXPORT_PAGES = 200;

export type ReadwiseErrorCode =
  | 'invalid_token'
  | 'rate_limited'
  | 'network_error'
  | 'invalid_response'
  | 'too_many_pages';

export class ReadwiseClientError extends Error {
  constructor(
    readonly code: ReadwiseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReadwiseClientError';
  }
}

export function normalizeReadwiseToken(value: string): string {
  const token = value.trim();
  if (token.length < 10 || token.length > 512 || /\s/u.test(token)) {
    throw new ReadwiseClientError(
      'invalid_token',
      'Проверьте Readwise access token.',
    );
  }
  return token;
}

async function readwiseFetch(
  url: string,
  token: string,
  fetchImpl: typeof fetch,
  init: Pick<RequestInit, 'method' | 'body' | 'headers'> = { method: 'GET' },
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    headers.Authorization = `Token ${token}`;
    return await fetchImpl(url, {
      ...init,
      method: init.method ?? 'GET',
      headers,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    throw new ReadwiseClientError(
      'network_error',
      'Не удалось связаться с Readwise.',
    );
  } finally {
    clearTimeout(timeout);
  }
}

function responseError(response: Response): ReadwiseClientError {
  if (response.status === 401 || response.status === 403) {
    return new ReadwiseClientError(
      'invalid_token',
      'Readwise отклонил access token.',
    );
  }
  if (response.status === 429) {
    return new ReadwiseClientError(
      'rate_limited',
      'Readwise временно ограничил синхронизацию. Попробуйте позже.',
    );
  }
  return new ReadwiseClientError(
    'network_error',
    `Readwise API вернул статус ${response.status}.`,
  );
}

export async function validateReadwiseToken(
  rawToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const token = normalizeReadwiseToken(rawToken);
  const response = await readwiseFetch(AUTH_URL, token, fetchImpl);
  if (!response.ok) throw responseError(response);
  return token;
}

interface ExportPage {
  results: unknown[];
  nextPageCursor: string | null;
}

function parseExportPage(value: unknown): ExportPage {
  if (!value || typeof value !== 'object') {
    throw new ReadwiseClientError(
      'invalid_response',
      'Readwise вернул неподдерживаемый ответ.',
    );
  }
  const item = value as Record<string, unknown>;
  if (!Array.isArray(item.results)) {
    throw new ReadwiseClientError(
      'invalid_response',
      'Readwise вернул неподдерживаемый ответ.',
    );
  }
  return {
    results: item.results,
    nextPageCursor:
      typeof item.nextPageCursor === 'string' && item.nextPageCursor
        ? item.nextPageCursor
        : null,
  };
}

export async function fetchReadwiseExport(
  rawToken: string,
  fetchImpl: typeof fetch = fetch,
  updatedAfter?: string | null,
): Promise<unknown[]> {
  const token = normalizeReadwiseToken(rawToken);
  const results: unknown[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_EXPORT_PAGES; page += 1) {
    const url = new URL(EXPORT_URL);
    if (cursor) url.searchParams.set('pageCursor', cursor);
    if (updatedAfter) url.searchParams.set('updatedAfter', updatedAfter);
    const response = await readwiseFetch(url.toString(), token, fetchImpl);
    if (!response.ok) throw responseError(response);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ReadwiseClientError(
        'invalid_response',
        'Readwise вернул неподдерживаемый ответ.',
      );
    }
    const parsed = parseExportPage(body);
    results.push(...parsed.results);
    cursor = parsed.nextPageCursor;
    if (!cursor) return results;
  }
  throw new ReadwiseClientError(
    'too_many_pages',
    'Библиотека слишком велика для одной синхронизации.',
  );
}

export async function syncReadwiseLibrary(
  rawToken: string,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
  previousEvidence: ReadwiseEvidence | null = null,
  updatedAfter: string | null = null,
): Promise<{ token: string; evidence: ReadwiseEvidence }> {
  const token = await validateReadwiseToken(rawToken, fetchImpl);
  const sources = await fetchReadwiseExport(token, fetchImpl, updatedAfter);
  return {
    token,
    evidence:
      previousEvidence && updatedAfter
        ? await mergeReadwiseEvidence(previousEvidence, sources, now)
        : await buildReadwiseEvidence(sources, now),
  };
}

export interface ReadwiseHighlightInput {
  text: string;
  title: string;
  author: string | null;
  sourceUrl: string;
  highlightedAt?: string;
}

function boundedHighlightText(value: string, maximum: number): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximum);
}

export async function saveReadwiseHighlight(
  rawToken: string,
  input: ReadwiseHighlightInput,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const token = normalizeReadwiseToken(rawToken);
  const text = boundedHighlightText(input.text, 1_200);
  const title = boundedHighlightText(input.title, 400);
  if (text.length < 20 || !title) {
    throw new ReadwiseClientError(
      'invalid_response',
      'Выбранный фрагмент нельзя сохранить в Readwise.',
    );
  }
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(input.sourceUrl);
  } catch {
    throw new ReadwiseClientError(
      'invalid_response',
      'Источник фрагмента нельзя сохранить в Readwise.',
    );
  }
  if (!['http:', 'https:'].includes(sourceUrl.protocol)) {
    throw new ReadwiseClientError(
      'invalid_response',
      'Источник фрагмента нельзя сохранить в Readwise.',
    );
  }
  sourceUrl.hash = '';
  for (const key of [...sourceUrl.searchParams.keys()]) {
    if (/^(?:utm_|token|key|secret|auth|session|code)/iu.test(key)) {
      sourceUrl.searchParams.delete(key);
    }
  }
  const highlight = {
    text,
    title,
    ...(input.author
      ? { author: boundedHighlightText(input.author, 240) }
      : {}),
    source_url: sourceUrl.toString(),
    source_type: 'attention',
    category: 'articles',
    highlighted_at: input.highlightedAt ?? new Date().toISOString(),
  };
  const response = await readwiseFetch(HIGHLIGHTS_URL, token, fetchImpl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ highlights: [highlight] }),
  });
  if (!response.ok) throw responseError(response);
}
