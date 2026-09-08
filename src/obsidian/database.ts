import type { ObsidianIndex, ObsidianNoteRecord } from './types';
import {
  buildLocalSearchIndex,
  isLocalSearchIndex,
  updateLocalSearchIndex,
  type LocalSearchDocument,
  type LocalSearchIndex,
} from '../evidence/local-search-index';
import { OBSIDIAN_DATA_KEY, type ObsidianVaultData } from '../vault/legacy';
import { withSourceDataLock } from '../vault/source-lock';
import {
  getVaultEpoch,
  onVaultStateChanged,
  privateStorage,
  VaultLockedError,
} from '../vault/storage';

interface PermissionDescriptor {
  mode: 'read';
}

/** Kept for API compatibility; directory handles are held only in process memory. */
export interface PersistedDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(descriptor?: PermissionDescriptor): Promise<PermissionState>;
  requestPermission(
    descriptor?: PermissionDescriptor,
  ): Promise<PermissionState>;
}

let vaultHandle: PersistedDirectoryHandle | null = null;
let handleEpoch: string | null = null;
let handleRevision = 0;
let observingVault = false;

function forgetVaultHandle(): void {
  vaultHandle = null;
  handleEpoch = null;
  handleRevision++;
}

function observeVault(): void {
  if (observingVault) return;
  onVaultStateChanged(forgetVaultHandle);
  observingVault = true;
}

async function currentHandleEpoch(): Promise<string> {
  try {
    return await getVaultEpoch();
  } catch (error) {
    forgetVaultHandle();
    throw error;
  }
}

export async function saveVaultHandle(
  handle: PersistedDirectoryHandle,
): Promise<void> {
  observeVault();
  const revision = handleRevision;
  const epoch = await currentHandleEpoch();
  if (revision !== handleRevision) throw new VaultLockedError();
  vaultHandle = handle;
  handleEpoch = epoch;
}

export async function loadVaultHandle(): Promise<PersistedDirectoryHandle | null> {
  observeVault();
  const epoch = await currentHandleEpoch();
  if (handleEpoch !== epoch) forgetVaultHandle();
  return vaultHandle;
}

async function loadObsidianData(): Promise<ObsidianVaultData> {
  const stored = await privateStorage.get(OBSIDIAN_DATA_KEY);
  return (
    (stored[OBSIDIAN_DATA_KEY] as ObsidianVaultData | undefined) ?? {
      notes: [],
    }
  );
}

export async function loadObsidianNotes(): Promise<ObsidianNoteRecord[]> {
  return (await loadObsidianData()).notes;
}

function orderedNotes(
  notes: Iterable<ObsidianNoteRecord>,
): ObsidianNoteRecord[] {
  // Preserve IndexedDB's unique path keys and stable key ordering.
  return [
    ...new Map([...notes].map((note) => [note.path, note])).values(),
  ].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

export async function replaceObsidianNotes(
  notes: ObsidianNoteRecord[],
  generatedAt: string,
): Promise<void> {
  await withSourceDataLock('obsidian', async () => {
    const nextNotes = orderedNotes(notes);
    await privateStorage.set({
      [OBSIDIAN_DATA_KEY]: {
        notes: nextNotes,
        searchIndex: buildObsidianSearchIndex(nextNotes, generatedAt),
      } satisfies ObsidianVaultData,
    });
  });
}

function buildObsidianSearchIndex(
  notes: ObsidianNoteRecord[],
  generatedAt: string,
): LocalSearchIndex {
  return buildLocalSearchIndex(obsidianSearchDocuments(notes), generatedAt);
}

function obsidianSearchDocuments(
  notes: ObsidianNoteRecord[],
): LocalSearchDocument[] {
  return notes.flatMap((note) =>
    note.fragments.map((fragment) => ({
      id: fragment.id,
      text: [
        note.title,
        fragment.heading ?? '',
        fragment.text,
        ...fragment.tags,
        ...fragment.links,
      ].join(' '),
    })),
  );
}

export async function applyObsidianNoteChanges(input: {
  upserts: ObsidianNoteRecord[];
  removedPaths: string[];
  removedFragmentIds: string[];
  allNotes: ObsidianNoteRecord[];
  generatedAt: string;
  vaultHandle?: PersistedDirectoryHandle;
}): Promise<void> {
  await withSourceDataLock('obsidian', async () => {
    const stored = await loadObsidianData();
    if (
      input.upserts.length === 0 &&
      input.removedPaths.length === 0 &&
      !input.vaultHandle
    )
      return;
    const byPath = new Map(stored.notes.map((note) => [note.path, note]));
    const removedFragmentIds = new Set(input.removedFragmentIds);
    for (const path of [
      ...input.removedPaths,
      ...input.upserts.map((note) => note.path),
    ]) {
      for (const fragment of byPath.get(path)?.fragments ?? [])
        removedFragmentIds.add(fragment.id);
    }
    for (const path of input.removedPaths) byPath.delete(path);
    for (const note of input.upserts) byPath.set(note.path, note);
    const notes = orderedNotes(byPath.values());
    const searchIndex = isLocalSearchIndex(stored.searchIndex)
      ? updateLocalSearchIndex(
          stored.searchIndex,
          removedFragmentIds,
          obsidianSearchDocuments(input.upserts),
          input.generatedAt,
        )
      : buildObsidianSearchIndex(notes, input.generatedAt);
    await privateStorage.set({
      [OBSIDIAN_DATA_KEY]: { notes, searchIndex } satisfies ObsidianVaultData,
    });
    if (input.vaultHandle) await saveVaultHandle(input.vaultHandle);
  });
}

export async function loadObsidianIndex(
  vaultName: string,
  generatedAt: string,
): Promise<ObsidianIndex | null> {
  const { notes, searchIndex: storedIndex } = await loadObsidianData();
  if (notes.length === 0) return null;
  const searchIndex = isLocalSearchIndex(storedIndex, generatedAt)
    ? storedIndex
    : buildObsidianSearchIndex(notes, generatedAt);
  return {
    schemaVersion: 1,
    generatedAt,
    vaultName,
    notes,
    searchIndex,
  };
}

export async function clearObsidianDatabase(): Promise<void> {
  forgetVaultHandle();
  await withSourceDataLock('obsidian', async () => {
    try {
      await privateStorage.remove(OBSIDIAN_DATA_KEY);
    } finally {
      forgetVaultHandle();
    }
  });
}
