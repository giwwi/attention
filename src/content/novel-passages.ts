import { textTokens, tokenOverlap } from '../analyzer/text-match';
import {
  NOVEL_PASSAGE_FEEDBACK_TYPE,
  READWISE_SAVE_HIGHLIGHT_TYPE,
} from '../novelty/messages';
import type { KeyClaimAssessment, PageCapture } from '../shared/types';
import { uiText, type UiLanguage } from '../i18n/ui';
import { findCurrentArticleRoot } from './article-root';

const PASSAGE_SELECTOR = 'p, li, blockquote, dd, td';
const EXCLUDED_SELECTOR = [
  'nav',
  'aside',
  'footer',
  'form',
  'pre',
  'code',
  '[role="navigation"]',
  '[data-attention-preview="true"]',
  '[data-attention-novel-passages="true"]',
].join(', ');
const HIGHLIGHT_NAME = 'attention-potential-new';
const MAX_PASSAGES = 3;
const MAX_CANDIDATE_KNOWN_PROBABILITY = 0.55;
const MIN_CANDIDATE_CONFIDENCE = 0.3;

interface TextSegment {
  element: HTMLElement;
  text: string;
  start: number;
  end: number;
}

export interface NovelPassageMatch {
  claim: KeyClaimAssessment;
  excerpt: string;
  range: Range;
  element: HTMLElement;
  score: number;
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

function passageElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(PASSAGE_SELECTOR),
  ).filter(
    (element) =>
      !element.closest(EXCLUDED_SELECTOR) &&
      !Array.from(element.children).some((child) =>
        child.matches(PASSAGE_SELECTOR),
      ),
  );
}

function sentenceSegments(element: HTMLElement): TextSegment[] {
  const text = element.textContent ?? '';
  const segments: TextSegment[] = [];
  const sentencePattern = /[^.!?。！？\n]+(?:[.!?。！？]+|(?=\n|$))/gu;
  for (const match of text.matchAll(sentencePattern)) {
    const raw = match[0];
    const leading = raw.search(/\S/u);
    if (leading < 0) continue;
    const trailing = raw.length - raw.trimEnd().length;
    const start = (match.index ?? 0) + leading;
    const end = (match.index ?? 0) + raw.length - trailing;
    const sentence = text.slice(start, end);
    if (normalize(sentence).length >= 20) {
      segments.push({ element, text: sentence, start, end });
    }
  }
  if (segments.length === 0) {
    const leading = text.search(/\S/u);
    const trimmed = text.trim();
    if (leading >= 0 && trimmed.length >= 20 && trimmed.length <= 1_200) {
      segments.push({
        element,
        text: trimmed,
        start: leading,
        end: leading + trimmed.length,
      });
    }
  }
  return segments;
}

function rangeForTextOffsets(
  element: HTMLElement,
  start: number,
  end: number,
): Range | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const length = textNode.data.length;
    if (!startNode && start <= offset + length) {
      startNode = textNode;
      startOffset = Math.max(0, start - offset);
    }
    if (end <= offset + length) {
      endNode = textNode;
      endOffset = Math.max(0, end - offset);
      break;
    }
    offset += length;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, Math.min(startOffset, startNode.data.length));
  range.setEnd(endNode, Math.min(endOffset, endNode.data.length));
  return range;
}

function matchScore(claim: string, excerpt: string): number {
  const normalizedClaim = normalize(claim);
  const normalizedExcerpt = normalize(excerpt);
  if (
    normalizedClaim.includes(normalizedExcerpt) ||
    normalizedExcerpt.includes(normalizedClaim)
  ) {
    return 1;
  }
  const claimTokens = textTokens(claim);
  const excerptTokens = textTokens(excerpt);
  if (claimTokens.size < 3 || excerptTokens.size < 3) return 0;
  const overlap = tokenOverlap(claimTokens, excerptTokens);
  if (overlap < 3) return 0;
  const coverage = overlap / claimTokens.size;
  const precision = overlap / excerptTokens.size;
  if (coverage < 0.4 || precision < 0.14) return 0;
  return coverage * 0.75 + Math.min(1, precision) * 0.25;
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
        claim.importance === 'primary' &&
        claim.type !== 'recommendation' &&
        claim.novelty !== 'known' &&
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
): NovelPassageMatch[] {
  const candidates = potentialNewKeyClaims(claims);
  if (candidates.length === 0) return [];
  const root = findCurrentArticleRoot(sourceDocument, capture.title);
  if (!root) return [];
  const segments = passageElements(root).flatMap(sentenceSegments);
  const usedSegments = new Set<TextSegment>();
  const results: NovelPassageMatch[] = [];
  for (const claim of candidates) {
    const anchor = claim.sourceExcerpt?.trim() || claim.claim;
    const ranked = segments
      .filter((segment) => !usedSegments.has(segment))
      .map((segment) => ({
        segment,
        score: matchScore(anchor, segment.text),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    if (!best) continue;
    const range = rangeForTextOffsets(
      best.segment.element,
      best.segment.start,
      best.segment.end,
    );
    if (!range) continue;
    usedSegments.add(best.segment);
    results.push({
      claim,
      excerpt: best.segment.text.replace(/\s+/gu, ' ').trim(),
      range,
      element: best.segment.element,
      score: best.score,
    });
    if (results.length >= Math.max(1, maximum)) break;
  }
  return results;
}

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

interface PassageView {
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
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .panel { box-sizing: border-box; width: min(360px, calc(100vw - 36px)); border: 1px solid #3fcf8e; border-radius: 14px; padding: 13px; color: #e8f8f0; background: #102a22; box-shadow: 0 16px 42px rgba(0,0,0,.34); font: 500 12px/1.4 Inter, ui-sans-serif, system-ui, sans-serif; }
      .head, .nav, .actions { display: flex; align-items: center; gap: 8px; }
      .head { justify-content: space-between; }
      strong { font-size: 13px; }
      .close { border: 0; padding: 2px 4px; color: inherit; background: transparent; font-size: 18px; cursor: pointer; }
      .excerpt { display: -webkit-box; overflow: hidden; margin: 10px 0; color: rgba(255,255,255,.82); -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
      button { border: 1px solid rgba(255,255,255,.24); border-radius: 8px; padding: 7px 9px; color: inherit; background: rgba(255,255,255,.07); font: 700 11px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
      button:hover { background: rgba(255,255,255,.14); }
      button:focus-visible { outline: 2px solid #7ee2b8; outline-offset: 2px; }
      button:disabled { cursor: default; opacity: .55; }
      .nav { justify-content: space-between; }
      .actions { flex-wrap: wrap; margin-top: 10px; }
      .readwise { margin-left: auto; }
      .status { min-height: 16px; margin-top: 8px; color: #b9d9cb; font-size: 10px; }
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
  ): void {
    if (matches.length === 0) return;
    this.clear();
    this.matches = matches;
    this.capture = capture;
    this.language = options.language;
    this.readwiseConnected = options.readwiseConnected;
    this.index = 0;
    this.applyHighlights();
    this.view = installPassageView();
    const shadow = this.view.host.shadowRoot;
    const title = shadow?.querySelector('strong');
    if (title) title.textContent = uiText(this.language, 'potentialNewTitle');
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
  }

  clear(): void {
    const css = globalThis.CSS as typeof CSS & {
      highlights?: HighlightRegistry;
    };
    css?.highlights?.delete(HIGHLIGHT_NAME);
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
      ::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(255, 214, 64, .34); text-decoration: underline 2px #d9a800; text-underline-offset: 3px; }
      .attention-potential-new-fallback { background-color: rgba(255, 214, 64, .16) !important; outline: 2px solid rgba(217, 168, 0, .72) !important; outline-offset: 3px !important; }
    `;
    document.head?.append(style);
    if (css?.highlights && HighlightConstructor) {
      css.highlights.set(
        HIGHLIGHT_NAME,
        new HighlightConstructor(...this.matches.map((match) => match.range)),
      );
      return;
    }
    this.fallbackElements = Array.from(
      new Set(this.matches.map((match) => match.element)),
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
    this.view.known.addEventListener('click', () => this.sendFeedback('known'));
    this.view.novel.addEventListener('click', () => this.sendFeedback('new'));
    this.view.readwise.addEventListener('click', () => this.saveToReadwise());
    this.view.close.addEventListener('click', () => this.clear());
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
        claim: match.claim.claim,
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
