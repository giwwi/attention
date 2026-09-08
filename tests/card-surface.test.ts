import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fullCardDecision,
  installHoverPreview,
} from '../src/content/hover-preview';
import { CardContextControl } from '../src/content/card-context';
import {
  ATTENTION_CONTEXT_UPDATE_TYPE,
  type ContextResponse,
} from '../src/shared/card-messages';
import {
  HOVER_PREVIEW_REQUEST_TYPE,
  type AnalysisContext,
  type HoverPreview,
  type HoverPreviewResponse,
} from '../src/shared/types';

const interaction = vi.hoisted(() => ({
  events: new WeakSet<Event>(),
  defaultSubmit: false,
}));
vi.mock('../src/content/user-interaction', () => ({
  isTrustedUserInteraction: (event: Event) =>
    interaction.events.has(event) ||
    (interaction.defaultSubmit && event.type === 'submit'),
}));

const context: AnalysisContext = {
  scenario: 'learn',
  availableMinutes: 30,
  intent: 'Understand the research method',
  relaxIntent: 'interesting',
  desiredEffort: 'medium',
  leisureFormats: ['essays'],
};
const emptyContext: AnalysisContext = {
  scenario: 'work',
  availableMinutes: 15,
  intent: '',
  relaxIntent: null,
  desiredEffort: null,
  leisureFormats: [],
};
let fixtureNumber = 0;
const controllers: AbortController[] = [];

function trusted<T extends Event>(event: T): T {
  interaction.events.add(event);
  return event;
}

function userClick(button: HTMLButtonElement): void {
  // jsdom generates the submit event as the click's default action. This
  // privileged predicate stub represents that native browser gesture only.
  interaction.defaultSubmit = true;
  try {
    button.dispatchEvent(
      trusted(new MouseEvent('click', { bubbles: true, cancelable: true })),
    );
  } finally {
    interaction.defaultSubmit = false;
  }
}

function element<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing card fixture element: ${selector}`);
  return found;
}

beforeEach(() => {
  vi.useFakeTimers();
  interaction.events = new WeakSet<Event>();
  interaction.defaultSubmit = false;
  const attachShadow = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    // Production remains closed. Only this unit test gets privileged inspection.
    return attachShadow.call(this, { ...init, mode: 'open' });
  });
  window.history.replaceState(
    {},
    '',
    `/article/card-surface-${++fixtureNumber}`,
  );
  document.title = 'A rigorous guide to evaluating research';
  document.body.innerHTML = `<main><article><h1>${document.title}</h1>
    <h2>Evidence</h2>${Array.from(
      { length: 12 },
      () =>
        '<p>This article explains how researchers compare observations with competing hypotheses. The method records practical evidence and exposes uncertainty before readers choose a conclusion. The authors describe useful examples and limitations of the research design.</p>',
    ).join(
      '',
    )}<h2>Practical implications</h2><p>Readers can compare the original evidence with the proposed interpretation.</p>
    </article></main>`;
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.abort();
  const global = globalThis as typeof globalThis & {
    __attentionHoverPreviewAbort?: AbortController;
  };
  global.__attentionHoverPreviewAbort?.abort();
  for (const key of [
    '__attentionHoverPreviewAbort',
    '__attentionHoverPreviewInstalled',
    '__attentionHoverPreviewVersion',
  ])
    Reflect.deleteProperty(globalThis, key);
  document.querySelector('[data-attention-preview="true"]')?.remove();
  document.body.replaceChildren();
  document.title = '';
  window.history.replaceState({}, '', '/');
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function previewResponse(
  action: HoverPreview['recommendedAction'] = 'maybe',
): HoverPreviewResponse {
  return {
    ok: true,
    context: structuredClone(context),
    analysisSource: 'local',
    // Omitted aiState exercises the unavailable-connection default.
    preview: {
      scenario: context.scenario,
      utilityScore: 67,
      recommendedAction: action,
      reason: 'A useful research method.',
      expectedValue: 'A practical way to compare the evidence.',
      risk: 'The result remains uncertain.',
      confidence: 'medium',
      source: 'full-analysis',
      signalIds: [],
      calibrationSampleSize: 0,
      recommendedSections: ['Evidence'],
      components: {
        relevance: 70,
        novelty: 60,
        actionability: 65,
        quality: 75,
      },
    },
  };
}

function runtime(response = previewResponse()) {
  const listeners = new Set<(message: unknown) => void>();
  let currentResponse = response;
  let requestPreview = async (): Promise<HoverPreviewResponse> =>
    currentResponse;
  let update = async (value: AnalysisContext): Promise<ContextResponse> => ({
    ok: true,
    context: value,
  });
  const sendMessage = vi.fn(
    async (message: { type: string; context?: AnalysisContext }) => {
      if (message.type === HOVER_PREVIEW_REQUEST_TYPE) return requestPreview();
      if (message.type === ATTENTION_CONTEXT_UPDATE_TYPE)
        return update(message.context!);
      return undefined;
    },
  );
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: (listener: (message: unknown) => void) =>
          listeners.add(listener),
        removeListener: (listener: (message: unknown) => void) =>
          listeners.delete(listener),
      },
    },
  });
  return {
    sendMessage,
    setResponse(value: HoverPreviewResponse) {
      currentResponse = value;
    },
    setPreview(value: typeof requestPreview) {
      requestPreview = value;
    },
    setUpdate(value: typeof update) {
      update = value;
    },
    invalidate(changedKeys: string[]) {
      for (const listener of listeners)
        listener({ type: 'ATTENTION_INPUTS/INVALIDATED', changedKeys });
    },
    updates: () =>
      sendMessage.mock.calls.filter(
        ([message]) => message.type === ATTENTION_CONTEXT_UPDATE_TYPE,
      ),
    previews: () =>
      sendMessage.mock.calls.filter(
        ([message]) => message.type === HOVER_PREVIEW_REQUEST_TYPE,
      ),
  };
}

async function openCard(response = previewResponse()) {
  const api = runtime(response);
  const controller = installHoverPreview({ getUiLanguage: () => 'en' });
  expect(await controller.openCurrentArticle()).toEqual({ ok: true });
  const host = element<HTMLElement>(
    document,
    '[data-attention-preview="true"]',
  );
  const shadow = host.shadowRoot;
  if (!shadow) throw new Error('Privileged test shadow root unavailable');
  return { api, controller, host, shadow };
}

describe('large article card surface', () => {
  it.each([
    {
      placement: 'right',
      title: [100, 100, 400, 80],
      card: [512, 100, 360, 400],
      gap: [506, 210],
      outside: [110, 480],
    },
    {
      placement: 'below',
      title: [100, 100, 400, 80],
      card: [100, 189, 360, 400],
      gap: [470, 185],
      outside: [490, 500],
    },
    {
      placement: 'above',
      title: [100, 500, 400, 80],
      card: [100, 91, 360, 400],
      gap: [470, 495],
      outside: [490, 150],
    },
  ])(
    'keeps the $placement card reachable across the gap in both directions',
    async ({ title: titleRect, card: cardRect, gap, outside }) => {
      const api = runtime();
      const title = element<HTMLElement>(document, 'h1');
      const rect = ([x = 0, y = 0, width = 0, height = 0]: number[]) =>
        new DOMRect(x, y, width, height);
      vi.spyOn(title, 'getBoundingClientRect').mockReturnValue(rect(titleRect));
      installHoverPreview({ getUiLanguage: () => 'en' });
      const pointer = (
        target: Element,
        type: string,
        point: number[],
        relatedTarget?: EventTarget,
      ) =>
        target.dispatchEvent(
          new MouseEvent(type, {
            bubbles: type !== 'pointerenter' && type !== 'pointerleave',
            clientX: point[0],
            clientY: point[1],
            relatedTarget,
          }),
        );
      const titlePoint = [titleRect[0]! + 200, titleRect[1]! + 40];
      pointer(title, 'pointerover', titlePoint);
      await vi.advanceTimersByTimeAsync(150);
      const host = element<HTMLElement>(document, '[data-attention-preview]');
      expect(host.style.display).toBe('block');
      vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect(cardRect));

      pointer(title, 'pointerout', gap, document.body);
      pointer(document.body, 'pointerover', gap);
      pointer(document.body, 'pointermove', gap);
      await vi.advanceTimersByTimeAsync(700);
      expect(host.style.display).toBe('block');
      pointer(host, 'pointerenter', [cardRect[0]! + 30, cardRect[1]! + 150]);
      await vi.advanceTimersByTimeAsync(700);
      expect(host.style.display).toBe('block');

      pointer(host, 'pointerleave', gap, document.body);
      pointer(document.body, 'pointerover', gap);
      pointer(document.body, 'pointermove', gap);
      await vi.advanceTimersByTimeAsync(700);
      expect(host.style.display).toBe('block');
      pointer(title, 'pointerover', titlePoint);
      await vi.advanceTimersByTimeAsync(700);
      expect(host.style.display).toBe('block');
      expect(api.previews()).toHaveLength(1);

      // Empty corners of the surrounding bounding box are not part of the
      // transition region. Movement there must not extend the dismissal timer.
      pointer(title, 'pointerout', outside, document.body);
      for (let step = 0; step < 6; step += 1) {
        pointer(document.body, 'pointermove', [
          outside[0]! + step,
          outside[1]!,
        ]);
        await vi.advanceTimersByTimeAsync(100);
      }
      expect(host.style.display).toBe('none');
    },
  );

  it('keeps popup OPEN pending until the render scheduled by input invalidation succeeds', async () => {
    const api = runtime();
    const responses: ((response: HoverPreviewResponse) => void)[] = [];
    api.setPreview(() => new Promise((resolve) => responses.push(resolve)));
    const controller = installHoverPreview({ getUiLanguage: () => 'en' });
    const opened = controller.openCurrentArticle();
    const settled = vi.fn();
    void opened.then(settled);
    expect(api.previews()).toHaveLength(1);
    api.invalidate(['analysisContext', 'attentionScenario']);
    responses[0]!(previewResponse());
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(api.previews()).toHaveLength(2);
    responses[1]!(previewResponse('open'));
    expect(await opened).toEqual({ ok: true });
    expect(
      element<HTMLElement>(document, '[data-attention-preview]').style.display,
    ).toBe('block');
    expect(settled).toHaveBeenCalledOnce();
    expect(api.updates()).toHaveLength(0);
  });

  it.each(['erase', 'route', 'close'] as const)(
    'cancels a pending popup OPEN on %s without reopening from its stale response',
    async (action) => {
      const api = runtime();
      let resolve!: (response: HoverPreviewResponse) => void;
      api.setPreview(
        () =>
          new Promise((complete) => {
            resolve = complete;
          }),
      );
      const controller = installHoverPreview({ getUiLanguage: () => 'en' });
      const opened = controller.openCurrentArticle();
      const host = element<HTMLElement>(document, '[data-attention-preview]');
      if (action === 'erase') api.invalidate(['attentionDataGeneration']);
      else if (action === 'route') {
        window.history.pushState({}, '', '/article/another-route');
        window.dispatchEvent(new PopStateEvent('popstate'));
      } else {
        userClick(
          element<HTMLButtonElement>(host.shadowRoot!, '.close-button'),
        );
      }
      expect(await opened).toEqual({ ok: false, reason: 'unavailable' });
      resolve(previewResponse());
      await vi.advanceTimersByTimeAsync(600);
      expect(host.style.display).toBe('none');
      expect(api.previews()).toHaveLength(1);
    },
  );

  it.each([
    ['open', 'read'],
    ['maybe', 'skim'],
    ['save', 'save'],
    ['skip', 'skip'],
  ] as const)(
    'renders %s as a distinct %s decision without a headline percentage',
    async (action, decision) => {
      const response = previewResponse(action);
      expect(fullCardDecision(response.preview)).toBe(decision);
      const { api, host, shadow } = await openCard(response);
      expect(api.previews()).toHaveLength(1);
      expect(host.style.display).toBe('block');
      expect(host.dataset.attentionSource).toBe('full-analysis');
      expect(host.getAttribute('role')).toBe('dialog');
      expect(host.dataset.attentionDecision).toBe(decision);
      const headline = element<HTMLElement>(shadow, '.verdict');
      expect(headline.textContent).not.toMatch(/\d|%/u);
      expect(headline.textContent?.length).toBeGreaterThan(3);
      const details = element<HTMLDetailsElement>(shadow, 'details.details');
      expect(details.open).toBe(false);
      expect(
        element<HTMLElement>(details, '.score-detail').textContent,
      ).toContain('67');
      const actions = element<HTMLElement>(shadow, '.decision-actions');
      expect((actions.firstElementChild as HTMLElement).dataset.decision).toBe(
        decision,
      );
      expect(
        shadow.querySelectorAll('.decision-actions [data-primary="true"]'),
      ).toHaveLength(1);
      const ai = element<HTMLButtonElement>(shadow, '.ai-button');
      expect(ai.hidden).toBe(false);
      expect(ai.disabled).toBe(true);
      expect(ai.textContent).toBe('AI is not connected');
      expect(ai.closest('details')).toBeNull();
      expect(
        element<HTMLSelectElement>(shadow, '.context-scenario').value,
      ).toBe('learn');
      expect(element<HTMLSelectElement>(shadow, '.context-minutes').value).toBe(
        '30',
      );
      expect(element<HTMLInputElement>(shadow, '.context-intent').value).toBe(
        context.intent,
      );
      expect(
        element<HTMLElement>(shadow, '.context-summary').textContent,
      ).toContain(context.intent);
    },
  );

  it('exposes the AI action, retry and completed status without opening details', async () => {
    const { api, shadow } = await openCard({
      ...previewResponse(),
      aiState: 'ready',
    });
    const details = element<HTMLDetailsElement>(shadow, 'details.details');
    const controls = element<HTMLElement>(shadow, '.analysis-controls');
    const source = element<HTMLElement>(shadow, '.analysis-source');
    const ai = element<HTMLButtonElement>(shadow, '.ai-button');
    expect(details.open).toBe(false);
    expect(controls.closest('details')).toBeNull();
    expect(ai.hidden).toBe(false);
    expect(ai.disabled).toBe(false);
    expect(ai.textContent).toBe('Check with AI');
    expect(source.textContent).toBe('Local evaluation');
    expect(api.previews()).toHaveLength(1);

    ai.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.previews()).toHaveLength(1);

    let resolve!: (response: HoverPreviewResponse) => void;
    api.setPreview(
      () =>
        new Promise((complete) => {
          resolve = complete;
        }),
    );
    userClick(ai);
    expect(api.previews()).toHaveLength(2);
    expect(api.previews()[1]?.[0]).toEqual(
      expect.objectContaining({ analysisMode: 'ai' }),
    );
    expect(ai.disabled).toBe(true);
    expect(ai.textContent).toBe('AI is analyzing…');
    expect(details.open).toBe(false);

    resolve({ ...previewResponse(), aiState: 'error' });
    await vi.advanceTimersByTimeAsync(0);
    expect(ai.hidden).toBe(false);
    expect(ai.disabled).toBe(false);
    expect(ai.textContent).toBe('Retry with AI');
    expect(source.textContent).toBe('Local evaluation');
    expect(details.open).toBe(false);

    api.setPreview(async () => ({
      ...previewResponse(),
      aiState: 'ready',
      analysisSource: 'ai',
    }));
    userClick(ai);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.previews()).toHaveLength(3);
    expect(source.textContent).toBe('Checked with AI ✓');
    expect(source.dataset.source).toBe('ai');
    expect(ai.hidden).toBe(true);
    expect(ai.disabled).toBe(true);
    expect(details.open).toBe(false);
  });

  it('shows the local-only restriction without enabling an AI request', async () => {
    const { api, shadow } = await openCard({
      ...previewResponse(),
      aiState: 'local-only',
    });
    const ai = element<HTMLButtonElement>(shadow, '.ai-button');
    expect(ai.hidden).toBe(false);
    expect(ai.disabled).toBe(true);
    expect(ai.textContent).toBe('Unavailable in local-only mode');
    expect(ai.closest('details')).toBeNull();
    userClick(ai);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.previews()).toHaveLength(1);
  });

  it('preserves open details and focus on a visible context control during re-evaluation', async () => {
    const { api, host, shadow } = await openCard();
    const details = element<HTMLDetailsElement>(shadow, 'details.details');
    const contextDetails = element<HTMLDetailsElement>(shadow, '.card-context');
    const intent = element<HTMLInputElement>(shadow, '.context-intent');
    details.open = true;
    contextDetails.open = true;
    intent.focus();
    expect(shadow.activeElement).toBe(intent);
    api.invalidate(['analysisContext']);
    await vi.advanceTimersByTimeAsync(600);
    expect(api.previews()).toHaveLength(2);
    expect(host.style.display).toBe('block');
    expect(details.open).toBe(true);
    expect(contextDetails.open).toBe(true);
    expect(shadow.activeElement).toBe(intent);
  });

  it('does not restore a control inside collapsed details as the focus target', async () => {
    const { api, shadow } = await openCard();
    const details = element<HTMLDetailsElement>(shadow, 'details.details');
    const highlight = element<HTMLButtonElement>(
      shadow,
      '.highlight-sections-button',
    );
    details.open = true;
    highlight.focus();
    details.open = false;
    api.invalidate(['analysisContext']);
    await vi.advanceTimersByTimeAsync(600);
    expect(details.open).toBe(false);
    expect(shadow.activeElement).toBe(
      element(shadow, '[data-decision="skim"]'),
    );
  });

  it('cannot reopen or restore an erased card from a pending context response', async () => {
    const { api, controller, host, shadow } = await openCard();
    let resolve!: (value: ContextResponse) => void;
    api.setUpdate(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const contextDetails = element<HTMLDetailsElement>(shadow, '.card-context');
    contextDetails.open = true;
    const intent = element<HTMLInputElement>(shadow, '.context-intent');
    intent.value = 'Private unfinished task before deletion';
    intent.dispatchEvent(trusted(new Event('input', { bubbles: true })));
    userClick(element<HTMLButtonElement>(shadow, '.context-apply'));
    expect(api.updates()).toHaveLength(1);
    expect(intent.disabled).toBe(true);
    api.invalidate(['attentionDataGeneration']);
    expect(host.style.display).toBe('none');
    expect(contextDetails.open).toBe(false);
    const summary = element<HTMLElement>(shadow, '.context-summary');
    expect(intent.value).toBe('');
    expect(summary.textContent).toBe('');
    expect(summary.hasAttribute('title')).toBe(false);
    expect(summary.hasAttribute('aria-label')).toBe(false);
    expect(element<HTMLSelectElement>(shadow, '.context-scenario').value).toBe(
      'work',
    );
    expect(element<HTMLSelectElement>(shadow, '.context-minutes').value).toBe(
      '15',
    );
    resolve({
      ok: true,
      context: {
        ...context,
        intent: 'Private unfinished task before deletion',
      },
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(host.style.display).toBe('none');
    expect(api.previews()).toHaveLength(1);
    expect(intent.value).toBe('');
    expect(summary.textContent).toBe('');
    // Only a new explicit open can populate the card with the new generation.
    api.setResponse({ ...previewResponse(), context: emptyContext });
    expect(await controller.openCurrentArticle()).toEqual({ ok: true });
    expect(intent.value).toBe('');
    expect(api.previews()).toHaveLength(2);
  });
});

function contextEditor() {
  const slot = document.createElement('div');
  document.body.append(slot);
  const controller = new AbortController();
  controllers.push(controller);
  const save = vi.fn(async (value: AnalysisContext) => value);
  const control = new CardContextControl(slot, save, controller.signal);
  control.render(context, 'en');
  control.details.open = true;
  return {
    save,
    form: element<HTMLFormElement>(slot, '.context-form'),
    apply: element<HTMLButtonElement>(slot, '.context-apply'),
    intent: element<HTMLInputElement>(slot, '.context-intent'),
    select: element<HTMLSelectElement>(slot, '.context-scenario'),
    summary: element<HTMLElement>(slot, '.context-summary'),
  };
}

describe('card context user gesture boundary', () => {
  it('does not arm form submission when Enter selects a context option', async () => {
    const { save, form, select, apply } = contextEditor();
    const enter = trusted(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
    select.dispatchEvent(enter);
    // The native select still commits its chosen option. Any implicit click
    // on the default submit button must not apply the whole context form.
    expect(enter.defaultPrevented).toBe(false);
    userClick(apply);
    form.dispatchEvent(
      trusted(new SubmitEvent('submit', { bubbles: true, cancelable: true })),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(save).not.toHaveBeenCalled();
  });

  it('moves focus to the context summary before disabling a pending form', async () => {
    const { save, apply, intent, summary } = contextEditor();
    let resolve!: (context: AnalysisContext) => void;
    save.mockImplementation(
      () =>
        new Promise((complete) => {
          resolve = complete;
        }),
    );
    intent.focus();
    userClick(apply);
    expect(document.activeElement).toBe(summary);
    expect(intent.disabled).toBe(true);
    resolve(context);
    await vi.advanceTimersByTimeAsync(0);
  });

  it.each(['click', 'Enter'] as const)(
    'accepts a context submission following a trusted %s gesture',
    async (gesture) => {
      const { save, form, apply, intent } = contextEditor();
      intent.value = 'Review the practical evidence';
      intent.dispatchEvent(trusted(new Event('input', { bubbles: true })));
      if (gesture === 'click') userClick(apply);
      else {
        intent.dispatchEvent(
          trusted(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              bubbles: true,
              cancelable: true,
            }),
          ),
        );
        form.dispatchEvent(
          trusted(
            new SubmitEvent('submit', { bubbles: true, cancelable: true }),
          ),
        );
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(save).toHaveBeenCalledExactlyOnceWith({
        ...context,
        intent: intent.value,
      });
    },
  );

  it('rejects synthetic submit, click, Enter and unarmed requestSubmit', async () => {
    const { save, form, apply, intent } = contextEditor();
    intent.value = 'A page script must not change this context';
    form.dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, cancelable: true }),
    );
    apply.click();
    intent.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
    // Even a browser-created submit event from requestSubmit is insufficient
    // without the preceding accepted click/Enter gesture in the private form.
    interaction.defaultSubmit = true;
    form.requestSubmit();
    interaction.defaultSubmit = false;
    await vi.advanceTimersByTimeAsync(0);
    expect(save).not.toHaveBeenCalled();
  });
});
