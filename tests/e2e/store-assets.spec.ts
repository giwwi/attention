import { initializeTestProfile } from './helpers/profile';
import { createTestExtension, initializeTestVault } from './helpers/vault';
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  cardTextContent,
  clickCardElement,
  fillCardInput,
  shadowElementState,
} from './helpers/card';

const articleUrl = 'http://127.0.0.1:4317/article/store-demo';
const assetsDirectory = path.resolve('output/chrome-web-store/assets');

// Original sample content, served only in an isolated test profile. The page
// layout leaves space beside the headline for the real extension card.
const articleHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta property="og:type" content="article">
  <meta property="og:title" content="A calmer way to choose what to read">
  <title>A calmer way to choose what to read · Reading notes</title>
  <style>
    :root { color-scheme: light; --paper: #f9faf6; --ink: #202d25; --muted: #66756b; --line: #dbe2d9; --accent: #257654; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); font: 18px/1.7 Georgia, 'Times New Roman', serif; }
    .site-header { width: 1088px; margin: 0 auto; padding: 27px 0 21px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; font-family: system-ui, sans-serif; }
    .site-name { font-size: 19px; font-weight: 700; letter-spacing: -.03em; }
    .sample-label { font-size: 12px; color: var(--muted); }
    main { width: 1088px; margin: 40px auto 100px; }
    article { width: 640px; }
    .category { margin: 0 0 16px; font: 650 11px/1.4 system-ui, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
    h1 { margin: 0; max-width: 640px; font: 700 48px/1.12 system-ui, sans-serif; letter-spacing: -.045em; }
    .deck { margin: 23px 0 14px; max-width: 605px; color: var(--muted); font: 20px/1.55 system-ui, sans-serif; }
    .byline { margin: 0 0 31px; font: 12px/1.5 system-ui, sans-serif; color: var(--muted); }
    h2 { margin: 29px 0 13px; font: 650 25px/1.25 system-ui, sans-serif; letter-spacing: -.025em; }
    p { margin: 0 0 21px; }
    strong { font-weight: 700; }
    @media (prefers-color-scheme: dark) {
      :root { color-scheme: dark; --paper: #111a15; --ink: #dce7de; --muted: #a2b3a7; --line: #2a3d30; --accent: #8acfaa; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="site-name">Reading notes</div>
    <div class="sample-label">An Attention sample article</div>
  </header>
  <main>
    <article itemprop="articleBody">
      <p class="category">Work &amp; learning</p>
      <h1 itemprop="headline">A calmer way to choose what to read</h1>
      <p class="deck">A small reading habit that begins with your current goal and leaves room for curiosity.</p>
      <p class="byline">Original sample article · 5 September 2026</p>

      <h2>Start with one useful question</h2>
      <p>Before opening the next article, write down the decision you are trying to make. A specific question gives you something to look for: a method to try, an explanation to understand, or evidence that could change your plan.</p>
      <p>For example, imagine you are planning a focused morning of work. Your question might be, <strong>“How can I make reading fit around the work I need to finish?”</strong> A practical guide to choosing reading material could help. A broad survey of every productivity tool might be less useful today.</p>

      <h2>Look for a contribution you can name</h2>
      <p>Read the introduction and the section headings before committing to the whole piece. Try to describe its contribution in one sentence. Does it offer a concrete example, a careful comparison, or a step you can test? If you cannot tell yet, a brief skim can give you enough information to decide.</p>
      <p>Novelty also depends on what you already know. Familiar background may be essential for a beginner and repetitive for an experienced reader. That does not make the article good or bad in general. It means the same material can deserve different amounts of attention from different people.</p>
      <p>When a claim is surprising, look for its source and its limits. An appealing headline does not establish that a result is reliable. A small personal example may suggest something worth trying, but it cannot tell you how often the same approach will work for other people.</p>

      <h2>Give the reading a small time budget</h2>
      <p>Choose a stopping point before you start. With five minutes available, you might read a single relevant section and its supporting example. With more time, you can follow the whole argument and inspect the references. The budget is a practical constraint, not a measure of the article’s quality.</p>
      <p>Saving a piece for later can be a useful decision when it matches a real upcoming task. Add a short note about why you saved it. “Compare this approach before next week’s planning session” will be easier to act on than an unexplained link in a long queue.</p>
      <p>It is also reasonable to stop reading when the useful part is finished. You do not need to complete every page to benefit from it. Equally, an unexpected idea can justify spending longer than planned. The purpose of a budget is to make that choice visible.</p>

      <h2>Check what changed afterward</h2>
      <p>At the end, ask whether the article gave you something you can use or remember. You might keep a sentence, revise your plan, or decide that the source was less relevant than its title suggested. These observations are more informative than simply counting how many articles you opened.</p>
      <p>Try this routine on a few pieces of reading during an ordinary week. Notice both helpful decisions and misses, including material you nearly skipped but later found useful. Adjust your approach from those examples. This is a personal experiment, not a claim that one reading routine will suit everyone.</p>
      <p>A considered reading habit can still include exploration and enjoyment. Set aside time for those purposes explicitly. The question is then whether an article serves that moment of curiosity, rather than whether every paragraph advances a work project.</p>
    </article>
  </main>
</body>
</html>`;

async function assertAiControlInFirstScreen(
  context: BrowserContext,
  page: Page,
): Promise<void> {
  const cdp = await context.newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', {
      depth: -1,
      pierce: true,
    });
    type Node = typeof root;
    const nodes: Node[] = [root];
    let host: Node | undefined;
    while (nodes.length > 0) {
      const node = nodes.pop()!;
      if (node.attributes?.includes('data-attention-preview')) {
        host = node;
        break;
      }
      nodes.push(...(node.children ?? []), ...(node.shadowRoots ?? []));
    }
    expect(host?.shadowRoots?.[0]).toBeTruthy();
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: host!.shadowRoots![0]!.nodeId,
      selector: '.ai-button',
    });
    expect(nodeId).toBeGreaterThan(0);
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId });
    expect(model.width).toBeGreaterThan(0);
    expect(model.height).toBeGreaterThan(0);
    expect(Math.min(model.border[1], model.border[3])).toBeGreaterThan(0);
    expect(Math.max(model.border[5], model.border[7])).toBeLessThan(800);
  } finally {
    await cdp.detach();
  }
  expect((await shadowElementState(context, page, '.details')).open).toBe(
    false,
  );
  expect(await cardTextContent(context, page, '.analysis-source')).toBe(
    'Local evaluation',
  );
  expect(await cardTextContent(context, page, '.ai-button')).toBe(
    'Check with AI',
  );
}

test('capture authentic English store screenshots from the article card', async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'attention-store-'));
  const extension = await createTestExtension(directory);
  await mkdir(assetsDirectory, { recursive: true });
  const context = await chromium.launchPersistentContext(directory, {
    channel: 'chromium',
    headless: process.env.HEADED !== 'true',
    colorScheme: 'light',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    await initializeTestVault(context);
    await initializeTestProfile(context);
    const page = context.pages()[0] ?? (await context.newPage());
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await worker.evaluate(async () => {
      // Exercise the configured AI affordance without credentials or a model
      // request. The screenshot recommendation is produced by the local engine.
      const scope = globalThis as typeof globalThis & {
        storeScreenshotNetworkRequests?: number;
      };
      scope.storeScreenshotNetworkRequests = 0;
      globalThis.fetch = async () => {
        scope.storeScreenshotNetworkRequests! += 1;
        throw new Error('Store screenshots must not make external requests.');
      };
      await attentionVault.privateStorage.set({
        interfaceLanguage: 'en',
        profileOnboardingComplete: true,
        analysisContext: {
          scenario: 'work',
          availableMinutes: 15,
          intent: 'Choose useful reading for focused work',
        },
        aiAnalyzerSettings: {
          provider: 'vercel-ai-gateway',
          model: 'google/gemini-2.5-flash-lite',
          apiKey: 'store-screenshot-placeholder-not-a-real-key',
          updatedAt: '2026-09-05T10:00:00.000Z',
        },
        privacySettings: {
          localOnly: false,
          updatedAt: '2026-09-05T10:00:00.000Z',
        },
      });
    });
    await page.route(articleUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: articleHtml,
      }),
    );
    await page.goto(articleUrl);
    const trigger = page.locator('[data-attention-trigger]');
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const card = page.locator('[data-attention-preview]');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-attention-expanded', 'true');
    await expect(card).toHaveAttribute(
      'data-attention-source',
      'full-analysis',
    );
    await expect(card).toHaveAttribute('data-attention-ai-state', 'ready');
    await expect(card).toHaveAttribute('data-attention-score', /^\d+$/);
    await expect
      .poll(() => cardTextContent(context, page, '.context-summary'))
      .toContain('15 min');
    await assertAiControlInFirstScreen(context, page);
    const headline = (await page.locator('h1').boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    expect(cardBox.x).toBeGreaterThan(headline.x + headline.width);
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(800);
    await page.screenshot({
      path: path.join(assetsDirectory, 'screenshot-1-decision-1280x800.png'),
    });

    const navigationStart = await page.evaluate(() => performance.timeOrigin);
    await clickCardElement(context, page, '.context-summary');
    await fillCardInput(
      context,
      page,
      '.context-intent',
      'Build a practical reading routine',
    );
    expect(
      (await shadowElementState(context, page, '.card-context')).open,
    ).toBe(true);
    await assertAiControlInFirstScreen(context, page);
    await page.screenshot({
      path: path.join(assetsDirectory, 'screenshot-2-context-1280x800.png'),
    });
    await clickCardElement(context, page, '.context-apply');
    await expect
      .poll(() => cardTextContent(context, page, '.context-summary'))
      .toContain('Build a practical reading routine');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
      navigationStart,
    );

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(
        async () =>
          (await shadowElementState(context, page, '.card')).colorScheme,
      )
      .toBe('dark');
    await expect(card).toBeVisible();
    await assertAiControlInFirstScreen(context, page);
    await page.screenshot({
      path: path.join(assetsDirectory, 'screenshot-3-dark-1280x800.png'),
    });
    expect(
      await worker.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              storeScreenshotNetworkRequests: number;
            }
          ).storeScreenshotNetworkRequests,
      ),
    ).toBe(0);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
