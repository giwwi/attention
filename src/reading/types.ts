export interface ArticleBlock {
  id: string;
  section: string;
  kind: 'paragraph' | 'list' | 'list-item' | 'table' | 'quote' | 'code';
  text: string;
  /** Structural introductions/parent entries, never neighbouring list entries. */
  contextBlockIds?: string[];
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
  /** Profile query matched locally; this does not establish novelty. */
  focus?: string;
  score: number;
}

export interface ReadingPassages {
  version: 1;
  fingerprint: string;
  source: 'local' | 'ai';
  /** Local semantic ranking does not claim cloud verification or new knowledge. */
  method?: 'semantic';
  coverage: 'complete' | 'partial';
  status: 'ready' | 'no-match' | 'no-context' | 'unavailable';
  /** Lets the UI distinguish no model suggestions from suggestions it could not display. */
  modelCandidates?: number;
  items: ReadingPassage[];
}
