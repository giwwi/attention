import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createTestExtension,
  createVaultThroughUi,
  extensionWorker,
} from './helpers/vault';
import {
  clickCardElement,
  cardTextContent,
  shadowElementState,
} from './helpers/card';
import { importTestProfile, PROFILE_IMPORT } from './helpers/profile';

test('cold cards guide setup; profile save activates existing tabs; deletion restores setup', async () => {
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
    // A genuinely fresh installation has no vault yet. Both kinds of cards
    // must lead to setup without ever inventing a recommendation.
    await article.bringToFront();
    await expect(
      article.locator('[data-attention-profile-required]'),
    ).toHaveCount(1);
    await article.bringToFront();
    await article.mouse.move(0, 0);
    await article.locator('h1').hover();
    const articleCard = article.locator('[data-attention-preview]');
    await expect(articleCard).toBeVisible();
    await expect(articleCard).toHaveAttribute(
      'data-attention-profile-required',
      'true',
    );
    await expect(articleCard).toHaveAttribute(
      'data-attention-expanded',
      'true',
    );
    await expect
      .poll(() => cardTextContent(context, article, '.profile-prompt'))
      .toContain('ChatGPT or Claude');
    await article.screenshot({
      path: 'output/playwright/profile-card-cold-article.png',
    });
    await feed.bringToFront();
    await expect(feed.locator('[data-attention-profile-required]')).toHaveCount(
      1,
    );
    await feed.bringToFront();
    await feed.mouse.move(0, 0);
    await feed.locator('#feed-link').hover();
    const feedCard = feed.locator('[data-attention-preview]');
    await expect(feedCard).toBeVisible();
    await expect(feedCard).toHaveAttribute('data-attention-expanded', 'false');
    await expect(feedCard).toHaveAttribute(
      'data-attention-profile-required',
      'true',
    );
    // Travel slowly across the title/card gap: the setup CTA must stay usable.
    const box = await feedCard.boundingBox();
    await feed.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, {
      steps: 20,
    });
    await expect(feedCard).toBeVisible();
    await feed.screenshot({
      path: 'output/playwright/profile-card-cold-feed.png',
    });
    const popupUrl = `chrome-extension://${new URL(worker.url()).host}/popup.html`;
    const opened = context.waitForEvent('page');
    await clickCardElement(context, feed, '.profile-create-button');
    let popup = await opened;
    await expect(popup).toHaveURL(popupUrl);
    await popup.setViewportSize({ width: 380, height: 850 });
    const demo = popup.locator('[data-profile-demo]');
    await expect(demo).toBeVisible();
    const beforeDemo = await worker.evaluate(() =>
      chrome.storage.local.get(null),
    );
    await demo.locator('summary').click();
    await expect(demo).toContainText('made-up example');
    await demo.getByRole('button', { name: 'Show the useful passage' }).click();
    await expect(demo.getByRole('status')).toBeVisible();
    await expect(demo.locator('article p').last()).toBeFocused();
    await expect(demo.locator('article p').last()).toContainText('However');
    expect(await worker.evaluate(() => chrome.storage.local.get(null))).toEqual(
      beforeDemo,
    );
    await popup.screenshot({
      path: 'output/playwright/profile-demo-before-vault.png',
      fullPage: true,
    });
    await demo.locator('summary').click();
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
    for (const tab of [article, feed]) {
      await expect(tab.locator('[data-attention-preview]')).toHaveAttribute(
        'data-attention-profile-required',
        'true',
      );
      await expect(tab.locator('[data-attention-outcome]')).toHaveCount(0);
    }
    await expect
      .poll(() => cardTextContent(context, feed, '.profile-prompt'))
      .toContain('Создать мой профиль');
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
    await expect(article.locator('[data-attention-preview]')).toHaveAttribute(
      'data-attention-profile-required',
      'true',
    );
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
    await expect(article.locator('[data-attention-preview]')).toHaveAttribute(
      'data-attention-profile-required',
      'true',
    );
    await popup.locator('#save-profile').click();
    await expect(popup.locator('#launcher-home')).toBeVisible();
    await expect(popup.locator('#open-page-card')).toBeEnabled();
    await expect(
      article.locator('[data-attention-profile-required]'),
    ).toHaveCount(0);
    await expect(feed.locator('[data-attention-profile-required]')).toHaveCount(
      0,
    );
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
      await expect(tab.locator('[data-attention-preview]')).toHaveAttribute(
        'data-attention-profile-required',
        'true',
      );
    // A keyboard user can reach setup on the open article too.
    await article.bringToFront();
    await article.locator('[data-attention-trigger]').focus();
    await article.keyboard.press('Enter');
    await expect(article.locator('[data-attention-preview]')).toBeVisible();
    await expect
      .poll(
        async () =>
          (await shadowElementState(context, article, '.profile-create-button'))
            .focused,
      )
      .toBe(true);
    await article.emulateMedia({ colorScheme: 'dark' });
    await article.screenshot({
      path: 'output/playwright/profile-card-ru-dark.png',
    });
    const articleOpened = context.waitForEvent('page');
    await article.keyboard.press('Enter');
    const articleSetup = await articleOpened;
    await expect(articleSetup.locator('#profile-source-step')).toBeVisible();
    await articleSetup.close();
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
