import type { NotionIndex, NotionPageRecord } from './types';
import {
  buildLocalSearchIndex,
  isLocalSearchIndex,
  updateLocalSearchIndex,
  type LocalSearchDocument,
  type LocalSearchIndex,
} from '../evidence/local-search-index';
import { NOTION_DATA_KEY, type NotionVaultData } from '../vault/legacy';
import { withSourceDataLock } from '../vault/source-lock';
import { privateStorage } from '../vault/storage';

async function loadNotionData(): Promise<NotionVaultData> {
  const stored = await privateStorage.get(NOTION_DATA_KEY);
  return (
    (stored[NOTION_DATA_KEY] as NotionVaultData | undefined) ?? { pages: [] }
  );
}

export async function loadNotionPages(): Promise<NotionPageRecord[]> {
  return (await loadNotionData()).pages;
}

function orderedPages(pages: Iterable<NotionPageRecord>): NotionPageRecord[] {
  return [...new Map([...pages].map((page) => [page.id, page])).values()].sort(
    (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}

export async function replaceNotionPages(
  pages: NotionPageRecord[],
  generatedAt: string,
): Promise<void> {
  await withSourceDataLock('notion', async () => {
    const nextPages = orderedPages(pages);
    await privateStorage.set({
      [NOTION_DATA_KEY]: {
        pages: nextPages,
        searchIndex: buildNotionSearchIndex(nextPages, generatedAt),
      } satisfies NotionVaultData,
    });
  });
}

function buildNotionSearchIndex(
  pages: NotionPageRecord[],
  generatedAt: string,
): LocalSearchIndex {
  return buildLocalSearchIndex(notionSearchDocuments(pages), generatedAt);
}

function notionSearchDocuments(
  pages: NotionPageRecord[],
): LocalSearchDocument[] {
  return pages.flatMap((page) =>
    page.fragments.map((fragment) => ({
      id: fragment.id,
      text: [page.title, fragment.heading ?? '', fragment.text].join(' '),
    })),
  );
}

export async function applyNotionPageChanges(input: {
  upserts: NotionPageRecord[];
  removedPageIds: string[];
  removedFragmentIds: string[];
  allPages: NotionPageRecord[];
  generatedAt: string;
}): Promise<void> {
  await withSourceDataLock('notion', async () => {
    const stored = await loadNotionData();
    if (input.upserts.length === 0 && input.removedPageIds.length === 0) return;
    const byId = new Map(stored.pages.map((page) => [page.id, page]));
    const removedFragmentIds = new Set(input.removedFragmentIds);
    for (const id of [
      ...input.removedPageIds,
      ...input.upserts.map((page) => page.id),
    ]) {
      for (const fragment of byId.get(id)?.fragments ?? [])
        removedFragmentIds.add(fragment.id);
    }
    for (const id of input.removedPageIds) byId.delete(id);
    for (const page of input.upserts) byId.set(page.id, page);
    const pages = orderedPages(byId.values());
    const searchIndex = isLocalSearchIndex(stored.searchIndex)
      ? updateLocalSearchIndex(
          stored.searchIndex,
          removedFragmentIds,
          notionSearchDocuments(input.upserts),
          input.generatedAt,
        )
      : buildNotionSearchIndex(pages, input.generatedAt);
    await privateStorage.set({
      [NOTION_DATA_KEY]: { pages, searchIndex } satisfies NotionVaultData,
    });
  });
}

export async function loadNotionIndex(
  workspaceName: string,
  generatedAt: string,
): Promise<NotionIndex | null> {
  const { pages, searchIndex: storedIndex } = await loadNotionData();
  if (pages.length === 0) return null;
  const searchIndex = isLocalSearchIndex(storedIndex, generatedAt)
    ? storedIndex
    : buildNotionSearchIndex(pages, generatedAt);
  return {
    schemaVersion: 1,
    generatedAt,
    workspaceName,
    pages,
    searchIndex,
  };
}

export async function clearNotionDatabase(): Promise<void> {
  await withSourceDataLock('notion', () =>
    privateStorage.remove(NOTION_DATA_KEY),
  );
}
