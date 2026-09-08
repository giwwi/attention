import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createTestExtension,
  createVaultThroughUi,
  extensionWorker,
} from './helpers/vault';
import { importTestProfile, PROFILE_IMPORT } from './helpers/profile';

test('profile review and save activate existing tabs; deletion silences them again', async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(
    path.join(tmpdir(), 'attention-profile-activation-'),
  );
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
    const worker = await extensionWorker(context);
    const article = context.pages()[0] ?? (await context.newPage());
    await article.goto('http://127.0.0.1:4317/article/one');
    const loadedAt = await article.evaluate(() => performance.timeOrigin);
    const feed = await context.newPage();
    await feed.goto('http://127.0.0.1:4317/feed');
    let popup = await context.newPage();
    const popupUrl = `chrome-extension://${new URL(worker.url()).host}/popup.html`;
    await popup.goto(popupUrl);
    await popup.setViewportSize({ width: 380, height: 850 });
    await createVaultThroughUi(popup);
    await expect(popup.locator('#profile-source-step')).toBeVisible();
    await expect(
      popup.locator('[data-profile-source="chatgpt"]'),
    ).toBeVisible();
    await expect(popup.locator('[data-profile-source="claude"]')).toBeVisible();
    await expect(popup.locator('#skip-profile')).toBeHidden();
    await expect(popup.locator('#open-quick-profile')).toBeHidden();
    await expect(popup.locator('#open-page-card')).toBeHidden();
    await expect(popup.locator('[data-profile-source="manual"]')).toBeHidden();
    await popup.screenshot({
      path: 'output/playwright/profile-required-en.png',
      fullPage: true,
    });
    await popup.locator('#profile-setup-settings').click();
    await popup.locator('#interface-language').selectOption('ru');
    await popup.locator('#back-to-launcher').click();
    await expect(popup.locator('#profile-source-step')).toBeVisible();
    await popup.screenshot({
      path: 'output/playwright/profile-required-ru.png',
      fullPage: true,
    });

    // Old installations may have skipped onboarding. That flag must not unlock cards.
    await worker.evaluate(async () =>
      attentionVault.privateStorage.set({ profileOnboardingComplete: true }),
    );
    await article.locator('h1').hover();
    await article.mouse.wheel(0, 300);
    await feed.locator('#feed-link').hover();
    await feed.waitForTimeout(900);
    for (const tab of [article, feed])
      await expect(
        tab.locator(
          '[data-attention-preview], [data-attention-trigger], [data-attention-outcome]',
        ),
      ).toHaveCount(0);
    expect(
      await worker.evaluate(
        async () =>
          (await attentionVault.privateStorage.get('latestEvaluation'))
            .latestEvaluation,
      ),
    ).toBeUndefined();

    // Finish the cold scroll before returning later for the first hover.
    await article.locator('h1').scrollIntoViewIfNeeded();

    // Choosing a provider and restoring a handoff are not completed setup.
    await popup.locator('[data-profile-source="chatgpt"]').click();
    await expect(popup.locator('#profile-prompt-step')).toBeVisible();
    await popup.close();
    popup = await context.newPage();
    await popup.goto(popupUrl);
    await expect(popup.locator('#profile-prompt-step')).toBeVisible();
    await popup.locator('#profile-import-json').fill('{broken');
    await popup.locator('#validate-profile').click();
    await expect(popup.locator('#profile-validation-errors')).toBeVisible();
    await expect(article.locator('[data-attention-preview]')).toHaveCount(0);
    await popup.locator('#profile-import-json').fill(PROFILE_IMPORT);
    await popup.locator('#validate-profile').click();
    await expect(popup.locator('#profile-review-step')).toBeVisible();
    expect(
      await worker.evaluate(
        async () =>
          (await attentionVault.privateStorage.get('personalProfile'))
            .personalProfile,
      ),
    ).toBeUndefined();
    await expect(article.locator('[data-attention-preview]')).toHaveCount(0);
    await popup.locator('#save-profile').click();
    await expect(popup.locator('#launcher-home')).toBeVisible();
    await expect(popup.locator('#open-page-card')).toBeEnabled();
    await expect(article.locator('[data-attention-trigger]')).toHaveCount(1);
    await article.bringToFront();
    await article.mouse.move(0, 0);
    await article.locator('h1').hover();
    await expect(article.locator('[data-attention-preview]')).toHaveCSS(
      'display',
      'block',
    );
    await feed.bringToFront();
    await feed.mouse.move(0, 0);
    await feed.locator('#feed-link').hover();
    await expect(feed.locator('[data-attention-preview]')).toHaveCSS(
      'display',
      'block',
    );

    const settings = await context.newPage();
    await settings.goto(popupUrl);
    await settings.locator('#open-popup-settings').click();
    settings.once('dialog', (dialog) => dialog.accept());
    await settings.locator('#delete-profile').click();
    for (const tab of [article, feed])
      await expect(
        tab.locator('[data-attention-preview], [data-attention-trigger]'),
      ).toHaveCount(0);
    await expect(popup.locator('#profile-source-step')).toBeVisible();
    await expect(popup.locator('#open-page-card')).toBeDisabled();
    await expect(settings.locator('#profile-source-step')).toBeVisible();

    await importTestProfile(popup);
    await expect(popup.locator('#launcher-home')).toBeVisible();
    await expect(article.locator('[data-attention-trigger]')).toHaveCount(1);
    await article.bringToFront();
    await article.mouse.move(0, 0);
    await article.locator('h1').hover();
    await expect(article.locator('[data-attention-preview]')).toHaveCSS(
      'display',
      'block',
    );
    expect(await article.evaluate(() => performance.timeOrigin)).toBe(loadedAt);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
