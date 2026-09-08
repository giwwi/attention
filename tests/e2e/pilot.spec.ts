import { importTestProfile } from './helpers/profile';
import {
  createTestExtension,
  createVaultThroughUi,
  failNextEncryptedWrite,
} from './helpers/vault';
import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('voluntary pilot preserves the blinded baseline, local export and withdrawal', async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'attention-pilot-'));
  const extension = await createTestExtension(directory);
  const context = await chromium.launchPersistentContext(directory, {
    channel: 'chromium',
    headless: process.env.HEADED !== 'true',
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    const errors: string[] = [];
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const article = context.pages()[0] ?? (await context.newPage());
    await article.goto('http://127.0.0.1:4317/article/one');
    async function openPopup() {
      const popup = await context.newPage();
      await popup.goto(
        `chrome-extension://${new URL(worker.url()).host}/popup.html`,
      );
      return popup;
    }
    let popup = await openPopup();
    await createVaultThroughUi(popup);
    await importTestProfile(popup);
    await article.bringToFront();
    const onboardingClosed = popup.waitForEvent('close');
    await popup.locator('#open-page-card').click();
    await test.step('first assessment closes onboarding popup', async () =>
      onboardingClosed);
    await expect(article.locator('[data-attention-preview]')).toHaveCSS(
      'display',
      'block',
    );
    await expect(article.locator('[data-attention-preview]')).toHaveAttribute(
      'data-attention-expanded',
      'true',
    );
    // Real vault setup above must complete before a later popup can restore navigation.
    popup = await openPopup();
    await expect(popup.locator('#launcher-home')).toBeVisible();
    await popup.locator('#open-popup-settings').click();
    await expect(popup.locator('#settings-home')).toBeVisible();
    await popup.locator('.additional-settings > summary').click();
    await expect(popup.locator('#open-voluntary-pilot')).toBeVisible();
    const pilotOpened = context.waitForEvent('page');
    await popup.locator('#open-voluntary-pilot').click();
    const pilot = await test.step('attach to pilot page', async () =>
      pilotOpened);
    pilot.on('pageerror', (error) => errors.push(error.message));
    const externalRequests: string[] = [];
    pilot.on('request', (request) => {
      if (/^https?:/u.test(request.url())) externalRequests.push(request.url());
    });
    await expect(pilot.locator('#consent-panel')).toBeVisible();
    await pilot.locator('#enroll').click();
    expect(
      await worker.evaluate(
        async () =>
          (await attentionVault.privateStorage.get('voluntaryPilot'))
            .voluntaryPilot ?? null,
      ),
    ).toBeNull();
    await pilot.locator('#consent').check();
    await pilot.locator('#enroll').click();
    await pilot
      .locator('#pilot-goal')
      .fill('Choose practical attention allocation methods');
    await pilot.locator('#unseen').check();
    await pilot.locator('#start-trial').click();
    await expect(pilot.locator('#baseline-panel')).toBeVisible();
    await expect(pilot.locator('#attention-panel')).toBeHidden();
    await expect(pilot.locator('#review-text')).toBeEmpty();
    // Abort an actual encrypted IndexedDB write in each decision phase.
    await failNextEncryptedWrite(pilot);
    await pilot.locator('#baseline-skip').click();
    await expect(pilot.locator('#pilot-status')).toContainText(
      'Действие не завершено',
    );
    await expect(pilot.locator('#baseline-skip')).toBeEnabled();
    await pilot.locator('#baseline-skip').click();
    await expect(pilot.locator('#attention-panel')).toBeVisible();
    await expect(pilot.locator('#pilot-recommendation')).toHaveText(/\d+\/100/);
    await failNextEncryptedWrite(pilot);
    await pilot.locator('#attention-read').click();
    await expect(pilot.locator('#pilot-status')).toContainText(
      'Действие не завершено',
    );
    await expect(pilot.locator('#attention-read')).toBeEnabled();
    await pilot.locator('#attention-read').click();
    await expect(pilot.locator('#review-panel')).toBeVisible();
    let stored = await worker.evaluate(
      async () =>
        (await attentionVault.privateStorage.get('voluntaryPilot'))
          .voluntaryPilot,
    );
    expect(stored.trials[0].baseline.decision).toBe('skip');
    expect(stored.trials[0].review).toBeNull();
    expect(stored.trials[0].attention.prediction.provenance).toBe('captured');
    await pilot.locator('details summary').click();
    await expect(pilot.locator('#review-text')).toContainText('attention');
    await pilot.locator('#reviewed').check();
    await pilot.locator('#material-useful').selectOption('yes');
    await pilot.locator('#attention-helpful').selectOption('yes');
    await pilot.locator('#baseline-helpful').selectOption('no');
    await pilot.locator('#save-review').click();
    await expect(pilot.locator('#pilot-status')).toContainText(
      'сохранён локально',
    );
    const downloadReady = pilot.waitForEvent('download');
    await pilot.locator('#export-pilot').click();
    const download = await test.step('download local pilot export', async () =>
      downloadReady);
    const exported = JSON.parse(
      await readFile((await download.path())!, 'utf8'),
    );
    expect(exported.metrics.baseline.falseSkip).toEqual({
      numerator: 1,
      denominator: 1,
      rate: 1,
    });
    expect(exported.metrics.attention.usefulRecommendations.rate).toBe(1);
    expect(JSON.stringify(exported)).not.toMatch(
      /127\.0\.0\.1|materialFingerprint|Choose practical/,
    );
    expect(externalRequests).toEqual([]);
    await pilot.screenshot({
      path: 'output/playwright/stage-4-pilot-ru.png',
      fullPage: true,
    });
    await pilot.locator('#pilot-language').selectOption('en');
    await expect(pilot.locator('h1')).toHaveText(
      'What is actually worth reading?',
    );
    await pilot.screenshot({
      path: 'output/playwright/stage-4-pilot-en.png',
      fullPage: true,
    });
    await pilot.locator('#erase-pilot').click();
    await expect(pilot.locator('#consent-panel')).toBeVisible();
    stored = await worker.evaluate(
      async () =>
        (await attentionVault.privateStorage.get('voluntaryPilot'))
          .voluntaryPilot ?? null,
    );
    expect(stored).toBeNull();
    await expect(pilot.locator('#review-text')).toBeEmpty();
    await expect(pilot.locator('#pilot-sections')).toBeEmpty();
    await expect(pilot.locator('#pilot-recommendation')).toBeEmpty();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
