import type { ObsidianEvidenceKind } from '../shared/types';
import type { LocalSearchIndex } from '../evidence/local-search-index';

export const OBSIDIAN_SETTINGS_KEY = 'obsidianSettings';

export interface ObsidianSettings {
  connected: boolean;
  vaultName: string | null;
  lastIndexedAt: string | null;
  /** Revision of note evidence; changes only when note data changes. */
  evidenceUpdatedAt?: string | null;
  noteCount: number;
  fragmentCount: number;
  skippedFileCount: number;
}

export interface ObsidianFragment {
  id: string;
  notePath: string;
  noteTitle: string;
  heading: string | null;
  text: string;
  tags: string[];
  links: string[];
  kind: ObsidianEvidenceKind;
  attentionStrength: number;
  modifiedAt: number;
}

export interface ObsidianNoteRecord {
  path: string;
  title: string;
  modifiedAt: number;
  size: number;
  sourceUrl?: string | null;
  sourceUrlFingerprint?: string | null;
  fragments: ObsidianFragment[];
}

export interface ObsidianIndex {
  schemaVersion: 1;
  generatedAt: string;
  vaultName: string;
  notes: ObsidianNoteRecord[];
  searchIndex?: LocalSearchIndex;
}

export const EMPTY_OBSIDIAN_SETTINGS: ObsidianSettings = {
  connected: false,
  vaultName: null,
  lastIndexedAt: null,
  evidenceUpdatedAt: null,
  noteCount: 0,
  fragmentCount: 0,
  skippedFileCount: 0,
};
