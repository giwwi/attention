import { initializeTestProfile } from './helpers/profile';
import { createTestExtension, initializeTestVault } from './helpers/vault';
import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  clickCardElement,
  fillCardInput,
  shadowElementState,
} from './helpers/card';

function luminance(color: string): number {
  const channels = color
    .match(/[\d.]+/gu)!
    .slice(0, 3)
    .map(Number)
    .map((value) => {
      const channel = value / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function expectReadable(state: { color: string; background: string }): void {
  const values = [luminance(state.color), luminance(state.background)].sort(
    (a, b) => a - b,
  );
  expect((values[1]! + 0.05) / (values[0]! + 0.05)).toBeGreaterThanOrEqual(4.5);
}

test('cards and popup follow live system theme changes without losing the current decision or draft', async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'attention-theme-'));
  const extension = await createTestExtension(directory);
  const context = await chromium.launchPersistentContext(directory, {
    channel: 'chromium',
    colorScheme: 'dark',
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
    await page.addStyleTag({
      content:
        'html { color-scheme: light dark; } @media (prefers-color-scheme: dark) { body { background: #141917; color: #e1e8e3; } }',
    });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await worker.evaluate(async () =>
      attentionVault.privateStorage.set({
        interfaceLanguage: 'ru',
        profileOnboardingComplete: true,
      }),
    );
    await page.locator('[data-attention-trigger]').focus();
    await page.keyboard.press('Enter');
    const card = page.locator('[data-attention-preview]');
    await expect(card).toHaveCSS('display', 'block');
    await expect(card).toHaveAttribute('data-attention-expanded', 'true');
    const navigationStart = await page.evaluate(() => performance.timeOrigin);
    const score = await card.getAttribute('data-attention-score');
    const dark = await shadowElementState(context, page, '.card');
    expect(dark.colorScheme).toBe('dark');
    expectReadable(dark);
    expectReadable(
      await shadowElementState(context, page, '[data-primary="true"]'),
    );
    await card.screenshot({ path: 'output/playwright/card-theme-dark.png' });
    await page.screenshot({
      path: 'output/playwright/card-theme-dark-page.png',
    });
    await clickCardElement(context, page, '.details-summary');
    await card.screenshot({
      path: 'output/playwright/card-theme-dark-details.png',
    });
    await clickCardElement(context, page, '.details-summary');
    await clickCardElement(context, page, '.context-summary');
    await fillCardInput(
      context,
      page,
      '.context-intent',
      'Сохранить этот черновик цели',
    );
    expectReadable(await shadowElementState(context, page, '.context-intent'));
    await card.screenshot({
      path: 'output/playwright/card-theme-dark-context.png',
    });

    await page.emulateMedia({ colorScheme: 'light' });
    await expect
      .poll(
        async () =>
          (await shadowElementState(context, page, '.card')).colorScheme,
      )
      .toBe('light');
    const light = await shadowElementState(context, page, '.card');
    expect(light.background).not.toBe(dark.background);
    expectReadable(light);
    expectReadable(
      await shadowElementState(context, page, '[data-primary="true"]'),
    );
    expect(
      await shadowElementState(context, page, '.context-intent'),
    ).toMatchObject({
      value: 'Сохранить этот черновик цели',
      focused: true,
      colorScheme: 'light',
    });
    expect(
      (await shadowElementState(context, page, '.card-context')).open,
    ).toBe(true);
    await expect(card).toHaveAttribute('data-attention-score', score!);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
      navigationStart,
    );
    await card.screenshot({
      path: 'output/playwright/card-theme-light-context.png',
    });
    await clickCardElement(context, page, '.context-summary');
    await card.screenshot({ path: 'output/playwright/card-theme-light.png' });
    await page.keyboard.press('Escape');

    const created = context.waitForEvent('page');
    await worker.evaluate(async () =>
      chrome.tabs.create({
        url: chrome.runtime.getURL('popup.html'),
        active: false,
      }),
    );
    const popup = await created;
    await expect(popup.locator('#launcher-home')).toBeVisible();
    await expect(popup.locator('html')).toHaveCSS('color-scheme', 'dark');
    await popup
      .locator('.shell')
      .screenshot({ path: 'output/playwright/popup-theme-dark.png' });
    await popup.locator('#open-popup-settings').click();
    await popup
      .locator('.shell')
      .screenshot({ path: 'output/playwright/popup-theme-dark-settings.png' });
    const popupOrigin = await popup.evaluate(() => performance.timeOrigin);
    await popup.emulateMedia({ colorScheme: 'light' });
    await expect(popup.locator('html')).toHaveCSS('color-scheme', 'light');
    await expect(popup.locator('#settings-home')).toBeVisible();
    expect(await popup.evaluate(() => performance.timeOrigin)).toBe(
      popupOrigin,
    );
    await popup.emulateMedia({ colorScheme: 'dark' });
    await expect(popup.locator('html')).toHaveCSS('color-scheme', 'dark');
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
