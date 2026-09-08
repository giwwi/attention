import { CONTENT_THEME_CSS } from './theme';
import { DEFAULT_UI_LANGUAGE } from '../i18n/ui';
import { cardText } from '../i18n/card';
import { readingPlanText } from '../i18n/reading-plan';

export interface CardView {
  host: HTMLDivElement;
  card: HTMLDivElement;
  verdict: HTMLDivElement;
  score: HTMLDivElement;
  decisionSummary: HTMLDivElement;
  usefulTime: HTMLDivElement;
  reliabilityNote: HTMLDivElement;
  analysisSource: HTMLSpanElement;
  aiButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
  passageHint: HTMLParagraphElement;
  actionStatus: HTMLParagraphElement;
  passagesButton: HTMLButtonElement;
  readingPlan: HTMLElement;
  readingPlanTitle: HTMLDivElement;
  readingPlanSections: HTMLOListElement;
  highlightSectionsButton: HTMLButtonElement;
  details: HTMLDetailsElement;
  detailsSummary: HTMLElement;
  scoreDetail: HTMLElement;
  closeButton: HTMLButtonElement;
  contextSlot: HTMLElement;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function button(className: string, text = ''): HTMLButtonElement {
  const node = element('button', className);
  node.type = 'button';
  node.textContent = text;
  return node;
}

export function installCardHost(): CardView {
  const host = element('div', 'attention-card-host');
  host.id = 'attention-preview-card';
  host.dataset.attentionPreview = 'true';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  host.tabIndex = -1;
  Object.assign(host.style, {
    all: 'initial',
    display: 'none',
    position: 'fixed',
    zIndex: '2147483647',
    pointerEvents: 'none',
  });
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    ${CONTENT_THEME_CSS}
    *, *::before, *::after { box-sizing: border-box; }
    .card { display: flex; min-width: 164px; align-items: center; justify-content: center; gap: 7px; border: 1px solid #3fcf8e; border-radius: 10px; padding: 10px 12px; color: #dff9ec; background: #0d2d23; box-shadow: 0 10px 28px rgba(0,0,0,.24); font: 800 12px/1.2 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: .035em; text-align: center; text-transform: uppercase; }
    .card::before { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #42d392; box-shadow: 0 0 0 3px rgba(66,211,146,.14); content: ""; }
    .card:not(.expanded)[data-verdict="maybe"] { border-color: #8b929a; color: #f0f2f4; background: #292d32; }
    .card:not(.expanded)[data-verdict="maybe"]::before { background: #a7adb4; box-shadow: 0 0 0 3px rgba(167,173,180,.14); }
    .card:not(.expanded)[data-verdict="skip"] { border-color: #e85c5c; color: #ffe5e5; background: #35191c; }
    .card:not(.expanded)[data-verdict="skip"]::before { background: #ff6b6b; box-shadow: 0 0 0 3px rgba(255,107,107,.14); }
    .card:not(.expanded) > :not(.verdict) { display: none !important; }
    .card.expanded { display: block; width: min(360px, calc(100vw - 20px)); min-width: 0; max-height: calc(100vh - 20px); max-height: calc(100dvh - 20px); overflow: auto; overscroll-behavior: contain; padding: 16px; color: var(--attention-fg); background: var(--attention-bg); border-color: var(--attention-border); border-radius: 16px; box-shadow: 0 12px 36px var(--attention-shadow); font-weight: 400; line-height: 1.45; letter-spacing: 0; text-align: start; text-transform: none; overflow-wrap: anywhere; }
    .card.expanded::before { display: none; }
    [hidden] { display: none !important; }
    button, input, select, textarea { font: inherit; }
    button { min-width: 0; border: 1px solid var(--attention-border); border-radius: 9px; padding: 8px 10px; color: var(--attention-fg); background: var(--attention-control-bg); font-size: 12px; font-weight: 650; line-height: 1.35; cursor: pointer; }
    button:not(:disabled):hover { background: var(--attention-control-hover); border-color: var(--attention-border-hover); }
    button:disabled { opacity: .58; cursor: default; }
    button:focus-visible, summary:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 3px solid var(--attention-focus); outline-offset: 3px; }
    .card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-block-end: 8px; }
    .card-brand { color: var(--attention-muted); font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    .close-button { display: grid; place-items: center; width: 32px; min-height: 32px; padding: 0; border-color: transparent; color: var(--attention-muted); background: transparent; font-size: 22px; font-weight: 400; line-height: 1; }
    .context-slot { color: var(--attention-muted); font-size: 12px; margin-block-end: 14px; }
    .context-slot:empty { display: none; }
    .card.expanded .verdict { margin: 0; font-size: 22px; font-weight: 750; line-height: 1.2; letter-spacing: -.025em; }
    .score { margin-block-start: 10px; font-size: 14px; line-height: 1.5; }
    .score:empty, .decision-summary:empty, .score-detail:empty { display: none; }
    .useful-time { margin-block-start: 10px; color: var(--attention-muted); font-size: 12px; font-weight: 550; }
    .reliability-note { display: none; }
    .reliability-note.has-warning { display: block; margin-block-start: 10px; padding-inline-start: 9px; border-inline-start: 2px solid var(--attention-warning-border); color: var(--attention-warning); font-size: 12px; }
    .article-actions { display: grid; gap: 8px; margin-block-start: 16px; }
    .save-button, .passages-button { display: block; width: 100%; min-height: 40px; font-size: 13px; }
    .article-actions button[data-primary="true"] { min-height: 42px; border-color: var(--attention-accent); color: var(--attention-on-accent); background: var(--attention-accent); font-size: 14px; }
    .article-actions button[data-primary="true"]:not(:disabled):hover { border-color: var(--attention-accent-hover); background: var(--attention-accent-hover); }
    .passage-hint { margin: 0 0 4px; color: var(--attention-muted); font-size: 11px; text-align: center; }
    .action-status { margin: 9px 0 0; color: var(--attention-muted); font-size: 12px; }
    .details { margin-block-start: 12px; border-block-start: 1px solid var(--attention-border); color: var(--attention-muted); font-size: 12px; }
    .details > summary { padding-block: 12px 2px; color: var(--attention-secondary); font-size: 12px; font-weight: 650; cursor: pointer; }
    .details[open] > summary { padding-block-end: 10px; }
    .decision-summary { color: var(--attention-fg); font-size: 14px; line-height: 1.5; }
    .score-detail { margin-block-start: 10px; font-size: 12px; }
    .analysis-controls { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-block-start: 12px; }
    .analysis-source { color: var(--attention-muted); font-size: 12px; }
    .analysis-source[data-source="ai"] { color: var(--attention-accent); font-weight: 650; }
    .ai-button { min-height: 34px; color: var(--attention-accent); }
    .reading-plan { margin-block-start: 14px; padding-block-start: 12px; border-block-start: 1px solid var(--attention-border); }
    .reading-plan-title { color: var(--attention-fg); font-size: 14px; font-weight: 650; line-height: 1.4; }
    .reading-plan ol { display: grid; gap: 7px; margin: 10px 0; padding: 0; list-style: none; }
    .reading-plan-section { display: grid; width: 100%; grid-template-columns: 22px minmax(0, 1fr); gap: 8px; align-items: center; text-align: start; font-size: 12px; }
    .reading-plan-section span:first-child { display: grid; width: 22px; height: 22px; place-items: center; border-radius: 5px; color: var(--attention-accent); background: var(--attention-inset-bg); font-size: 12px; font-weight: 750; }
    .highlight-sections-button { width: 100%; min-height: 36px; color: var(--attention-accent); font-size: 12px; }
    @media (prefers-color-scheme: light) {
      .card:not(.expanded) { border-color: #74aa8c; color: #155b3c; background: #eaf7ef; }
      .card:not(.expanded)[data-verdict="maybe"] { border-color: #a5b0a9; color: #3f4c45; background: #f1f4f2; }
      .card:not(.expanded)[data-verdict="skip"] { border-color: #cf9e9e; color: #8b3030; background: #fceeee; }
    }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
  `;
  const card = element('div', 'card');
  const header = element('div', 'card-header');
  const brand = element('span', 'card-brand');
  brand.textContent = 'Attention';
  const closeButton = button('close-button', '×');
  closeButton.setAttribute(
    'aria-label',
    cardText(DEFAULT_UI_LANGUAGE, 'close'),
  );
  header.append(brand, closeButton);
  const contextSlot = element('div', 'context-slot');
  const verdict = element('div', 'verdict');
  const score = element('div', 'score');
  const usefulTime = element('div', 'useful-time');
  const reliabilityNote = element('div', 'reliability-note');
  const actions = element('div', 'article-actions');
  const passagesButton = button('passages-button');
  passagesButton.hidden = true;
  const passageHint = element('p', 'passage-hint');
  passageHint.id = 'attention-passage-hint';
  passageHint.hidden = true;
  passagesButton.setAttribute('aria-describedby', passageHint.id);
  const saveButton = button(
    'save-button',
    cardText(DEFAULT_UI_LANGUAGE, 'saveForLater'),
  );
  saveButton.dataset.decision = 'save';
  saveButton.setAttribute('aria-live', 'polite');
  actions.append(passagesButton, passageHint, saveButton);
  const actionStatus = element('p', 'action-status');
  actionStatus.setAttribute('role', 'status');
  actionStatus.hidden = true;
  const details = element('details', 'details');
  const detailsSummary = element('summary', 'details-summary');
  detailsSummary.textContent = cardText(DEFAULT_UI_LANGUAGE, 'details');
  const decisionSummary = element('div', 'decision-summary');
  const scoreDetail = element('div', 'score-detail');
  const analysisControls = element('div', 'analysis-controls');
  const analysisSource = element('span', 'analysis-source');
  const aiButton = button('ai-button');
  analysisControls.append(analysisSource, aiButton);
  const readingPlan = element('section', 'reading-plan');
  const readingPlanTitle = element('div', 'reading-plan-title');
  const readingPlanSections = element('ol', 'reading-plan-sections');
  const highlightSectionsButton = button(
    'highlight-sections-button',
    readingPlanText(DEFAULT_UI_LANGUAGE, 'highlight'),
  );
  readingPlan.append(
    readingPlanTitle,
    readingPlanSections,
    highlightSectionsButton,
  );
  details.append(detailsSummary, decisionSummary, scoreDetail, readingPlan);
  card.append(
    header,
    contextSlot,
    verdict,
    score,
    usefulTime,
    reliabilityNote,
    analysisControls,
    actions,
    actionStatus,
    details,
  );
  shadow.append(style, card);
  document.documentElement.append(host);
  return {
    host,
    card,
    verdict,
    score,
    decisionSummary,
    usefulTime,
    reliabilityNote,
    analysisSource,
    aiButton,
    saveButton,
    passageHint,
    actionStatus,
    passagesButton,
    readingPlan,
    readingPlanTitle,
    readingPlanSections,
    highlightSectionsButton,
    details,
    detailsSummary,
    scoreDetail,
    closeButton,
    contextSlot,
  };
}
