import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createTestExtension,
  createVaultThroughUi,
  extensionWorker,
  readRawVaultStorage,
} from './helpers/vault';
import {
  clickCardElement,
  cardTextContent,
  shadowElementState,
} from './helpers/card';
import { PROFILE_IMPORT } from './helpers/profile';

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
    const popup = await opened;
    await expect(popup).toHaveURL(/popup.html\?sourceTab=\d+$/);
    await popup.setViewportSize({ width: 380, height: 850 });
    await expect(popup.locator('#profile-welcome-step h2 > span')).toHaveText([
      'Your AI knows you.',
      'Now use that knowledge on your terms.',
    ]);
    await expect(popup.locator('[data-profile-demo]')).toHaveCount(0);
    await popup.screenshot({
      path: 'output/playwright/profile-welcome-before-vault.png',
      fullPage: true,
    });
    const languageChoice = popup.locator(
      '#profile-onboarding .onboarding-language select',
    );
    await expect(languageChoice.locator('option')).toHaveCount(9);
    await languageChoice.selectOption('de');
    await expect(popup.locator('html')).toHaveAttribute('lang', 'de');
    await expect(popup.locator('#profile-start')).toHaveText(
      'Mein Profil mitnehmen →',
    );
    await popup.screenshot({
      path: 'output/playwright/onboarding-language-de.png',
      fullPage: true,
    });
    await languageChoice.selectOption('ru');
    await expect(popup.locator('#profile-start')).toHaveText(
      'Забрать свой профиль →',
    );
    await popup.screenshot({
      path: 'output/playwright/onboarding-language-ru.png',
      fullPage: true,
    });
    await popup.setViewportSize({ width: 352, height: 600 });
    await popup.emulateMedia({ colorScheme: 'dark' });
    await expect(popup.locator('#profile-start')).toBeInViewport();
    await popup.screenshot({ path: 'output/playwright/profile-welcome-ru-compact-dark.png' });
    await popup.setViewportSize({ width: 380, height: 850 });
    await popup.emulateMedia({ colorScheme: 'light' });
    await languageChoice.selectOption('de');
    await expect(popup.locator('#vault-password')).toHaveCount(0);
    expect(await worker.evaluate(() => attentionVault.getVaultStatus())).toBe(
      'unconfigured',
    );
    await languageChoice.selectOption('en');
    await popup.locator('#profile-start').click();
    await expect(popup.locator('#profile-source-step')).toBeVisible();
    await expect(popup.locator('#profile-example-slot')).toHaveCount(0);
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
    await languageChoice.selectOption('ru');
    expect(JSON.stringify(await readRawVaultStorage(worker))).not.toContain(
      'personalProfile',
    );
    for (const tab of [article, feed])
      await expect(tab.locator('[data-attention-preview]')).toHaveAttribute(
        'data-attention-profile-required',
        'true',
      );
    // Finish the cold scroll before returning later for the first hover.
    await article.locator('h1').scrollIntoViewIfNeeded();

    // Choosing a provider and restoring a handoff are not completed setup.
    await popup.locator('[data-profile-source="chatgpt"]').click();
    await expect(popup.locator('#profile-prompt-step')).toBeVisible();
    const otherTab = await context.newPage();
    await otherTab.goto('http://127.0.0.1:4317/feed');
    await popup.bringToFront();
    await expect(popup.locator('#profile-prompt-step')).toBeVisible();
    await otherTab.close();
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
    expect(await worker.evaluate(() => attentionVault.getVaultStatus())).toBe(
      'unconfigured',
    );
    expect(JSON.stringify(await readRawVaultStorage(worker))).not.toContain(
      'Software quality',
    );
    await expect(article.locator('[data-attention-preview]')).toHaveAttribute(
      'data-attention-profile-required',
      'true',
    );
    await popup.locator('#save-profile').click();
    await expect(popup.locator('#vault-password')).toBeVisible();
    await expect(popup.locator('#vault-title')).toHaveText('А теперь защитим твои данные');
    await popup.screenshot({ path: 'output/playwright/profile-protect-data-ru.png', fullPage: true });
    await popup.locator('#vault-back-to-profile').click();
    await expect(popup.locator('#profile-review-step')).toBeVisible();
    await popup.locator('#save-profile').click();
    await createVaultThroughUi(popup);

    await expect(popup.locator('#optional-sources')).toBeVisible();
    await expect(popup.locator('#profile-complete-step')).toBeHidden();
    await expect(popup.locator('#optional-sources-continue')).toHaveText(
      'Пропустить этот шаг',
    );
    expect(
      await worker.evaluate(() =>
        chrome.permissions.contains({ permissions: ['history'] }),
      ),
    ).toBe(false);
    await popup.screenshot({
      path: 'output/playwright/optional-sources-ru.png',
      fullPage: true,
    });
    await popup.setViewportSize({ width: 380, height: 600 });
    await expect(popup.locator('#optional-sources-continue')).toBeInViewport();
    await popup.screenshot({
      path: 'output/playwright/optional-sources-compact.png',
    });
    await popup.setViewportSize({ width: 1024, height: 900 });
    await popup.emulateMedia({ colorScheme: 'dark' });
    await popup.screenshot({
      path: 'output/playwright/optional-sources-dark.png',
    });
    await popup.emulateMedia({ colorScheme: 'light' });
    await popup.screenshot({
      path: 'output/playwright/optional-sources-desktop.png',
    });
    await popup.setViewportSize({ width: 380, height: 850 });
    // Reload must preserve the new step without rerunning profile/password setup.
    await popup.reload();
    await expect(popup.locator('#optional-sources')).toBeVisible();
    await popup.locator('#optional-readwise').click();
    await expect(popup.locator('#readwise-settings')).toBeVisible();
    await expect(popup.locator('#optional-sources')).toBeHidden();
    await popup.locator('#readwise-token').fill('unsaved-test-token');
    await popup.locator('#close-readwise-settings').click();
    await expect(popup.locator('#optional-sources')).toBeVisible();
    await expect(popup.locator('#readwise-token')).toHaveValue('');
    await popup.locator('#optional-history').click();
    await expect(popup.locator('#browser-history-setup')).toBeVisible();
    expect(
      await worker.evaluate(() =>
        chrome.permissions.contains({ permissions: ['history'] }),
      ),
    ).toBe(false);
    await popup.locator('#close-browser-history').click();
    await expect(popup.locator('#optional-sources')).toBeVisible();
    const obsidianOpened = context.waitForEvent('page');
    await popup.locator('#optional-obsidian').click();
    const obsidianSetup = await obsidianOpened;
    await expect(obsidianSetup).toHaveURL(/obsidian.html$/);
    await expect(obsidianSetup.locator('#close-obsidian')).toBeVisible();
    expect(popup.isClosed()).toBe(false);
    await obsidianSetup.locator('#close-obsidian').click();
    await popup.bringToFront();
    await expect(popup.locator('#optional-sources')).toBeVisible();
    await popup.locator('#optional-sources-continue').click();
    await expect(popup.locator('#optional-ai')).toBeVisible();
    await expect(popup.locator('#profile-complete-step')).toBeHidden();
    await expect(popup.locator('#optional-ai')).toContainText(
      'Это необязательно.',
    );
    await expect(popup.locator('#optional-ai-create-key')).toHaveAttribute(
      'target',
      '_blank',
    );
    await expect(popup.locator('#optional-ai-key')).toHaveAttribute(
      'type',
      'password',
    );
    await context.route('https://vercel.com/d?*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>API key setup fixture</title>',
      }),
    );
    const keyPageOpened = context.waitForEvent('page');
    await popup.locator('#optional-ai-create-key').click();
    const keyPage = await keyPageOpened;
    await expect(keyPage).toHaveURL(/vercel\.com\/d\?.*api-keys/);
    expect(popup.isClosed()).toBe(false);
    await keyPage.close();
    await popup.bringToFront();
    await expect(popup.locator('#optional-ai')).toBeVisible();
    await popup.setViewportSize({ width: 380, height: 600 });
    await expect(popup.locator('#optional-ai-skip')).toBeInViewport();
    await popup.screenshot({
      path: 'output/playwright/optional-ai-compact.png',
    });
    await popup.setViewportSize({ width: 1024, height: 950 });
    await popup.screenshot({
      path: 'output/playwright/optional-ai-desktop.png',
    });
    await popup.emulateMedia({ colorScheme: 'dark' });
    await popup.screenshot({ path: 'output/playwright/optional-ai-dark.png' });
    await popup.emulateMedia({ colorScheme: 'light' });
    await popup.locator('#optional-ai-key').fill('UNSAVED_TEST_KEY');
    await popup.reload();
    await expect(popup.locator('#optional-ai')).toBeVisible();
    await expect(popup.locator('#optional-sources')).toBeHidden();
    await expect(popup.locator('#optional-ai-key')).toHaveValue('');
    expect(
      await worker.evaluate(() =>
        attentionVault.privateStorage.get('aiAnalyzerSettings'),
      ),
    ).toEqual({});
    await popup.locator('#optional-ai-skip').click();
    await expect(popup.locator('#profile-complete-step')).toBeVisible();
    await expect(popup.locator('#profile-return')).toBeVisible();
    await popup.locator('#profile-return').click();
    await expect
      .poll(() =>
        worker.evaluate(
          async () =>
            (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
              ?.url,
        ),
      )
      .toContain('/feed');
    await popup.bringToFront();
    await popup.locator('#profile-finish').click();
    await expect(popup.locator('#launcher-home')).toBeVisible();
    await popup.reload();
    await expect(popup.locator('#launcher-home')).toBeVisible();
    await expect(popup.locator('#optional-sources')).toBeHidden();
    await expect(popup.locator('#optional-ai')).toBeHidden();
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
    await expect(articleSetup.locator('#profile-welcome-step')).toBeVisible();
    await articleSetup.locator('#profile-start').click();
    await expect(articleSetup.locator('#profile-source-step')).toBeVisible();
    await articleSetup.close();
    await expect(popup.locator('#profile-welcome-step')).toBeVisible();
    await popup.locator('#profile-start').click();
    await expect(popup.locator('#open-page-card')).toBeDisabled();
    await expect(settings.locator('#profile-welcome-step')).toBeVisible();

    await popup.bringToFront();
    await popup.locator('#profile-other-methods > summary').click();
    await popup.locator('[data-profile-source="manual"]').click();
    await expect(popup.locator('#profile-question-title')).toContainText(
      'Зачем',
    );
    await popup
      .locator('#profile-answer')
      .fill('Хочу выбирать инструменты для оценки моделей');
    await popup.emulateMedia({ colorScheme: 'dark' });
    await popup.screenshot({
      path: 'output/playwright/onboarding-question-dark.png',
      fullPage: true,
    });
    await popup.locator('#profile-question-step button[type=submit]').click();
    await popup.locator('#profile-answer').fill('Оценка AI\nКачество данных');
    await popup.locator('#profile-question-step button[type=submit]').click();
    await popup.locator('#profile-beginner').click();
    await expect(popup.locator('#profile-review-step')).toBeVisible();
    await expect(popup.locator('#profile-review-details')).not.toHaveAttribute(
      'open',
      '',
    );
    await expect
      .poll(() =>
        popup
          .locator('#profile-review-brief textarea')
          .first()
          .evaluate((input) => input.scrollHeight <= input.clientHeight + 1),
      )
      .toBe(true);
    await popup.screenshot({
      path: 'output/playwright/onboarding-review-dark.png',
      fullPage: true,
    });
    await popup.emulateMedia({ colorScheme: 'light' });
    await popup.screenshot({
      path: 'output/playwright/onboarding-review-light.png',
      fullPage: true,
    });
    await popup.locator('#save-profile').click();
    await expect(popup.locator('#profile-complete-step')).toBeVisible();
    await popup.setViewportSize({ width: 1280, height: 800 });
    await popup.screenshot({
      path: 'output/playwright/onboarding-complete.png',
      fullPage: true,
    });
    const savedProfile = (await worker.evaluate(
      async () =>
        (await attentionVault.privateStorage.get('personalProfile'))
          .personalProfile,
    )) as { learningAreas: unknown[]; demonstratedKnowledge: unknown[] };
    expect(savedProfile.learningAreas).toHaveLength(2);
    expect(savedProfile.demonstratedKnowledge).toHaveLength(0);
    await popup.locator('#profile-finish').click();
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
