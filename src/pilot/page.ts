import {
  initializeVaultPage,
  installVaultLockControl,
} from '../vault/page-guard';
import { privateStorageChanges } from '../vault/storage';
import {
  CAPTURE_MESSAGE_TYPE,
  type MaterialDecision,
  type MaterialEvaluation,
  type PageCapture,
} from '../shared/types';
import { isPageCapture } from '../popup/guards';
import {
  DATA_GENERATION_KEY,
  assertDataOperationCurrent,
  withAttentionDataLock,
  type DataOperation,
} from '../privacy/data-operations';
import { analyzePilotArticle } from './analyze';
import {
  exportPilot,
  pilotMetrics,
  pilotAuditInvited,
  PILOT_STORAGE_KEY,
  type PilotState,
  type PilotTrial,
} from './model';
import { enrollPilot, erasePilot, loadPilot, savePilotTrial } from './storage';
import { pilotMessage, translatePilot } from './copy';

await initializeVaultPage();

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing pilot element ${id}`);
  return found as T;
}
let language: 'ru' | 'en' = 'ru';
let participation: { state: PilotState; operation: DataOperation } | null =
  null;
let capture: PageCapture | null = null;
let trial: PilotTrial | null = null;
let evaluation: MaterialEvaluation | null = null;
let goal = '';
let baselineStarted = 0;
let attentionStarted = 0;
let revision = 0;
let armAttempt: symbol | null = null;
let summaryRevision = 0;
let lastStatus: [string, string] = ['', ''];
const message = (ru: string, en: string) => pilotMessage(language, ru, en);
const status = (ru: string, en: string) => {
  lastStatus = [ru, en];
  element('pilot-status').textContent = message(ru, en);
};
const decisions: MaterialDecision[] = ['read', 'skim', 'save', 'skip'];
const decisionLabel = (decision: MaterialDecision) =>
  ({
    read: message('Читать', 'Read'),
    skim: message('Просмотреть', 'Skim'),
    save: message('Сохранить', 'Save'),
    skip: message('Пропустить', 'Skip'),
  })[decision];

function panel(id: string): void {
  element('back-to-setup').hidden =
    id !== 'baseline-panel' && id !== 'attention-panel';
  for (const name of ['consent', 'setup', 'baseline', 'attention', 'review'])
    element(`${name}-panel`).hidden = `${name}-panel` !== id;
  const heading = element(id).querySelector<HTMLElement>('h2');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
}

async function current(expectedRevision: number): Promise<void> {
  if (!participation || revision !== expectedRevision)
    throw new Error('Pilot state changed');
  await assertDataOperationCurrent(participation.operation);
  if (
    (await loadPilot())?.participantId !== participation.state.participantId ||
    revision !== expectedRevision
  )
    throw new Error('Pilot state changed');
}

async function summary(): Promise<void> {
  const activeRevision = revision;
  const request = ++summaryRevision;
  const state = await loadPilot();
  if (activeRevision !== revision || request !== summaryRevision) return;
  const metrics = pilotMetrics(state?.trials ?? []);
  element('pilot-summary').textContent = message(
    `Материалов: ${metrics.trials}. Отзывов: ${metrics.reviewCoverage.numerator}. Проверено Skip Attention: ${metrics.attention.skipReviewCoverage.numerator} из ${metrics.attention.skipReviewCoverage.denominator}; ошибочных: ${metrics.attention.falseSkip.numerator}. Без отзыва результат неизвестен.`,
    `Articles: ${metrics.trials}. Reviews: ${metrics.reviewCoverage.numerator}. Attention skips reviewed: ${metrics.attention.skipReviewCoverage.numerator} of ${metrics.attention.skipReviewCoverage.denominator}; false skips: ${metrics.attention.falseSkip.numerator}. Unreviewed outcomes are unknown.`,
  );
  element<HTMLButtonElement>('export-pilot').disabled = !state;
}

async function refreshTabs(): Promise<void> {
  const activeRevision = revision;
  const select = element<HTMLSelectElement>('article-tab');
  const tabs = await chrome.tabs.query({ currentWindow: true });
  if (activeRevision !== revision) return;
  select.replaceChildren();
  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url || !/^https?:\/\//u.test(tab.url))
      continue;
    select.add(
      new Option(tab.title ?? new URL(tab.url).hostname, String(tab.id)),
    );
  }
  const supplied = new URL(location.href).searchParams.get('sourceTab');
  if (
    supplied &&
    [...select.options].some((option) => option.value === supplied)
  )
    select.value = supplied;
}

function reset(): void {
  revision += 1;
  armAttempt = null;
  capture = null;
  trial = null;
  evaluation = null;
  goal = '';
  element('review-text').textContent = '';
  element('article-title').textContent = '';
  element('trial-goal').textContent = '';
  element('article-tab').replaceChildren();
  element('pilot-sections').replaceChildren();
  element('pilot-reason').textContent = '';
  element('pilot-recommendation').textContent = '';
  element('retry-analysis').hidden = true;
  element<HTMLInputElement>('pilot-goal').value = '';
  element<HTMLInputElement>('unseen').checked = false;
  element<HTMLInputElement>('reviewed').checked = false;
  for (const id of ['material-useful', 'baseline-helpful', 'attention-helpful'])
    element<HTMLSelectElement>(id).value = '';
  element('review-panel').querySelector('details')!.open = false;
  updateActionAvailability();
}

function updateActionAvailability(): void {
  for (const arm of ['baseline', 'attention']) {
    for (const button of element(
      `${arm}-actions`,
    ).querySelectorAll<HTMLButtonElement>('button'))
      button.disabled =
        armAttempt !== null ||
        (arm === 'baseline' ? trial !== null : trial?.attention != null);
  }
  element<HTMLButtonElement>('retry-analysis').disabled = armAttempt !== null;
  element<HTMLSelectElement>('pilot-language').disabled = armAttempt !== null;
}

function bind(id: string, handler: () => Promise<void>): void {
  const button = element<HTMLButtonElement>(id);
  button.addEventListener('click', (event) => {
    if (!event.isTrusted || button.disabled) return;
    const isArm = /^(?:baseline-|attention-|retry-analysis)/u.test(id);
    if (isArm && armAttempt) return;
    const attempt = Symbol();
    if (isArm) {
      armAttempt = attempt;
      updateActionAvailability();
    }
    button.disabled = true;
    void handler()
      .catch(() =>
        status(
          'Действие не завершено. Проверьте согласие, поля и доступ к статье. Уже включённый материал повторно не добавляется. После удаления начните участие заново.',
          'Action could not finish. Check consent, fields and article access. Previously included articles cannot be added again. Rejoin after erasure.',
        ),
      )
      .finally(() => {
        button.disabled = false;
        if (isArm && armAttempt === attempt) armAttempt = null;
        updateActionAvailability();
      });
  });
}

async function revealAttention(activeRevision: number): Promise<void> {
  await current(activeRevision);
  if (!capture || !trial) return;
  element('retry-analysis').hidden = false;
  status('Вычисляю локальную оценку…', 'Calculating the local assessment…');
  const result = await analyzePilotArticle(
    capture,
    goal,
    trial.personalContextUsed,
  );
  await current(activeRevision);
  evaluation = result;
  element('retry-analysis').hidden = true;
  element('pilot-recommendation').textContent =
    `${decisionLabel(evaluation.recommendedAction)} · ${evaluation.utilityScore}/100`;
  element('pilot-reason').textContent = message(
    `Релевантность: ${evaluation.components.relevance}/100. Качество: ${evaluation.components.quality}/100. Это приблизительная локальная оценка.`,
    `Relevance: ${evaluation.components.relevance}/100. Quality: ${evaluation.components.quality}/100. This is an approximate local assessment.`,
  );
  element('pilot-sections').replaceChildren(
    ...evaluation.recommendedSections.map((section) => {
      const item = document.createElement('li');
      item.textContent = section;
      return item;
    }),
  );
  panel('attention-panel');
  status(
    'Оценка готова. Выберите своё действие.',
    'Assessment ready. Choose your action.',
  );
}

function renderActions(): void {
  for (const arm of ['baseline', 'attention'] as const) {
    const container = element(`${arm}-actions`);
    container.replaceChildren();
    for (const decision of decisions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = decisionLabel(decision);
      button.id = `${arm}-${decision}`;
      container.append(button);
      bind(button.id, async () => {
        const activeRevision = revision;
        await current(activeRevision);
        if (!capture || !participation) return;
        if (arm === 'baseline') {
          if (trial) return;
          const decisionMs = Math.round(performance.now() - baselineStarted);
          const bytes = new TextEncoder().encode(
            `${participation.state.participantId}\n${capture.url}\n${capture.content}`,
          );
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          await current(activeRevision);
          const nextTrial: PilotTrial = {
            id: crypto.randomUUID(),
            materialFingerprint: Array.from(new Uint8Array(digest), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join(''),
            scenario: 'work',
            availableMinutes: 15,
            personalContextUsed:
              element<HTMLInputElement>('use-context').checked,
            baseline: { decision, decisionMs },
            attention: null,
            auditInvited:
              crypto.getRandomValues(new Uint32Array(1))[0]! < 0x40000000,
            review: null,
          };
          const saved = await savePilotTrial(
            participation.state.participantId,
            participation.operation,
            nextTrial,
          );
          await current(activeRevision);
          participation.state = saved;
          trial = nextTrial;
          // Includes local analysis latency, but follows baseline exposure.
          attentionStarted = performance.now();
          await revealAttention(activeRevision);
        } else {
          if (!trial || trial.attention || !evaluation?.prediction) return;
          const nextTrial: PilotTrial = {
            ...trial,
            attention: {
              recommendation: evaluation.recommendedAction,
              decision,
              decisionMs: Math.round(performance.now() - attentionStarted),
              sinceEnrollmentMs: Math.max(
                0,
                Date.now() - participation.state.enrolledAt,
              ),
              prediction: evaluation.prediction,
            },
          };
          const saved = await savePilotTrial(
            participation.state.participantId,
            participation.operation,
            nextTrial,
          );
          await current(activeRevision);
          participation.state = saved;
          trial = nextTrial;
          element('review-text').textContent = capture.content;
          element('audit-invitation').hidden = !pilotAuditInvited(trial);
          panel('review-panel');
          status(
            'Решения сохранены. Отзыв необязателен.',
            'Decisions saved. Feedback is optional.',
          );
        }
        await summary();
      });
    }
  }
  updateActionAvailability();
}

bind('enroll', async () => {
  const activeRevision = revision;
  const enrolled = await enrollPilot(
    element<HTMLInputElement>('consent').checked,
  );
  if (revision !== activeRevision) return;
  participation = enrolled;
  await refreshTabs();
  await current(activeRevision);
  panel('setup-panel');
  await summary();
  status(
    'Участие включено только здесь.',
    'Participation is enabled only here.',
  );
});
bind('retry-analysis', () => revealAttention(revision));
bind('refresh-tabs', refreshTabs);
bind('start-trial', async () => {
  const activeRevision = revision;
  await current(activeRevision);
  goal = element<HTMLInputElement>('pilot-goal').value.trim();
  if (!goal || !element<HTMLInputElement>('unseen').checked)
    throw new Error('Missing task or eligibility confirmation');
  const tabId = Number(element<HTMLSelectElement>('article-tab').value);
  if (!Number.isInteger(tabId) || tabId <= 0)
    throw new Error('Missing article');
  const response: unknown = await chrome.tabs.sendMessage(tabId, {
    type: CAPTURE_MESSAGE_TYPE,
  });
  await current(activeRevision);
  const candidate = (response as { capture?: unknown })?.capture;
  if (
    !isPageCapture(candidate) ||
    !candidate.isArticle ||
    candidate.wordCount < 80 ||
    candidate.wordCount > 10_000
  )
    throw new Error('Unsupported article');
  capture = candidate;
  element('article-title').textContent = candidate.title;
  element('trial-goal').textContent = goal;
  panel('baseline-panel');
  baselineStarted = performance.now();
  status(
    'Пока используется только заголовок и ваша цель.',
    'Only the title and your goal are shown.',
  );
});
bind('save-review', async () => {
  const activeRevision = revision;
  await current(activeRevision);
  if (
    !participation ||
    !trial?.attention ||
    !element<HTMLInputElement>('reviewed').checked
  )
    throw new Error('Review required');
  const useful = element<HTMLSelectElement>('material-useful').value;
  if (useful !== 'yes' && useful !== 'partial' && useful !== 'no')
    throw new Error('Usefulness required');
  const helpful = (id: string) =>
    element<HTMLSelectElement>(id).value === ''
      ? null
      : element<HTMLSelectElement>(id).value === 'yes';
  const nextTrial: PilotTrial = {
    ...trial,
    review: {
      materialUseful: useful,
      baselineHelpful: helpful('baseline-helpful'),
      attentionHelpful: helpful('attention-helpful'),
      source: !element('audit-invitation').hidden
        ? 'audit-invitation'
        : 'volunteered',
    },
  };
  const saved = await savePilotTrial(
    participation.state.participantId,
    participation.operation,
    nextTrial,
  );
  await current(activeRevision);
  participation.state = saved;
  trial = nextTrial;
  await summary();
  status(
    'Спасибо. Отзыв сохранён локально и не отправлен.',
    'Feedback saved locally. Nothing was sent.',
  );
});
bind('next-trial', async () => {
  reset();
  const activeRevision = revision;
  await refreshTabs();
  await current(activeRevision);
  panel('setup-panel');
});
bind('back-to-setup', async () => {
  reset();
  const activeRevision = revision;
  await refreshTabs();
  await current(activeRevision);
  panel('setup-panel');
});
bind('erase-pilot', async () => {
  reset();
  participation = null;
  await erasePilot();
  element<HTMLInputElement>('consent').checked = false;
  panel('consent-panel');
  await summary();
  status(
    'Участие завершено, результаты пилота удалены.',
    'Participation ended and pilot results erased.',
  );
});
bind('export-pilot', async () => {
  const activeRevision = revision;
  await withAttentionDataLock(async () => {
    const state = await loadPilot();
    if (!state || revision !== activeRevision) return;
    const blob = new Blob([JSON.stringify(exportPilot(state), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'attention-voluntary-pilot.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
});
element<HTMLSelectElement>('pilot-language').addEventListener('change', () => {
  language =
    element<HTMLSelectElement>('pilot-language').value === 'en' ? 'en' : 'ru';
  translatePilot(language);
  renderActions();
  status(...lastStatus);
  void summary();
  if (evaluation) {
    element('pilot-recommendation').textContent =
      `${decisionLabel(evaluation.recommendedAction)} · ${evaluation.utilityScore}/100`;
    element('pilot-reason').textContent = message(
      `Релевантность: ${evaluation.components.relevance}/100. Качество: ${evaluation.components.quality}/100. Это приблизительная локальная оценка.`,
      `Relevance: ${evaluation.components.relevance}/100. Quality: ${evaluation.components.quality}/100. This is an approximate local assessment.`,
    );
  }
});
privateStorageChanges.addListener((changes, area) => {
  if (area !== 'local') return;
  if (
    changes[DATA_GENERATION_KEY] ||
    (changes[PILOT_STORAGE_KEY] && !changes[PILOT_STORAGE_KEY].newValue)
  ) {
    reset();
    participation = null;
    element<HTMLInputElement>('consent').checked = false;
    panel('consent-panel');
    status(
      'Данные удалены. Для продолжения нужно новое согласие.',
      'Data erased. New consent is required to continue.',
    );
  }
  if (changes[PILOT_STORAGE_KEY]) void summary();
});
translatePilot(language);
renderActions();
void summary();

installVaultLockControl();
