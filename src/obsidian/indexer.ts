import {
  loadObsidianNotes,
  applyObsidianNoteChanges,
  type PersistedDirectoryHandle,
} from './database';
import { parseObsidianNote } from './markdown';
import { loadObsidianSettings, saveObsidianSettings } from './storage';
import type { ObsidianNoteRecord, ObsidianSettings } from './types';
import {
  canonicalizeHistoryPage,
  fingerprintHistoryUrl,
} from '../history/evidence';

const MAX_NOTES = 2_000;
const MAX_FILE_BYTES = 2_000_000;
const MAX_TOTAL_CHARACTERS = 20_000_000;
const EXCLUDED_DIRECTORIES = new Set([
  '.obsidian',
  '.trash',
  '.git',
  'node_modules',
]);

interface MarkdownFile {
  path: string;
  handle: FileSystemFileHandle;
}

interface IterableDirectoryHandle extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<
    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
  >;
}

export interface ObsidianIndexingProgress {
  phase: 'scanning' | 'reading' | 'saving';
  processed: number;
  total: number;
}

export interface ObsidianIndexingResult {
  settings: ObsidianSettings;
  reusedNoteCount: number;
  changedNoteCount: number;
  removedNoteCount: number;
}

async function withSourceFingerprint(
  note: ObsidianNoteRecord,
): Promise<ObsidianNoteRecord> {
  if (!note.sourceUrl) return { ...note, sourceUrlFingerprint: null };
  const canonical = canonicalizeHistoryPage(note.sourceUrl, note.title);
  return {
    ...note,
    sourceUrlFingerprint: canonical
      ? await fingerprintHistoryUrl(canonical.canonicalUrl)
      : null,
  };
}

async function markdownFiles(
  directory: FileSystemDirectoryHandle,
  prefix = '',
  files: MarkdownFile[] = [],
): Promise<MarkdownFile[]> {
  const iterableDirectory = directory as IterableDirectoryHandle;
  for await (const [name, handle] of iterableDirectory.entries()) {
    if (files.length >= MAX_NOTES) break;
    if (name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      if (EXCLUDED_DIRECTORIES.has(name)) continue;
      await markdownFiles(handle, path, files);
      continue;
    }
    if (/\.md$/iu.test(name)) files.push({ path, handle });
  }
  return files;
}

export async function indexObsidianVault(
  handle: PersistedDirectoryHandle,
  onProgress?: (progress: ObsidianIndexingProgress) => void,
  now = new Date(),
): Promise<ObsidianIndexingResult> {
  onProgress?.({ phase: 'scanning', processed: 0, total: 0 });
  const files = await markdownFiles(handle);
  const existing = new Map(
    (await loadObsidianNotes()).map((note) => [note.path, note]),
  );
  const notes: ObsidianNoteRecord[] = [];
  const changedNotes: ObsidianNoteRecord[] = [];
  let skippedFileCount = 0;
  let totalCharacters = 0;
  let reusedNoteCount = 0;
  let changedNoteCount = 0;

  for (const [index, item] of files.entries()) {
    onProgress?.({ phase: 'reading', processed: index, total: files.length });
    const file = await item.handle.getFile();
    if (
      file.size > MAX_FILE_BYTES ||
      totalCharacters + file.size > MAX_TOTAL_CHARACTERS
    ) {
      skippedFileCount += 1;
      continue;
    }
    totalCharacters += file.size;
    const previous = existing.get(item.path);
    if (
      previous &&
      previous.modifiedAt === file.lastModified &&
      previous.size === file.size &&
      previous.sourceUrlFingerprint !== undefined
    ) {
      notes.push(previous);
      reusedNoteCount += 1;
      continue;
    }
    const markdown = await file.text();
    const changedNote = await withSourceFingerprint(
      parseObsidianNote({
        path: item.path,
        markdown,
        modifiedAt: file.lastModified,
        size: file.size,
      }),
    );
    notes.push(changedNote);
    changedNotes.push(changedNote);
    changedNoteCount += 1;
  }

  onProgress?.({
    phase: 'saving',
    processed: notes.length,
    total: notes.length,
  });
  const lastIndexedAt = now.toISOString();
  const retainedPaths = new Set(notes.map((note) => note.path));
  const removedNotes = [...existing.values()].filter(
    (note) => !retainedPaths.has(note.path),
  );
  const changedPaths = new Set(changedNotes.map((note) => note.path));
  const removedFragmentIds = [...existing.values()]
    .filter(
      (note) => changedPaths.has(note.path) || !retainedPaths.has(note.path),
    )
    .flatMap((note) => note.fragments.map((fragment) => fragment.id));
  const previousSettings = await loadObsidianSettings();
  const dataChanged = changedNotes.length > 0 || removedNotes.length > 0;
  const evidenceUpdatedAt = dataChanged
    ? lastIndexedAt
    : (previousSettings.evidenceUpdatedAt ??
      previousSettings.lastIndexedAt ??
      lastIndexedAt);
  await applyObsidianNoteChanges({
    upserts: changedNotes,
    removedPaths: removedNotes.map((note) => note.path),
    removedFragmentIds,
    allNotes: notes,
    generatedAt: evidenceUpdatedAt,
  });
  const settings: ObsidianSettings = {
    connected: true,
    vaultName: handle.name,
    lastIndexedAt,
    evidenceUpdatedAt,
    noteCount: notes.length,
    fragmentCount: notes.reduce((sum, note) => sum + note.fragments.length, 0),
    skippedFileCount,
  };
  await saveObsidianSettings(settings);
  return {
    settings,
    reusedNoteCount,
    changedNoteCount,
    removedNoteCount: removedNotes.length,
  };
}
