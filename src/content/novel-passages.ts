import { collectReadingBlocks } from './reading-blocks';
import { passageWindow } from '../reading/blocks';
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

const HIGHLIGHT_NAME = 'attention-potential-new';
const CORE_HIGHLIGHT_NAME = 'attention-reading-core';
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
): NovelPassageMatch[] {
  const root = findCurrentArticleRoot(sourceDocument, capture.title);
  if (!root) return [];
  const { map, elements } = collectReadingBlocks(root);
  if (selection && selection.fingerprint !== map.fingerprint) return [];
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
    const blocks = passageWindow(
      map,
      entry.passage.coreBlockId,
      entry.passage.blockIds,
    );
    if (!blocks.length || blocks.some((block) => used.has(block.id))) continue;
    const nodes = blocks.map((block) => elements.get(block.id)!);
    const ranges = nodes.map((element) => {
      const range = sourceDocument.createRange();
      range.selectNodeContents(element);
      return range;
    });
    const core = map.blocks.find(
      (block) => block.id === entry.passage!.coreBlockId,
    )!;
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
      element: nodes[0]!,
      score: entry.passage.score,
      passage: selection ? entry.passage : undefined,
      coreRanges: ranges.filter((_, index) => blocks[index]!.id === core.id),
      fingerprint: map.fingerprint,
    });
    blocks.forEach((block) => used.add(block.id));
    if (result.length >= maximum) break;
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
      .status { min-height: 16px; margin-top: 8px; color: var(--attention-muted); font-size: 10px; }
    </style>
    <section class="panel" role="dialog" aria-live="polite">
      <div class="head"><strong></strong><button class="close" type="button">×</button></div>
      <p class="excerpt"></p>
      <div class="nav"><button class="previous" type="button">←</button><span class="counter"></span><button class="next" type="button">→</button></div>
      <div class="actions"><button class="known" type="button"></button><button class="novel" type="button"></button><button class="readwise" type="button"></button></div>
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
    this.matches = matches;
    this.capture = capture;
    this.language = options.language;
    this.readwiseConnected = options.readwiseConnected;
    this.index = 0;
    this.applyHighlights();
    this.view = installPassageView();
    this.view.title.textContent = passageText(this.language, 'title');
    this.view.previous.textContent = uiText(this.language, 'previousPassage');
    this.view.next.textContent = uiText(this.language, 'nextPassage');
    this.view.known.textContent = uiText(this.language, 'alreadyKnew');
    this.view.novel.textContent = uiText(this.language, 'newToMe');
    this.view.readwise.textContent = uiText(this.language, 'saveToReadwise');
    this.view.readwise.hidden = !this.readwiseConnected;
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
    const css = globalThis.CSS as typeof CSS & {
      highlights?: HighlightRegistry;
    };
    css?.highlights?.delete(HIGHLIGHT_NAME);
    css?.highlights?.delete(CORE_HIGHLIGHT_NAME);
    document
      .querySelectorAll<HTMLElement>(
        '[data-attention-novel-highlight-style="true"]',
      )
      .forEach((element) => element.remove());
    for (const element of this.fallbackElements) {
      element.classList.remove('attention-potential-new-fallback');
    }
    this.fallbackElements = [];
    this.view?.host.remove();
    this.view = null;
    this.matches = [];
    this.capture = null;
  }

  private applyHighlights(): void {
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
      ::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(255, 214, 64, .16); }
      ::highlight(${CORE_HIGHLIGHT_NAME}) { background-color: rgba(255, 214, 64, .34); text-decoration: underline 2px #d9a800; text-underline-offset: 3px; }
      .attention-potential-new-fallback { background-color: rgba(255, 214, 64, .16) !important; outline: 2px solid rgba(217, 168, 0, .72) !important; outline-offset: 3px !important; }
    `;
    document.head?.append(style);
    if (css?.highlights && HighlightConstructor) {
      css.highlights.set(
        HIGHLIGHT_NAME,
        new HighlightConstructor(
          ...this.matches.flatMap((match) => match.ranges ?? [match.range]),
        ),
      );
      css.highlights.set(
        CORE_HIGHLIGHT_NAME,
        new HighlightConstructor(
          ...this.matches.flatMap((match) => match.coreRanges ?? [match.range]),
        ),
      );
      return;
    }
    this.fallbackElements = Array.from(
      new Set(
        this.matches.flatMap((match) => match.elements ?? [match.element]),
      ),
    );
    for (const element of this.fallbackElements) {
      element.classList.add('attention-potential-new-fallback');
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
    this.view.readwise.disabled = this.readwiseSaved.has(match.excerpt);
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
