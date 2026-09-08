import {
  canonicalizeHistoryPage,
  fingerprintHistoryUrl,
} from '../history/evidence';
import { parseObsidianNote } from '../obsidian/markdown';
import { applyNotionPageChanges, loadNotionPages } from './database';
import { NotionApiClient, type NotionApiPage } from './client';
import { loadNotionSettings, saveNotionConnection } from './storage';
import {
  beginSyncOperation,
  commitDataOperation,
  assertDataOperationCurrent,
  type DataOperation,
} from '../privacy/data-operations';
import type {
  NotionAuth,
  NotionFragment,
  NotionPageRecord,
  NotionSettings,
  NotionSourceMode,
} from './types';

const MAX_TOTAL_MARKDOWN_CHARS = 12_000_000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function plainText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      const object = record(item);
      return typeof object?.plain_text === 'string' ? object.plain_text : '';
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
}

function pageTitle(page: NotionApiPage): string {
  for (const value of Object.values(page.properties ?? {})) {
    const property = record(value);
    if (property?.type === 'title') {
      const title = plainText(property.title);
      if (title) return title.slice(0, 300);
    }
  }
  return 'Untitled Notion page';
}

function externalSourceUrl(page: NotionApiPage): string | null {
  for (const [name, value] of Object.entries(page.properties ?? {})) {
    const property = record(value);
    if (property?.type !== 'url' || typeof property.url !== 'string') continue;
    if (!/(?:source|url|link|original|article|источник|ссылка)/iu.test(name)) {
      continue;
    }
    return property.url;
  }
  return null;
}

function pageKind(
  mode: NotionSourceMode,
  externalUrl: string | null,
): 'own-note' | 'imported' {
  if (mode === 'own-notes') return 'own-note';
  if (mode === 'saved-materials') return 'imported';
  return externalUrl ? 'imported' : 'own-note';
}

async function sourceFingerprint(
  sourceUrl: string | null,
  title: string,
): Promise<string | null> {
  if (!sourceUrl) return null;
  const canonical = canonicalizeHistoryPage(sourceUrl, title);
  return canonical ? fingerprintHistoryUrl(canonical.canonicalUrl) : null;
}

function numericDate(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Date.now();
}

export interface NotionSyncResult {
  settings: NotionSettings;
  auth: NotionAuth;
}

export async function syncNotionWorkspace(input: {
  auth: NotionAuth;
  sourceMode: NotionSourceMode;
  client: NotionApiClient;
  now?: Date;
  operation?: DataOperation;
}): Promise<NotionSyncResult> {
  const operation = await beginSyncOperation('notion', input.operation);
  await assertDataOperationCurrent(operation);
  const now = input.now ?? new Date();
  const snapshot = await commitDataOperation(operation, async () => ({
    pages: await loadNotionPages(),
    settings: await loadNotionSettings(),
  }));
  const existing = new Map(snapshot.pages.map((page) => [page.id, page]));
  const sameWorkspace =
    snapshot.settings.workspaceId === input.auth.workspaceId;
  const retained = new Map(sameWorkspace ? existing : []);
  const search = await input.client.searchPages();
  const remotePages = new Map(search.pages.map((page) => [page.id, page]));
  const changedPages: NotionPageRecord[] = [];
  let excludedPageCount = 0;
  let syncComplete = search.paginationComplete;
  let totalCharacters = 0;

  // Search is not an exhaustive listing, even after its last cursor. Confirm
  // missing known pages individually; absence from a capped result is not deletion.
  // https://developers.notion.com/reference/search-optimizations-and-limitations
  if (sameWorkspace && search.paginationComplete) {
    let checked = 0;
    for (const previous of existing.values()) {
      if (remotePages.has(previous.id)) continue;
      if (++checked > 300) {
        syncComplete = false;
        continue;
      }
      await assertDataOperationCurrent(operation);
      try {
        remotePages.set(
          previous.id,
          await input.client.retrievePage(previous.id),
        );
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
        if (code === 'restricted_resource' || code === 'object_not_found') {
          retained.delete(previous.id);
          excludedPageCount += 1;
        } else throw error;
      }
    }
  }

  for (const remote of remotePages.values()) {
    await assertDataOperationCurrent(operation);
    if (remote.archived || remote.in_trash) {
      retained.delete(remote.id);
      continue;
    }
    const title = pageTitle(remote);
    const editedAt = numericDate(remote.last_edited_time);
    const cached = sameWorkspace ? existing.get(remote.id) : undefined;
    if (
      cached &&
      cached.editedAt === editedAt &&
      cached.sourceMode === input.sourceMode
    ) {
      retained.set(remote.id, cached);
      continue;
    }
    if (totalCharacters >= MAX_TOTAL_MARKDOWN_CHARS) {
      excludedPageCount += 1;
      syncComplete = false;
      continue;
    }
    const sourceUrl = externalSourceUrl(remote);
    try {
      const response = await input.client.pageMarkdown(remote.id);
      await assertDataOperationCurrent(operation);
      if (
        response.truncated ||
        response.unknown_block_ids?.length ||
        response.markdown.length > MAX_TOTAL_MARKDOWN_CHARS - totalCharacters
      ) {
        excludedPageCount += 1;
        syncComplete = false;
        continue;
      }
      const markdown = response.markdown;
      totalCharacters += markdown.length;
      if (!markdown.trim()) {
        retained.delete(remote.id);
        continue;
      }
      const parsed = parseObsidianNote({
        path: `${remote.id}.md`,
        markdown,
        modifiedAt: editedAt,
        size: markdown.length,
      });
      const defaultKind = pageKind(input.sourceMode, sourceUrl);
      const fragments: NotionFragment[] = parsed.fragments.map(
        (fragment, index) => {
          const kind = fragment.kind === 'quote' ? 'quote' : defaultKind;
          return {
            id: `${remote.id}:${index}`,
            pageId: remote.id,
            pageTitle: title,
            heading: fragment.heading,
            text: fragment.text,
            kind,
            attentionStrength:
              kind === 'own-note' ? 0.88 : kind === 'quote' ? 0.5 : 0.56,
            editedAt,
          };
        },
      );
      if (fragments.length === 0) {
        retained.delete(remote.id);
        continue;
      }
      const changedPage: NotionPageRecord = {
        id: remote.id,
        title,
        notionUrl: remote.url,
        sourceUrlFingerprint: await sourceFingerprint(sourceUrl, title),
        editedAt,
        sourceMode: input.sourceMode,
        fragments,
      };
      retained.set(remote.id, changedPage);
      changedPages.push(changedPage);
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      if (code === 'restricted_resource' || code === 'object_not_found') {
        excludedPageCount += 1;
        retained.delete(remote.id);
        continue;
      }
      throw error;
    }
  }

  const generatedAt = now.toISOString();
  const pages = [...retained.values()];
  const retainedIds = new Set(pages.map((page) => page.id));
  const removedPages = [...existing.values()].filter(
    (page) => !retainedIds.has(page.id),
  );
  const changedIds = new Set(changedPages.map((page) => page.id));
  const removedFragmentIds = [...existing.values()]
    .filter((page) => changedIds.has(page.id) || !retainedIds.has(page.id))
    .flatMap((page) => page.fragments.map((fragment) => fragment.id));
  const previousSettings = snapshot.settings;
  const dataChanged = changedPages.length > 0 || removedPages.length > 0;
  const evidenceUpdatedAt = dataChanged
    ? generatedAt
    : (previousSettings.evidenceUpdatedAt ??
      previousSettings.lastSyncedAt ??
      generatedAt);
  const settings: NotionSettings = {
    connected: true,
    workspaceName: input.auth.workspaceName,
    workspaceId: input.auth.workspaceId,
    sourceMode: input.sourceMode,
    lastSyncedAt: generatedAt,
    evidenceUpdatedAt,
    pageCount: pages.length,
    fragmentCount: pages.reduce(
      (total, page) => total + page.fragments.length,
      0,
    ),
    excludedPageCount,
    syncComplete,
  };
  await commitDataOperation(operation, async () => {
    await applyNotionPageChanges({
      upserts: changedPages,
      removedPageIds: removedPages.map((page) => page.id),
      removedFragmentIds,
      allPages: pages,
      generatedAt: evidenceUpdatedAt,
    });
    await saveNotionConnection(input.client.currentAuth, settings);
  });
  return {
    auth: input.client.currentAuth,
    settings,
  };
}
