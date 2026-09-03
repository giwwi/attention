import type {
  NovelPassageFeedbackMessage,
  NovelPassageFeedbackValue,
} from './messages';
import {
  measuredStorageGet,
  measuredStorageSet,
} from '../storage/measured-storage';
import { STORAGE_RETENTION_LIMITS } from '../storage/limits';
import { canonicalizeHistoryPage } from '../history/evidence';

export const NOVEL_PASSAGE_FEEDBACK_KEY = 'novelPassageFeedback' as const;
export const CLAIM_MEMORY_REVISION_KEY = 'claimMemoryRevision' as const;

export interface NovelPassageFeedbackRecord {
  id: string;
  url: string;
  title: string;
  claim: string;
  excerpt: string;
  value: NovelPassageFeedbackValue;
  createdAt: string;
}

export function isNovelPassageFeedbackRecord(
  value: unknown,
): value is NovelPassageFeedbackRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.url === 'string' &&
    typeof item.title === 'string' &&
    typeof item.claim === 'string' &&
    typeof item.excerpt === 'string' &&
    (item.value === 'known' || item.value === 'new') &&
    typeof item.createdAt === 'string'
  );
}

export async function loadNovelPassageFeedback(
  storage: chrome.storage.StorageArea = chrome.storage.local,
): Promise<NovelPassageFeedbackRecord[]> {
  const stored = await measuredStorageGet(
    storage,
    'novel-passage-feedback',
    NOVEL_PASSAGE_FEEDBACK_KEY,
  );
  const value: unknown = stored[NOVEL_PASSAGE_FEEDBACK_KEY];
  return Array.isArray(value) ? value.filter(isNovelPassageFeedbackRecord) : [];
}

export async function loadClaimMemoryRevision(
  storage: chrome.storage.StorageArea = chrome.storage.local,
): Promise<string | null> {
  const stored = await measuredStorageGet(storage, 'claim-memory-revision', [
    CLAIM_MEMORY_REVISION_KEY,
    NOVEL_PASSAGE_FEEDBACK_KEY,
  ]);
  const revision = stored[CLAIM_MEMORY_REVISION_KEY];
  if (typeof revision === 'string') return revision;
  const value = stored[NOVEL_PASSAGE_FEEDBACK_KEY];
  if (!Array.isArray(value)) return null;
  return (
    value
      .filter(isNovelPassageFeedbackRecord)
      .map((record) => record.createdAt)
      .sort()
      .at(-1) ?? null
  );
}

export async function recordNovelPassageFeedback(
  message: NovelPassageFeedbackMessage,
  storage: chrome.storage.StorageArea = chrome.storage.local,
): Promise<void> {
  const records = await loadNovelPassageFeedback(storage);
  const canonical = canonicalNovelPassageUrl(message.url);
  const next: NovelPassageFeedbackRecord = {
    id: crypto.randomUUID(),
    url: canonical,
    title: message.title.trim(),
    claim: message.claim.trim(),
    excerpt: message.excerpt.trim(),
    value: message.value,
    createdAt: new Date().toISOString(),
  };
  const withoutSamePassage = records.filter(
    (record) =>
      !(
        canonicalNovelPassageUrl(record.url) === canonical &&
        normalize(record.excerpt) === normalize(next.excerpt)
      ),
  );
  await measuredStorageSet(storage, 'novel-passage-feedback', {
    [NOVEL_PASSAGE_FEEDBACK_KEY]: [next, ...withoutSamePassage].slice(
      0,
      STORAGE_RETENTION_LIMITS.novelPassageFeedback,
    ),
    [CLAIM_MEMORY_REVISION_KEY]: next.createdAt,
  });
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

export function canonicalNovelPassageUrl(value: string): string {
  const canonical = canonicalizeHistoryPage(value);
  if (canonical) return canonical.canonicalUrl;
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}
