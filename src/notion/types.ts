import type { ObsidianEvidenceKind } from '../shared/types';
import type { LocalSearchIndex } from '../evidence/local-search-index';

export const NOTION_SETTINGS_KEY = 'notionSettings';
export const NOTION_AUTH_KEY = 'notionAuth';

export type NotionSourceMode = 'own-notes' | 'saved-materials' | 'mixed';

export interface NotionSettings {
  connected: boolean;
  workspaceName: string | null;
  workspaceId: string | null;
  sourceMode: NotionSourceMode;
  lastSyncedAt: string | null;
  /** Revision of page evidence; changes only when page data changes. */
  evidenceUpdatedAt?: string | null;
  pageCount: number;
  fragmentCount: number;
  excludedPageCount: number;
}

export interface NotionAuth {
  accessToken: string;
  refreshToken: string | null;
  botId: string;
  workspaceId: string;
  workspaceName: string | null;
  updatedAt: string;
}

export interface NotionFragment {
  id: string;
  pageId: string;
  pageTitle: string;
  heading: string | null;
  text: string;
  kind: ObsidianEvidenceKind;
  attentionStrength: number;
  editedAt: number;
}

export interface NotionPageRecord {
  id: string;
  title: string;
  notionUrl: string;
  sourceUrlFingerprint: string | null;
  editedAt: number;
  sourceMode: NotionSourceMode;
  fragments: NotionFragment[];
}

export interface NotionIndex {
  schemaVersion: 1;
  generatedAt: string;
  workspaceName: string;
  pages: NotionPageRecord[];
  searchIndex?: LocalSearchIndex;
}

export const EMPTY_NOTION_SETTINGS: NotionSettings = {
  connected: false,
  workspaceName: null,
  workspaceId: null,
  sourceMode: 'mixed',
  lastSyncedAt: null,
  evidenceUpdatedAt: null,
  pageCount: 0,
  fragmentCount: 0,
  excludedPageCount: 0,
};
