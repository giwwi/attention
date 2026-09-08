import { NOTION_API_VERSION } from './config';
import type { NotionAuth } from './types';
import { DataOperationCancelledError } from '../privacy/data-operations';

const API_ROOT = 'https://api.notion.com/v1';
const MIN_REQUEST_INTERVAL_MS = 350;
const MAX_RETRIES = 3;
const NOTION_ERROR_CODES = new Set([
  'invalid_json',
  'invalid_request_url',
  'invalid_request',
  'validation_error',
  'missing_version',
  'unauthorized',
  'restricted_resource',
  'object_not_found',
  'conflict_error',
  'rate_limited',
  'internal_server_error',
  'bad_gateway',
  'service_unavailable',
  'database_connection_unavailable',
  'gateway_timeout',
]);

export interface NotionApiPage {
  id: string;
  url: string;
  public_url?: string | null;
  last_edited_time: string;
  properties?: Record<string, unknown>;
  archived?: boolean;
  in_trash?: boolean;
}

interface ListResponse<T> {
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
  request_status?: { type?: string };
}

export interface NotionPageSearch {
  pages: NotionApiPage[];
  /** Pagination ended without hitting a cap; search still is not exhaustive. */
  paginationComplete: boolean;
}

interface MarkdownResponse {
  markdown: string;
  truncated?: boolean;
  unknown_block_ids?: string[];
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DataOperationCancelledError());
      return;
    }
    const abort = (): void => {
      clearTimeout(timer);
      reject(new DataOperationCancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export class NotionApiClient {
  private lastRequestAt = 0;

  constructor(
    private auth: NotionAuth,
    private readonly onUnauthorized: (
      current: NotionAuth,
    ) => Promise<NotionAuth | null>,
    private readonly options: {
      signal?: AbortSignal;
      assertCurrent?: () => Promise<void>;
    } = {},
  ) {}

  get currentAuth(): NotionAuth {
    return this.auth;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    retry = 0,
  ): Promise<T> {
    await this.options.assertCurrent?.();
    if (this.options.signal?.aborted) throw new DataOperationCancelledError();
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await wait(MIN_REQUEST_INTERVAL_MS - elapsed, this.options.signal);
    }
    await this.options.assertCurrent?.();
    if (this.options.signal?.aborted) throw new DataOperationCancelledError();
    this.lastRequestAt = Date.now();
    const response = await fetch(`${API_ROOT}${path}`, {
      ...init,
      signal: this.options.signal,
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
        'Notion-Version': NOTION_API_VERSION,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    await this.options.assertCurrent?.();
    if (this.options.signal?.aborted) throw new DataOperationCancelledError();
    if (response.status === 401 && retry === 0) {
      const refreshed = await this.onUnauthorized(this.auth);
      if (refreshed) {
        this.auth = refreshed;
        return this.request<T>(path, init, 1);
      }
    }
    if (response.status === 429 && retry < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      await wait(
        Number.isFinite(retryAfter)
          ? Math.min(60_000, Math.max(0, retryAfter * 1_000))
          : 1_000,
        this.options.signal,
      );
      return this.request<T>(path, init, retry + 1);
    }
    const payload: unknown = await response.json().catch(() => null);
    await this.options.assertCurrent?.();
    if (this.options.signal?.aborted) throw new DataOperationCancelledError();
    if (!response.ok) {
      const remote =
        payload && typeof payload === 'object' && 'code' in payload
          ? (payload as { code: unknown }).code
          : undefined;
      const code =
        typeof remote === 'string' && NOTION_ERROR_CODES.has(remote)
          ? remote
          : 'notion_request_failed';
      throw Object.assign(new Error(code), { code });
    }
    return payload as T;
  }

  async searchPages(maxPages = 300): Promise<NotionPageSearch> {
    const pages: NotionApiPage[] = [];
    let cursor: string | null = null;
    const cursors = new Set<string>();
    if (!Number.isInteger(maxPages) || maxPages < 1)
      throw new Error('Invalid Notion page limit.');
    do {
      const response: ListResponse<NotionApiPage> = await this.request(
        '/search',
        {
          method: 'POST',
          body: JSON.stringify({
            filter: { property: 'object', value: 'page' },
            page_size: Math.min(100, maxPages - pages.length),
            ...(cursor ? { start_cursor: cursor } : {}),
          }),
        },
      );
      if (
        !Array.isArray(response.results) ||
        typeof response.has_more !== 'boolean'
      )
        throw new Error('Invalid Notion search response.');
      pages.push(...response.results);
      if (response.request_status?.type === 'incomplete')
        return { pages: pages.slice(0, maxPages), paginationComplete: false };
      cursor = response.has_more ? response.next_cursor : null;
      if (!response.has_more)
        return {
          pages: pages.slice(0, maxPages),
          paginationComplete: pages.length <= maxPages,
        };
      if (!cursor || cursors.has(cursor))
        return { pages: pages.slice(0, maxPages), paginationComplete: false };
      cursors.add(cursor);
    } while (cursor && pages.length < maxPages);
    return { pages: pages.slice(0, maxPages), paginationComplete: false };
  }

  async retrievePage(pageId: string): Promise<NotionApiPage> {
    return this.request<NotionApiPage>(`/pages/${encodeURIComponent(pageId)}`);
  }

  async pageMarkdown(pageId: string): Promise<MarkdownResponse> {
    return this.request<MarkdownResponse>(
      `/pages/${encodeURIComponent(pageId)}/markdown`,
    );
  }
}
