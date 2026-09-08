import { initializeTestProfile } from './helpers/profile';
import { createTestExtension, initializeTestVault } from './helpers/vault';
import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  cardTextContent,
  clickCardElement,
  fillCardInput,
  selectCardOption,
} from './helpers/card';

test('the compact article card edits context without a reload and keeps detail optional', async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(
    path.join(tmpdir(), 'attention-card-design-'),
  );
  const extension = await createTestExtension(directory);
  const context = await chromium.launchPersistentContext(directory, {
    channel: 'chromium',
    headless: process.env.HEADED !== 'true',
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    await initializeTestVault(context);
    await initializeTestProfile(context);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('http://127.0.0.1:4317/article/one');
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await worker.evaluate(async () =>
      attentionVault.privateStorage.set({
        interfaceLanguage: 'ru',
        analysisContext: {
          scenario: 'work',
          availableMinutes: 15,
          intent: 'Принимать решения быстрее',
        },
        novelPassageHighlightsEnabled: true,
      }),
    );
    const trigger = page.locator('[data-attention-trigger]');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const card = page.locator('[data-attention-preview]');
    await expect(card).toHaveCSS('display', 'block');
    await expect(card).toHaveAttribute('data-attention-expanded', 'true');
    await expect
      .poll(() => cardTextContent(context, page, '.context-summary'))
      .toContain('15 мин');
    const compact = (await card.boundingBox())!;
    expect(compact.width).toBeLessThanOrEqual(360);
    expect(compact.height).toBeLessThan(500);
    await card.screenshot({ path: 'output/playwright/card-simple-ru.png' });
    await page.screenshot({ path: 'output/playwright/card-simple-page.png' });
    await clickCardElement(context, page, '.details-summary');
    expect((await card.boundingBox())!.height).toBeGreaterThan(compact.height);
    expect(await cardTextContent(context, page, '.score-detail')).toMatch(
      /\d+\/100/u,
    );
    await card.screenshot({ path: 'output/playwright/card-details-ru.png' });
    await clickCardElement(context, page, '.details-summary');

    const navigationStart = await page.evaluate(() => performance.timeOrigin);
    await clickCardElement(context, page, '.context-summary');
    await selectCardOption(context, page, '.context-scenario', 1);
    await expect(card).toHaveCSS('display', 'block');
    await expect(card).toHaveAttribute('data-attention-scenario', 'work');
    await selectCardOption(context, page, '.context-minutes', 0);
    await fillCardInput(
      context,
      page,
      '.context-intent',
      'Изучить методы работы с вниманием',
    );
    await card.screenshot({ path: 'output/playwright/card-context-ru.png' });
    await expect(card).toHaveAttribute('data-attention-scenario', 'work');
    await clickCardElement(context, page, '.context-apply');
    await expect(card).toHaveAttribute('data-attention-scenario', 'learn');
    await expect
      .poll(() => cardTextContent(context, page, '.context-summary'))
      .toContain('5 мин');
    await expect
      .poll(() =>
        worker.evaluate(
          async () =>
            (await attentionVault.privateStorage.get('analysisContext'))
              .analysisContext,
        ),
      )
      .toMatchObject({
        scenario: 'learn',
        availableMinutes: 5,
        intent: 'Изучить методы работы с вниманием',
      });
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
      navigationStart,
    );

    for (const language of ['en', 'de', 'ar']) {
      await worker.evaluate(
        async (value) =>
          attentionVault.privateStorage.set({ interfaceLanguage: value }),
        language,
      );
      const expectedDetails =
        language === 'en'
          ? 'Why this assessment'
          : language === 'de'
            ? 'Warum diese Bewertung'
            : 'لماذا هذا التقييم';
      await expect
        .poll(() => cardTextContent(context, page, '.details-summary'))
        .toBe(expectedDetails);
      await expect(card).toHaveCSS('display', 'block');
      const box = (await card.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(360);
      expect(box.x + box.width).toBeLessThanOrEqual(1280);
      await card.screenshot({
        path: `output/playwright/card-simple-${language}.png`,
      });
    }
    await page.setViewportSize({ width: 320, height: 600 });
    await expect
      .poll(async () => {
        const box = (await card.boundingBox())!;
        return Math.round(box.x + box.width);
      })
      .toBeLessThanOrEqual(320);
    await card.screenshot({ path: 'output/playwright/card-narrow-ar.png' });
    await page.keyboard.press('Escape');
    await expect(card).toHaveCSS('display', 'none');
    await expect(trigger).toBeFocused();
    await worker.evaluate(async () =>
      attentionVault.privateStorage.set({
        interfaceLanguage: 'ru',
        profileOnboardingComplete: true,
      }),
    );
    const popupCreated = context.waitForEvent('page');
    await worker.evaluate(async () =>
      chrome.tabs.create({
        url: chrome.runtime.getURL('popup.html'),
        active: false,
      }),
    );
    const popup = await popupCreated;
    await expect(popup.locator('#launcher-home')).toBeVisible();
    await popup
      .locator('.shell')
      .screenshot({ path: 'output/playwright/popup-simple-ru.png' });
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
