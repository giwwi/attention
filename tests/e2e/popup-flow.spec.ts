import { importTestProfile } from './helpers/profile';
import { createTestExtension, createVaultThroughUi } from './helpers/vault';
import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

for (const protectedPage of [false, true]) {
  test(
    protectedPage
      ? 'onboarding on a protected page keeps saved items and settings available'
      : 'popup launches the page card and keeps all article decisions on the page',
    async () => {
      test.setTimeout(90_000);
      const directory = await mkdtemp(
        path.join(tmpdir(), 'attention-popup-flow-'),
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
        const worker = await test.step('extension worker ready', async () =>
          context.serviceWorkers()[0] ??
          (await context.waitForEvent('serviceworker')));
        const article = context.pages()[0] ?? (await context.newPage());
        await test.step('load article', async () =>
          article.goto(
            protectedPage
              ? 'chrome://version/'
              : 'http://127.0.0.1:4317/article/one',
            { waitUntil: 'domcontentloaded' },
          ));
        async function openPopup() {
          const popup = await context.newPage();
          await popup.goto(
            `chrome-extension://${new URL(worker.url()).host}/popup.html`,
          );
          await popup.setViewportSize({ width: 380, height: 850 });
          return popup;
        }
        let popup = await openPopup();
        await createVaultThroughUi(popup);
        await expect(popup.locator('#profile-source-step')).toBeVisible();
        await expect(popup.locator('#profile-setup-settings')).toBeVisible();
        await importTestProfile(popup);
        await expect(popup.locator('#launcher-home')).toBeVisible();
        // The action popup evaluates the selected article tab, not its test document.
        await article.bringToFront();
        const closed = protectedPage ? null : popup.waitForEvent('close');
        await popup.locator('#open-page-card').click();
        if (protectedPage) {
          await expect(popup.locator('#launcher-home')).toBeVisible();
          await expect(popup.locator('#status')).toContainText(
            'Open an article',
          );
        } else {
          await closed;
          const host = article.locator('[data-attention-preview="true"]');
          await expect(host).toHaveCSS('display', 'block');
          await expect(host).toHaveAttribute('data-attention-expanded', 'true');
          popup = await openPopup();
        }
        await expect(popup.locator('#launcher-home')).toBeVisible();
        await expect(
          popup.locator('#result, #decision-context, [data-decision]'),
        ).toHaveCount(0);
        const before = await worker.evaluate(
          async () =>
            (await attentionVault.privateStorage.get('latestEvaluation'))
              .latestEvaluation,
        );
        await popup.waitForTimeout(350);
        expect(
          await worker.evaluate(
            async () =>
              (await attentionVault.privateStorage.get('latestEvaluation'))
                .latestEvaluation,
          ),
        ).toEqual(before);
        await popup.locator('#open-saved-materials').click();
        await expect(popup.locator('#saved-materials-view')).toBeVisible();
        await popup.locator('#close-saved-materials').click();
        await expect(popup.locator('#launcher-home')).toBeVisible();
        await popup.locator('#open-popup-settings').click();
        await expect(popup.locator('#settings-home')).toBeVisible();
        for (const language of [
          'de',
          'es',
          'fr',
          'it',
          'zh',
          'ar',
          'hi',
          'ru',
          'en',
        ]) {
          await popup.locator('#interface-language').selectOption(language);
          await expect(popup.locator('html')).toHaveAttribute('lang', language);
          await expect(popup.locator('html')).toHaveAttribute(
            'dir',
            language === 'ar' ? 'rtl' : 'ltr',
          );
          if (!protectedPage && ['de', 'ar'].includes(language)) {
            await popup.screenshot({
              path: `output/playwright/popup-settings-${language}.png`,
              fullPage: true,
            });
          }
          if (language !== 'ru') {
            // Native language names in the language picker intentionally retain their script.
            const copy = await popup
              .locator('#settings-home')
              .evaluate((element) => {
                const clone = element.cloneNode(true) as HTMLElement;
                clone.querySelector('select')?.remove();
                return clone.textContent ?? '';
              });
            expect(copy).not.toMatch(/[а-яё]/iu);
          }
        }
        await popup.locator('#open-profile-import').click();
        await expect(popup.locator('#profile-source-step')).toBeVisible();
        for (const id of [
          'open-readwise-settings',
          'open-obsidian-settings',
          'open-notion-settings',
          'open-browser-history',
        ])
          await expect(popup.locator(`#${id}`)).toBeVisible();
        if (!protectedPage)
          await popup.screenshot({
            path: 'output/playwright/popup-sources.png',
            fullPage: true,
          });
        await popup.locator('#open-readwise-settings').click();
        await expect(popup.locator('#readwise-settings')).toBeVisible();
        await popup.locator('#close-readwise-settings').click();
        await expect(popup.locator('#profile-source-step')).toBeVisible();
        await popup.locator('#open-browser-history').click();
        await expect(popup.locator('#browser-history-setup')).toBeVisible();
        await popup.locator('#close-browser-history').click();
        await popup.locator('#skip-profile').click();
        await expect(popup.locator('#launcher-home')).toBeVisible();
        await popup.screenshot({
          path: `output/playwright/popup-launcher-${protectedPage ? 'protected' : 'article'}.png`,
          fullPage: true,
        });
        // Keyboard access uses the same visible primary action as pointer input.
        await popup.locator('#open-page-card').focus();
        await expect(popup.locator('#open-page-card')).toBeFocused();
      } finally {
        await context.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
