export interface ArticleBlock {
  id: string;
  section: string;
  kind: 'paragraph' | 'list' | 'table' | 'quote' | 'code';
  text: string;
}

export interface ArticleMap {
  version: 1;
  fingerprint: string;
  complete: boolean;
  blocks: ArticleBlock[];
}

export interface ReadingPassage {
  coreBlockId: string;
  blockIds: string[];
  basis: 'goal' | 'learning' | 'interest';
  knowledge: 'unknown' | 'possibly-new';
  /** Model explanation is displayed as text only, never used as source text. */
  reason?: string;
  score: number;
}

export interface ReadingPassages {
  version: 1;
  fingerprint: string;
  source: 'local' | 'ai';
  coverage: 'complete' | 'partial';
  status: 'ready' | 'no-match' | 'no-context' | 'unavailable';
  items: ReadingPassage[];
}
