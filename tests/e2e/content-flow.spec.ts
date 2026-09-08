import { initializeTestProfile } from './helpers/profile';
import { createTestExtension, initializeTestVault } from './helpers/vault';
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  cardTextContent,
  clickCardElement,
  shadowElementState,
} from './helpers/card';

let context: BrowserContext;
let page: Page;
let worker: Worker;
let directory: string;
const url = 'http://127.0.0.1:4317/attention-essay.html';
const title = 'Evidence and practical methods for allocating attention';
const html = `<!doctype html><html lang="en"><head><title>${title}</title><style>body{font:18px/1.5 system-ui;margin:0}article{max-width:760px;margin:50px auto}h1{font-size:34px}aside{display:none}</style></head><body><article><h1>${title}</h1><h2>Practical evidence</h2>${'<p>This article explains a concrete method for allocating attention. It presents evidence, a causal mechanism, practical steps, limitations, and examples that make the argument testable and useful.</p>'.repeat(24)}<h2>Conclusion</h2><p>Test the method with explicit feedback and compare results with the original predictions.</p></article></body></html>`;

test.beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'attention-content-flow-'));
  const extension = await createTestExtension(directory);
  context = await chromium.launchPersistentContext(directory, {
    channel: 'chromium',
    headless: process.env.HEADED !== 'true',
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  await initializeTestVault(context);
  await initializeTestProfile(context);
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  await context.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url);
});

test.afterEach(async () => {
  await context.close();
  await rm(directory, { recursive: true, force: true });
});

interface DomNode {
  backendNodeId: number;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: DomNode[];
}

async function clickCardButton(
  attribute: string,
  value: string,
  hostAttribute = 'data-attention-preview',
): Promise<void> {
  const cdp = await context.newCDPSession(page);
  try {
    const flatten = (node: DomNode): DomNode[] => [
      node,
      ...(node.children ?? []).flatMap(flatten),
      ...(node.shadowRoots ?? []).flatMap(flatten),
    ];
    let center = { x: 0, y: 0 };
    // A saved-material invalidation can briefly hide and redraw the card.
    // Reacquire its visible geometry, as a locator click would; never force a
    // hidden control or retry the state-changing click itself.
    await expect(async () => {
      const { root } = await cdp.send('DOM.getDocument', {
        depth: -1,
        pierce: true,
      });
      const host = flatten(root).find((node) =>
        node.attributes?.includes(hostAttribute),
      );
      const target =
        host &&
        flatten(host).find((node) => {
          const index = node.attributes?.indexOf(attribute) ?? -1;
          return (
            index >= 0 &&
            (attribute === 'class'
              ? node.attributes?.[index + 1]?.split(' ').includes(value)
              : node.attributes?.[index + 1] === value)
          );
        });
      expect(target, `card button ${attribute}=${value}`).toBeTruthy();
      const { model } = await cdp.send('DOM.getBoxModel', {
        backendNodeId: target!.backendNodeId,
      });
      expect(model.width).toBeGreaterThan(0);
      expect(model.height).toBeGreaterThan(0);
      center = {
        x: (model.content[0] + model.content[4]) / 2,
        y: (model.content[1] + model.content[5]) / 2,
      };
    }).toPass({ timeout: 5000 });
    await page.mouse.click(center.x, center.y);
  } finally {
    await cdp.detach();
  }
}

async function openCard(): Promise<void> {
  await page.locator('[data-attention-trigger]').scrollIntoViewIfNeeded();
  await page.locator('[data-attention-trigger]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-attention-preview]')).toHaveCSS(
    'display',
    'block',
  );
}

test('opens an ordinary article with the keyboard and closes with Escape', async () => {
  const trigger = page.locator('[data-attention-trigger]');
  await trigger.evaluate((button: HTMLButtonElement) => button.click());
  // Let the preview delay elapse so a rejected synthetic activation cannot
  // accidentally pass the assertion before its asynchronous request runs.
  await page.waitForTimeout(400);
  await expect(page.locator('[data-attention-preview]')).toHaveCSS(
    'display',
    'none',
  );
  await openCard();
  const card = page.locator('[data-attention-preview]');
  await expect(card).toHaveAttribute('data-attention-source', 'full-analysis');
  expect(
    await page.evaluate(() =>
      document.activeElement?.hasAttribute('data-attention-preview'),
    ),
  ).toBe(true);
  await page.keyboard.press('Tab');
  await expect(card).toHaveCSS('display', 'block');
  await page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  await expect(card).toHaveCSS('display', 'block');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCSS('display', 'none');
  await expect(page.locator('[data-attention-trigger]')).toBeFocused();
});

for (const placement of ['right', 'below', 'above'] as const) {
  test(`hover card stays reachable across a slow diagonal ${placement} transition`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addStyleTag({
      content: `article { width: ${placement === 'right' ? 500 : 900}px; max-width: none; margin: ${placement === 'above' ? 650 : 60}px 0 0 50px; } h1 { margin: 0; font-size: 28px; }`,
    });
    const heading = page.locator('h1');
    await page.locator('[data-attention-trigger]').waitFor();
    await heading.hover();
    const card = page.locator('[data-attention-preview]');
    await expect(card).toHaveCSS('display', 'block');
    // The mouse, not a launcher click or keyboard focus, must keep it open.
    expect(
      await page.evaluate(() =>
        document.activeElement?.hasAttribute('data-attention-preview'),
      ),
    ).toBe(false);
    const titleBox = (await heading.boundingBox())!;
    const box = (await card.boundingBox())!;
    const gap =
      placement === 'right'
        ? {
            x: (titleBox.x + titleBox.width + box.x) / 2,
            y: (titleBox.y + titleBox.height + box.y + box.height) / 2 - 10,
          }
        : {
            x: (titleBox.x + titleBox.width + box.x + box.width) / 2 - 10,
            y:
              placement === 'below'
                ? (titleBox.y + titleBox.height + box.y) / 2
                : (box.y + box.height + titleBox.y) / 2,
          };
    if (placement === 'right')
      expect(box.x).toBeGreaterThan(titleBox.x + titleBox.width);
    else if (placement === 'below')
      expect(box.y).toBeGreaterThan(titleBox.y + titleBox.height);
    else expect(box.y + box.height).toBeLessThan(titleBox.y);

    await page.mouse.move(gap.x, gap.y, { steps: 15 });
    await page.waitForTimeout(700);
    await expect(card).toHaveCSS('display', 'block');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 20,
    });
    await page.waitForTimeout(400);
    await expect(card).toHaveCSS('display', 'block');
    await page.mouse.move(gap.x, gap.y, { steps: 20 });
    await page.waitForTimeout(700);
    await expect(card).toHaveCSS('display', 'block');
    await heading.hover();
    await page.waitForTimeout(400);
    await expect(card).toHaveCSS('display', 'block');
    await page.mouse.move(5, 5, { steps: 15 });
    await expect(card).toHaveCSS('display', 'none');

    await heading.hover();
    await expect(card).toHaveCSS('display', 'block');
    await page.mouse.move(gap.x, gap.y, { steps: 15 });
    await page.waitForTimeout(700);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 20,
    });
    await clickCardElement(context, page, '.details-summary');
    expect((await shadowElementState(context, page, '.details')).open).toBe(
      true,
    );
    await page.screenshot({
      path: `output/playwright/hover-transition-${placement}.png`,
    });
    await page.keyboard.press('Escape');
    await expect(card).toHaveCSS('display', 'none');
  });
}

test('refreshes context and AI availability in the same open document', async () => {
  await openCard();
  const card = page.locator('[data-attention-preview]');
  await expect(card).toHaveAttribute('data-attention-scenario', 'work');
  await expect(card).toHaveAttribute('data-attention-ai-state', 'local-only');
  await worker.evaluate(async () => {
    const current =
      (await attentionVault.privateStorage.get('attentionScenario'))
        .attentionScenario ?? {};
    await attentionVault.privateStorage.set({
      interfaceLanguage: 'ru',
      attentionScenario: {
        ...current,
        scenario: 'learn',
        scenarioSource: 'manual',
        scenarioUpdatedAt: new Date().toISOString(),
      },
      aiAnalyzerSettings: {
        provider: 'vercel-ai-gateway',
        model: 'google/gemini-2.5-flash-lite',
        apiKey: 'test-only-gateway-key',
        updatedAt: new Date().toISOString(),
      },
      privacySettings: {
        localOnly: false,
        updatedAt: new Date().toISOString(),
      },
    });
  });
  await expect(card).toHaveAttribute('data-attention-scenario', 'learn');
  await expect(card).toHaveAttribute('data-attention-ai-state', 'ready');
  await worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & { testAiRequests?: number };
    scope.testAiRequests = 0;
    globalThis.fetch = async () => {
      scope.testAiRequests! += 1;
      return new Response('Unavailable', { status: 503 });
    };
  });
  expect((await shadowElementState(context, page, '.details')).open).toBe(
    false,
  );
  await expect
    .poll(() => cardTextContent(context, page, '.ai-button'))
    .toBe('Проверить с AI');
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect
      .poll(
        async () =>
          (await shadowElementState(context, page, '.card')).colorScheme,
      )
      .toBe(theme);
    await card.screenshot({
      path: `output/playwright/card-ai-visible-${theme}.png`,
    });
  }
  expect(
    await worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { testAiRequests: number })
          .testAiRequests,
    ),
  ).toBe(0);
  await clickCardButton('class', 'ai-button');
  await expect
    .poll(() =>
      worker.evaluate(
        () =>
          (globalThis as typeof globalThis & { testAiRequests: number })
            .testAiRequests,
      ),
    )
    .toBeGreaterThan(0);
  await expect(card).toHaveAttribute('data-attention-ai-state', 'error');
  expect((await shadowElementState(context, page, '.details')).open).toBe(
    false,
  );
  await expect
    .poll(() => cardTextContent(context, page, '.ai-button'))
    .toBe('Повторить с AI');
  await card.screenshot({ path: 'output/playwright/card-ai-retry.png' });
  const navigationStart = await page.evaluate(() => performance.timeOrigin);
  await worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      testAiRequests: number;
      releaseAiResponse?: () => void;
    };
    globalThis.fetch = async () => {
      scope.testAiRequests += 1;
      await new Promise<void>((resolve) => {
        scope.releaseAiResponse = resolve;
      });
      // Local Gateway fixture exercises the real AI result and card refresh path.
      return Response.json({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              relevance: 75,
              actionability: 70,
              passages: [],
              keyClaims: [
                {
                  claim:
                    'This article explains a concrete method for allocating attention.',
                  sourceExcerpt:
                    'This article explains a concrete method for allocating attention.',
                  type: 'recommendation',
                  importance: 'primary',
                  knownProbability: 0.5,
                  noveltyReason: 'No matching concrete knowledge was provided.',
                  confidence: 0.6,
                },
              ],
              noveltySummary: 'The method may be new.',
              noveltyConfidence: 0.6,
              qualityBreakdown: {
                evidence: 60,
                reasoning: 70,
                specificity: 60,
                calibration: 65,
              },
              qualitySummary: 'The method has practical examples.',
              qualityStrengths: ['The steps can be tested.'],
              qualityLimitations: [
                'The evidence was not independently verified.',
              ],
              qualityConfidence: 0.6,
              reason: 'Практические методы работы с вниманием.',
              recommendedSections: ['Practical evidence'],
              confidence: 0.7,
            }),
          },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 100 },
          outputTokens: { total: 100 },
        },
      });
    };
  });
  await clickCardButton('class', 'ai-button');
  await expect
    .poll(() => cardTextContent(context, page, '.ai-button'))
    .toBe('AI анализирует…');
  await expect
    .poll(() =>
      worker.evaluate(
        () =>
          typeof (
            globalThis as typeof globalThis & { releaseAiResponse?: () => void }
          ).releaseAiResponse,
      ),
    )
    .toBe('function');
  await worker.evaluate(() =>
    (
      globalThis as typeof globalThis & { releaseAiResponse: () => void }
    ).releaseAiResponse(),
  );
  await expect(card).toHaveAttribute('data-attention-analysis-source', 'ai');
  await expect
    .poll(() => cardTextContent(context, page, '.analysis-source'))
    .toBe('Проверено AI ✓');
  expect((await shadowElementState(context, page, '.details')).open).toBe(
    false,
  );
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(
    navigationStart,
  );
  await card.screenshot({ path: 'output/playwright/card-ai-checked-dark.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await card.screenshot({
    path: 'output/playwright/card-ai-checked-light.png',
  });
});

test('saves through the single article action with visible confirmation and no duplicate', async () => {
  await openCard();
  const card = page.locator('[data-attention-preview]');
  await expect
    .poll(() => cardTextContent(context, page, '.save-button'))
    .toBe('Save for later');
  await clickCardButton('data-decision', 'save');
  await expect
    .poll(() => cardTextContent(context, page, '.save-button'))
    .toBe('Saved ✓');
  await expect(card).toHaveCSS('display', 'block');
  await expect
    .poll(() =>
      worker.evaluate(
        async () =>
          (await attentionVault.privateStorage.get('savedMaterials'))
            .savedMaterials?.length,
      ),
    )
    .toBe(1);
  await expect
    .poll(() =>
      worker.evaluate(
        async () =>
          (await attentionVault.privateStorage.get('materialDecisions'))
            .materialDecisions?.[0]?.decision,
      ),
    )
    .toBe('save');
  await page.keyboard.press('Escape');
  await openCard();
  expect(await cardTextContent(context, page, '.save-button')).toBe('Saved ✓');
});

test('completes reading feedback from actual reading without a Read button', async () => {
  test.setTimeout(65_000);
  const paragraph =
    '<p>This article explains a concrete method for allocating attention. It presents evidence, a causal mechanism, practical steps, limitations, and examples that make the argument testable and useful.</p>';
  await context.route(url, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>${title}</title><style>body{font:18px/1.5 system-ui}article{max-width:700px;margin:40px auto}p{min-height:230px}</style></head><body><article><h1>${title}</h1><h2>Practical evidence</h2>${paragraph.repeat(4)}</article></body></html>`,
    }),
  );
  await page.reload();
  await openCard();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-attention-preview]')).toHaveCSS(
    'display',
    'none',
  );
  // Start reading, let its session attach, then move to the end. A single
  // instant jump could finish before asynchronous session creation and never
  // include any movement during the actual reading session.
  await page.mouse.wheel(0, 180);
  await expect
    .poll(() =>
      worker.evaluate(
        async () =>
          (await attentionVault.privateStorage.get('attentionSessions'))
            .attentionSessions?.length,
      ),
    )
    .toBe(1);
  await page.keyboard.press('End');
  const prompt = page.locator('[data-attention-outcome-prompt]');
  // Exercise the actual visible-time threshold and heartbeat in the isolated
  // content runtime; no manufactured storage progress or private tracker edits.
  await expect(prompt).toHaveAttribute('data-state', 'visible', {
    timeout: 45_000,
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect
    .poll(
      async () =>
        (
          await shadowElementState(
            context,
            page,
            '.panel',
            'data-attention-outcome-prompt',
          )
        ).colorScheme,
    )
    .toBe('dark');
  await prompt.screenshot({ path: 'output/playwright/outcome-theme-dark.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect
    .poll(
      async () =>
        (
          await shadowElementState(
            context,
            page,
            '.panel',
            'data-attention-outcome-prompt',
          )
        ).colorScheme,
    )
    .toBe('light');
  await clickCardButton('data-outcome', 'yes', 'data-attention-outcome-prompt');
  await expect
    .poll(() =>
      worker.evaluate(
        async () =>
          (await attentionVault.privateStorage.get('utilityFeedback'))
            .utilityFeedback?.[0]?.source,
      ),
    )
    .toBe('quick');
  await expect
    .poll(() =>
      worker.evaluate(
        async () =>
          (await attentionVault.privateStorage.get('attentionSessions'))
            .attentionSessions?.[0]?.outcome,
      ),
    )
    .toBe('yes');
});
