import { NOTION_API_VERSION } from './config';
import type { NotionAuth } from './types';

const API_ROOT = 'https://api.notion.com/v1';
const MIN_REQUEST_INTERVAL_MS = 350;
const MAX_RETRIES = 3;

export interface NotionApiPage {
  id: string;
  url: string;
  public_url?: string | null;
  last_edited_time: string;
  properties?: Record<string, unknown>;
}

interface ListResponse<T> {
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

interface MarkdownResponse {
  markdown: string;
  truncated?: boolean;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class NotionApiClient {
  private lastRequestAt = 0;

  constructor(
    private auth: NotionAuth,
    private readonly onUnauthorized: (
      current: NotionAuth,
    ) => Promise<NotionAuth | null>,
  ) {}

  get currentAuth(): NotionAuth {
    return this.auth;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    retry = 0,
  ): Promise<T> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await wait(MIN_REQUEST_INTERVAL_MS - elapsed);
    }
    this.lastRequestAt = Date.now();
    const response = await fetch(`${API_ROOT}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
        'Notion-Version': NOTION_API_VERSION,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (response.status === 401 && retry === 0) {
      const refreshed = await this.onUnauthorized(this.auth);
      if (refreshed) {
        this.auth = refreshed;
        return this.request<T>(path, init, 1);
      }
    }
    if (response.status === 429 && retry < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      await wait(Number.isFinite(retryAfter) ? retryAfter * 1_000 : 1_000);
      return this.request<T>(path, init, retry + 1);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code =
        payload && typeof payload === 'object' && 'code' in payload
          ? String((payload as { code: unknown }).code)
          : `notion_${response.status}`;
      throw Object.assign(new Error(code), { code });
    }
    return payload as T;
  }

  async searchPages(maxPages = 300): Promise<NotionApiPage[]> {
    const pages: NotionApiPage[] = [];
    let cursor: string | null = null;
    do {
      const response: ListResponse<NotionApiPage> = await this.request(
        '/search',
        {
          method: 'POST',
          body: JSON.stringify({
            filter: { property: 'object', value: 'page' },
            page_size: 100,
            ...(cursor ? { start_cursor: cursor } : {}),
          }),
        },
      );
      pages.push(...response.results);
      cursor = response.has_more ? response.next_cursor : null;
    } while (cursor && pages.length < maxPages);
    return pages.slice(0, maxPages);
  }

  async pageMarkdown(pageId: string): Promise<MarkdownResponse> {
    return this.request<MarkdownResponse>(
      `/pages/${encodeURIComponent(pageId)}/markdown`,
    );
  }
}
