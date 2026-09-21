import { collectReadingBlocks, readingBlockRanges } from './reading-blocks';
import { passageWindow, exactPassageWindow } from '../reading/blocks';
import { passageText } from '../i18n/passages';
import type { ReadingPassage, ReadingPassages } from '../reading/types';
import {
  NOVEL_PASSAGE_FEEDBACK_TYPE,
  READWISE_SAVE_HIGHLIGHT_TYPE,
} from '../novelty/messages';
import type { KeyClaimAssessment, PageCapture } from '../shared/types';
import { uiText, type UiLanguage } from '../i18n/ui';
import { findCurrentArticleRoot } from './article-root';
import { CONTENT_THEME_CSS } from './theme';
import type { PassageDisplayTrace } from '../diagnostics/ai-analysis-types';
import { clearRecommendedSectionHighlights } from './headings';
import { READING_HIGHLIGHT_COLOR } from './reading-highlight';

const HIGHLIGHT_NAME = 'attention-potential-new';
const MAX_PASSAGES = 3;
const MAX_CANDIDATE_KNOWN_PROBABILITY = 0.35;
const MIN_CANDIDATE_CONFIDENCE = 0.65;

export interface NovelPassageMatch {
  claim: KeyClaimAssessment;
  excerpt: string;
  range: Range;
  element: HTMLElement;
  score: number;
  ranges?: Range[];
  elements?: HTMLElement[];
  passage?: ReadingPassage;
  fingerprint?: string;
  coreRanges?: Range[];
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

function candidatePriority(claim: KeyClaimAssessment): number {
  const noveltyPriority = claim.novelty === 'likely-new' ? 1 : 0.5;
  const concretePriority =
    claim.type === 'fact' || claim.type === 'evidence'
      ? 3
      : claim.type === 'mechanism'
        ? 2
        : 1;
  return (
    noveltyPriority +
    concretePriority +
    (1 - claim.knownProbability) * Math.max(0.3, claim.confidence)
  );
}

export function potentialNewKeyClaims(
  claims: KeyClaimAssessment[] | undefined,
): KeyClaimAssessment[] {
  return (claims ?? [])
    .filter(
      (claim) =>
        claim.novelty === 'likely-new' &&
        claim.knownProbability <= MAX_CANDIDATE_KNOWN_PROBABILITY &&
        claim.confidence >= MIN_CANDIDATE_CONFIDENCE &&
        claim.claim.trim().length >= 10,
    )
    .sort((left, right) => candidatePriority(right) - candidatePriority(left));
}

export function findNovelPassageMatches(
  sourceDocument: Document,
  capture: PageCapture,
  claims: KeyClaimAssessment[] | undefined,
  maximum = MAX_PASSAGES,
  selection?: ReadingPassages,
  trace?: PassageDisplayTrace,
): NovelPassageMatch[] {
  const root = findCurrentArticleRoot(sourceDocument, capture.title);
  if (!root) {
    if (trace) trace.reason = 'article-root-not-found';
    return [];
  }
  const { map, elements } = collectReadingBlocks(root);
  if (trace && selection)
    trace.fingerprintMatches = selection.fingerprint === map.fingerprint;
  if (selection && selection.fingerprint !== map.fingerprint) {
    if (trace) trace.reason = 'fingerprint-changed';
    return [];
  }
  const entries: {
    passage: ReadingPassage | undefined;
    claim: KeyClaimAssessment | undefined;
  }[] = selection
    ? selection.items.map((passage) => ({
        passage,
        claim: undefined as KeyClaimAssessment | undefined,
      }))
    : potentialNewKeyClaims(claims).map((claim) => {
        const anchor = normalize(claim.sourceExcerpt || claim.claim);
        const block = map.blocks.find((item) =>
          normalize(item.text).includes(anchor),
        );
        return {
          claim,
          passage: block
            ? {
                coreBlockId: block.id,
                blockIds: [block.id],
                basis: 'interest' as const,
                knowledge: 'unknown' as const,
                score: candidatePriority(claim),
              }
            : undefined,
        };
      });
  const used = new Set<string>();
  const result: NovelPassageMatch[] = [];
  for (const entry of entries) {
    if (!entry.passage) continue;
    const blocks = (
      selection?.source === 'ai' ? exactPassageWindow : passageWindow
    )(map, entry.passage.coreBlockId, entry.passage.blockIds);
    if (!blocks.length) {
      if (trace) trace.invalidWindows++;
      continue;
    }
    const core = map.blocks.find(
      (block) => block.id === entry.passage!.coreBlockId,
    )!;
    if (
      blocks.some(
        (block) =>
          used.has(block.id) && !core.contextBlockIds?.includes(block.id),
      )
    ) {
      if (trace) trace.overlapping++;
      continue;
    }
    const nodes = blocks.map((block) => elements.get(block.id)!);
    const blockRanges = nodes.map(readingBlockRanges);
    const ranges = blockRanges.flat();
    const claim = entry.claim ?? {
      claim: core.text,
      sourceExcerpt: core.text,
      type: 'thesis' as const,
      importance: 'supporting' as const,
      novelty: 'uncertain' as const,
      knownProbability: 0.5,
      confidence: 0.3,
      reason: entry.passage.reason ?? '',
    };
    result.push({
      claim,
      excerpt: blocks.map((block) => block.text).join('\n\n'),
      range: ranges[0]!,
      ranges,
      elements: nodes,
      element: core.kind === 'list-item' ? elements.get(core.id)! : nodes[0]!,
      score: entry.passage.score,
      passage: selection ? entry.passage : undefined,
      coreRanges:
        blockRanges[blocks.findIndex((block) => block.id === core.id)],
      fingerprint: map.fingerprint,
    });
    blocks.forEach((block) => used.add(block.id));
    if (result.length >= maximum) {
      if (trace) trace.limited = entries.length - (entries.indexOf(entry) + 1);
      break;
    }
  }
  if (trace) {
    trace.matched = result.length;
    trace.reason = result.length
      ? 'matched'
      : selection?.items.length
        ? 'no-dom-matches'
        : 'no-selection';
  }
  return result;
}

interface PassageView {
  title: HTMLElement;
  host: HTMLDivElement;
  counter: HTMLSpanElement;
  excerpt: HTMLParagraphElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  known: HTMLButtonElement;
  novel: HTMLButtonElement;
  readwise: HTMLButtonElement;
  readwiseHint: HTMLParagraphElement;
  status: HTMLSpanElement;
  close: HTMLButtonElement;
}

function installPassageView(): PassageView {
  document
    .querySelectorAll<HTMLElement>('[data-attention-novel-passages="true"]')
    .forEach((element) => element.remove());
  const host = document.createElement('div');
  host.dataset.attentionNovelPassages = 'true';
  Object.assign(host.style, {
    all: 'initial',
    position: 'fixed',
    right: '18px',
    bottom: '18px',
    zIndex: '2147483647',
  });
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      ${CONTENT_THEME_CSS}
      .panel { box-sizing: border-box; width: min(360px, calc(100vw - 36px)); border: 1px solid var(--attention-border); border-radius: 14px; padding: 13px; color: var(--attention-fg); background: var(--attention-bg); box-shadow: 0 16px 42px var(--attention-shadow); font: 500 12px/1.4 Inter, ui-sans-serif, system-ui, sans-serif; }
      .head, .nav, .actions { display: flex; align-items: center; gap: 8px; }
      .head { justify-content: space-between; }
      strong { font-size: 13px; }
      .close { border: 0; padding: 2px 4px; color: inherit; background: transparent; font-size: 18px; cursor: pointer; }
      .excerpt { display: -webkit-box; overflow: hidden; margin: 10px 0; color: var(--attention-secondary); -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
      button { border: 1px solid var(--attention-border); border-radius: 8px; padding: 7px 9px; color: inherit; background: var(--attention-control-bg); font: 700 11px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
      button:hover { background: var(--attention-control-hover); }
      button:focus-visible { outline: 2px solid var(--attention-focus); outline-offset: 2px; }
      button:disabled { cursor: default; opacity: .55; }
      .nav { justify-content: space-between; }
      .actions { flex-wrap: wrap; margin-top: 10px; }
      .readwise { margin-left: auto; }
      .readwise[data-unavailable="true"] { color: #59636e; background: #e9ecef; border-color: #c7cdd2; opacity: 1; }
      .readwise-hint { margin: 6px 0 0; color: var(--attention-muted); font-size: 10px; }
      @media (prefers-color-scheme: dark) { .readwise[data-unavailable="true"] { color: #b0b7c3; background: #2b3038; border-color: #616b75; } }
      .status { min-height: 16px; margin-top: 8px; color: var(--attention-muted); font-size: 10px; }
    </style>
    <section class="panel" role="dialog" aria-live="polite">
      <div class="head"><strong></strong><button class="close" type="button">×</button></div>
      <p class="excerpt"></p>
      <div class="nav"><button class="previous" type="button">←</button><span class="counter"></span><button class="next" type="button">→</button></div>
      <div class="actions"><button class="known" type="button"></button><button class="novel" type="button"></button><button class="readwise" type="button"></button></div>
      <p id="readwise-hint" class="readwise-hint" hidden></p>
      <div class="status" role="status"></div>
    </section>`;
  document.documentElement.append(host);
  return {
    host,
    title: shadow.querySelector('strong') as HTMLElement,
    counter: shadow.querySelector('.counter') as HTMLSpanElement,
    excerpt: shadow.querySelector('.excerpt') as HTMLParagraphElement,
    previous: shadow.querySelector('.previous') as HTMLButtonElement,
    next: shadow.querySelector('.next') as HTMLButtonElement,
    known: shadow.querySelector('.known') as HTMLButtonElement,
    novel: shadow.querySelector('.novel') as HTMLButtonElement,
    readwise: shadow.querySelector('.readwise') as HTMLButtonElement,
    readwiseHint: shadow.querySelector(
      '.readwise-hint',
    ) as HTMLParagraphElement,
    status: shadow.querySelector('.status') as HTMLSpanElement,
    close: shadow.querySelector('.close') as HTMLButtonElement,
  };
}

export class NovelPassageController {
  private matches: NovelPassageMatch[] = [];
  private articleObserver: MutationObserver | null = null;
  private capture: PageCapture | null = null;
  private index = 0;
  private view: PassageView | null = null;
  private feedback = new Map<string, 'known' | 'new'>();
  private readwiseSaved = new Set<string>();
  private readwiseConnected = false;
  private language: UiLanguage = 'ru';
  private fallbackElements: HTMLElement[] = [];
  private fallbackWrappers: HTMLElement[] = [];

  show(
    matches: NovelPassageMatch[],
    capture: PageCapture,
    options: { language: UiLanguage; readwiseConnected: boolean },
  ): boolean {
    if (matches.length === 0) return false;
    const articleRoot = findCurrentArticleRoot(document, capture.title);
    if (!articleRoot) return false;
    const currentFingerprint =
      collectReadingBlocks(articleRoot).map.fingerprint;
    if (
      matches.some(
        (match) =>
          !match.element.isConnected ||
          (match.fingerprint && match.fingerprint !== currentFingerprint),
      )
    )
      return false;
    this.clear();
    // Relevance decides what is selected, not the reading route. Navigate the
    // selected windows from top to bottom without mutating the ranked results.
    this.matches = [...matches].sort((left, right) => {
      const position = left.element.compareDocumentPosition(right.element);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    this.capture = capture;
    this.language = options.language;
    this.readwiseConnected = options.readwiseConnected;
    this.index = 0;
    clearRecommendedSectionHighlights(document);
    this.view = installPassageView();
    this.view.title.textContent = passageText(this.language, 'title');
    this.view.previous.textContent = uiText(this.language, 'previousPassage');
    this.view.next.textContent = uiText(this.language, 'nextPassage');
    this.view.known.textContent = uiText(this.language, 'alreadyKnew');
    this.view.novel.textContent = uiText(this.language, 'newToMe');
    this.view.readwise.textContent = uiText(this.language, 'saveToReadwise');
    this.view.readwise.dataset.unavailable = String(!this.readwiseConnected);
    this.view.readwiseHint.hidden = this.readwiseConnected;
    this.view.readwiseHint.textContent = passageText(
      this.language,
      'connectReadwiseHint',
    );
    if (!this.readwiseConnected)
      this.view.readwise.setAttribute('aria-describedby', 'readwise-hint');
    this.view.close.setAttribute(
      'aria-label',
      uiText(this.language, 'closePassages'),
    );
    this.bindView();
    this.render();
    this.view.close.focus({ preventScroll: true });
    this.articleObserver = new MutationObserver(() => {
      if (
        !articleRoot.isConnected ||
        collectReadingBlocks(articleRoot).map.fingerprint !== currentFingerprint
      )
        this.clear();
    });
    this.articleObserver.observe(articleRoot, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return true;
  }

  clear(): void {
    this.articleObserver?.disconnect();
    this.articleObserver = null;
    this.clearHighlightPaint();
    this.view?.host.remove();
    this.view = null;
    this.matches = [];
    this.capture = null;
  }

  private clearHighlightPaint(): void {
    const css = globalThis.CSS as typeof CSS & {
      highlights?: HighlightRegistry;
    };
    css?.highlights?.delete(HIGHLIGHT_NAME);
    // Remove the old core/context layer when refreshing an existing session.
    css?.highlights?.delete('attention-reading-core');
    document
      .querySelectorAll<HTMLElement>(
        '[data-attention-novel-highlight-style="true"]',
      )
      .forEach((element) => element.remove());
    for (const element of this.fallbackElements) {
      element.classList.remove('attention-potential-new-fallback');
    }
    this.fallbackElements = [];
    for (const wrapper of this.fallbackWrappers)
      wrapper.replaceWith(...wrapper.childNodes);
    this.fallbackWrappers = [];
  }

  private applyHighlights(): void {
    this.clearHighlightPaint();
    const match = this.matches[this.index];
    if (!match) return;
    const css = globalThis.CSS as typeof CSS & {
      highlights?: HighlightRegistry;
    };
    const HighlightConstructor = (
      globalThis as typeof globalThis & {
        Highlight?: new (...ranges: Range[]) => unknown;
      }
    ).Highlight;
    const style = document.createElement('style');
    style.dataset.attentionNovelHighlightStyle = 'true';
    style.textContent = `
      ::highlight(${HIGHLIGHT_NAME}) { background-color: ${READING_HIGHLIGHT_COLOR}; }
      .attention-potential-new-fallback { background-color: ${READING_HIGHLIGHT_COLOR} !important; }
    `;
    document.head?.append(style);
    if (css?.highlights && HighlightConstructor) {
      css.highlights.set(
        HIGHLIGHT_NAME,
        new HighlightConstructor(
          ...(match.elements?.some((element) => element.matches('li'))
            ? match.elements.flatMap(readingBlockRanges)
            : (match.ranges ?? [match.range])),
        ),
      );
      return;
    }
    this.fallbackElements = Array.from(
      new Set(match.elements ?? [match.element]),
    );
    for (const element of this.fallbackElements) {
      if (element.matches('li')) {
        for (const range of readingBlockRanges(element)) {
          const node = range.startContainer;
          const wrapper = document.createElement('span');
          wrapper.className = 'attention-potential-new-fallback';
          node.parentNode?.insertBefore(wrapper, node);
          wrapper.append(node);
          this.fallbackWrappers.push(wrapper);
        }
      } else element.classList.add('attention-potential-new-fallback');
    }
  }

  private bindView(): void {
    if (!this.view) return;
    this.view.previous.addEventListener('click', () => {
      this.index = Math.max(0, this.index - 1);
      this.render();
    });
    this.view.next.addEventListener('click', () => {
      this.index = Math.min(this.matches.length - 1, this.index + 1);
      this.render();
    });
    this.view.known.addEventListener('click', (event) => {
      if (event.isTrusted) this.sendFeedback('known');
    });
    this.view.novel.addEventListener('click', (event) => {
      if (event.isTrusted) this.sendFeedback('new');
    });
    this.view.readwise.addEventListener('click', (event) => {
      if (event.isTrusted) this.saveToReadwise();
    });
    const dismiss = (): void => {
      this.clear();
      document
        .querySelector<HTMLButtonElement>('[data-attention-trigger]')
        ?.focus({ preventScroll: true });
    };
    this.view.close.addEventListener('click', dismiss);
    this.view.host.addEventListener('keydown', (event) => {
      if (event.isTrusted && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }
    });
  }

  private render(): void {
    if (!this.view) return;
    const match = this.matches[this.index];
    if (!match) return;
    this.applyHighlights();
    this.view.counter.textContent = uiText(this.language, 'passageCounter', {
      current: this.index + 1,
      total: this.matches.length,
    });
    this.view.excerpt.textContent = match.excerpt;
    // Disabling the focused navigation button would send keyboard input to the
    // underlying page. Keep focus on the other available passage control.
    const focused = (this.view.close.getRootNode() as ShadowRoot).activeElement;
    if (focused === this.view.next && this.index === this.matches.length - 1) {
      this.view.previous.disabled = this.matches.length === 1;
      (this.matches.length > 1 ? this.view.previous : this.view.close).focus({
        preventScroll: true,
      });
    } else if (focused === this.view.previous && this.index === 0) {
      this.view.next.disabled = this.matches.length === 1;
      (this.matches.length > 1 ? this.view.next : this.view.close).focus({
        preventScroll: true,
      });
    }
    this.view.previous.disabled = this.index === 0;
    this.view.next.disabled = this.index === this.matches.length - 1;
    const selected = this.feedback.get(match.excerpt);
    this.view.known.disabled = selected === 'known';
    this.view.novel.disabled = selected === 'new';
    this.view.readwise.disabled =
      !this.readwiseConnected || this.readwiseSaved.has(match.excerpt);
    this.view.readwise.textContent = uiText(
      this.language,
      this.readwiseSaved.has(match.excerpt)
        ? 'savedToReadwise'
        : 'saveToReadwise',
    );
    this.view.status.textContent = selected
      ? uiText(this.language, 'feedbackSaved')
      : match.passage
        ? passageText(
            this.language,
            match.passage.knowledge === 'possibly-new'
              ? 'possiblyNew'
              : match.passage.basis,
          )
        : '';
    match.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  private sendFeedback(value: 'known' | 'new'): void {
    const match = this.matches[this.index];
    if (!match || !this.capture || !this.view) return;
    this.view.known.disabled = true;
    this.view.novel.disabled = true;
    void chrome.runtime
      .sendMessage({
        type: NOVEL_PASSAGE_FEEDBACK_TYPE,
        url: this.capture.url,
        title: this.capture.title,
        claim: match.passage ? match.excerpt : match.claim.claim,
        excerpt: match.excerpt,
        value,
      })
      .then((response: unknown) => {
        if (
          !response ||
          typeof response !== 'object' ||
          (response as Record<string, unknown>).ok !== true
        ) {
          throw new Error('Feedback failed');
        }
        this.feedback.set(match.excerpt, value);
        this.render();
      })
      .catch(() => {
        if (this.view) {
          this.view.status.textContent = uiText(
            this.language,
            'passageActionFailed',
          );
          this.view.known.disabled = false;
          this.view.novel.disabled = false;
        }
      });
  }

  private saveToReadwise(): void {
    const match = this.matches[this.index];
    if (!match || !this.capture || !this.view || !this.readwiseConnected)
      return;
    this.view.readwise.disabled = true;
    this.view.readwise.textContent = uiText(this.language, 'savingToReadwise');
    void chrome.runtime
      .sendMessage({
        type: READWISE_SAVE_HIGHLIGHT_TYPE,
        url: this.capture.url,
        title: this.capture.title,
        author: this.capture.byline,
        excerpt: match.excerpt,
      })
      .then((response: unknown) => {
        if (
          !response ||
          typeof response !== 'object' ||
          (response as Record<string, unknown>).ok !== true
        ) {
          throw new Error('Readwise save failed');
        }
        this.readwiseSaved.add(match.excerpt);
        this.render();
      })
      .catch(() => {
        if (this.view) {
          this.view.readwise.disabled = false;
          this.view.readwise.textContent = uiText(
            this.language,
            'saveToReadwise',
          );
          this.view.status.textContent = uiText(
            this.language,
            'readwiseSaveFailed',
          );
        }
      });
  }
}
