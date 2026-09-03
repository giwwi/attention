import {
  expect,
  test,
  chromium,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const extensionPath = path.resolve('dist');

let context: BrowserContext;
let page: Page;
let profileDirectory: string;

test.beforeEach(async () => {
  expect(existsSync(path.join(extensionPath, 'manifest.json'))).toBe(true);
  profileDirectory = await mkdtemp(path.join(tmpdir(), 'attention-e2e-'));
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: 'chromium',
    headless: process.env.HEADED !== 'true',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  page = context.pages()[0] ?? (await context.newPage());
});

test.afterEach(async () => {
  await context.close();
  await rm(profileDirectory, { recursive: true, force: true });
});

async function previewHost() {
  const host = page.locator('[data-attention-preview="true"]');
  await expect(host).toHaveAttribute('data-attention-version', /.+/);
  return host;
}

test('shows a compact recommendation on a feed link', async () => {
  await page.goto('http://127.0.0.1:4317/feed');
  const host = await previewHost();

  await page.locator('#feed-link').hover();

  await expect(host).toHaveCSS('display', 'block');
  await expect(host).toHaveAttribute('data-attention-expanded', 'false');
  await expect(host).toHaveAttribute('data-attention-source', 'title-preview');
  await expect(host).toHaveAttribute(
    'data-attention-verdict',
    /read|maybe|skip/,
  );
});

test('shows only the expanded card on the open article title', async () => {
  await page.goto('http://127.0.0.1:4317/article/one');
  const host = await previewHost();

  await page.locator('h1').hover();

  await expect(host).toHaveCSS('display', 'block');
  await expect(host).toHaveAttribute('data-attention-expanded', 'true');
  await expect(host).toHaveAttribute('data-attention-source', 'full-analysis');
  await expect(host).toHaveAttribute('data-attention-reading-info', /.+/);

  await page.locator('#body-link').hover();
  await expect(host).toHaveCSS('display', 'none');
});

test('activates on a hydrated SPA article without a reload', async () => {
  await page.goto('http://127.0.0.1:4317/spa');
  const host = await previewHost();

  await page.locator('#spa-link').click();
  await expect(page).toHaveURL(/\/article\/spa$/);
  await expect(page.locator('h1')).toHaveText('Hydrated SPA article');
  expect(await page.evaluate(() => window.fixtureRouteTransitions)).toBe(1);

  await page.locator('h1').hover();
  await expect(host).toHaveCSS('display', 'block');
  await expect(host).toHaveAttribute('data-attention-expanded', 'true');
  await expect(host).toHaveAttribute('data-attention-source', 'full-analysis');
});

test('renders the dedicated Obsidian profile-source settings page', async () => {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;

  await page.goto(`chrome-extension://${extensionId}/obsidian.html`);

  await expect(page.locator('#obsidian-title')).toHaveText('Obsidian');
  await expect(page.locator('#choose-vault')).toBeVisible();
  await expect(page.locator('#obsidian-status')).not.toBeEmpty();
  await expect(page.locator('#obsidian-privacy')).toContainText(
    /never sent to AI|не отправляются AI/u,
  );
});

test('renders Notion as a dedicated local knowledge source', async () => {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;

  await page.goto(`chrome-extension://${extensionId}/notion.html`);

  await expect(page.locator('#notion-title')).toHaveText('Notion');
  await expect(page.locator('#notion-source-mode')).toBeVisible();
  await expect(page.locator('#connect-notion')).toBeVisible();
  await expect(page.locator('#notion-status')).not.toBeEmpty();
  await expect(page.locator('#notion-privacy')).toContainText(
    /never sent to AI|не отправляются AI/u,
  );
  await expect(page.locator('#notion-selection')).toContainText(
    /page picker|выбор страниц/u,
  );
});

test('explains the ChatGPT paste step before opening the provider', async () => {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;

  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const chatGptSource = page.locator('[data-profile-source="chatgpt"]');
  if (!(await chatGptSource.isVisible())) {
    await page.locator('#open-profile-import').click();
  }
  await expect(chatGptSource).toBeVisible();
  await chatGptSource.click();

  await expect(page.locator('#profile-prompt-step')).toBeVisible();
  await expect(page.locator('#profile-handoff-status')).toContainText(
    'Запрос уже скопирован',
  );
  await expect(page.locator('#reopen-profile-provider')).toHaveText(
    'Открыть ChatGPT',
  );
  await expect(page.locator('#reopen-profile-provider')).toBeVisible();
  expect(context.pages()).toHaveLength(1);
});

declare global {
  interface Window {
    fixtureRouteTransitions: number;
  }
}
