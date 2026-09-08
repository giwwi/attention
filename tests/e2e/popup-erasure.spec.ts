import { initializeTestProfile } from './helpers/profile';
import {
  createTestExtension,
  initializeTestVault,
  expectVaultEmpty,
} from './helpers/vault';
import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('erasure from another extension page invalidates a displayed popup without recapturing', async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(
    path.join(tmpdir(), 'attention-popup-erasure-'),
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
    await initializeTestVault(context);
    await initializeTestProfile(context);
    const article = context.pages()[0] ?? (await context.newPage());
    await article.goto('http://127.0.0.1:4317/article/one');
    const worker = await test.step('extension worker ready', async () =>
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker')));
    async function openPopup() {
      const opened = context.waitForEvent('page');
      await test.step('create popup', async () =>
        worker.evaluate(async () => {
          await chrome.tabs.create({
            url: chrome.runtime.getURL('popup.html'),
            active: false,
          });
        }));
      return await opened;
    }
    await test.step('seed completed onboarding', async () =>
      worker.evaluate(async () => {
        await attentionVault.privateStorage.set({
          profileOnboardingComplete: true,
        });
      }));
    const oldPopup = await openPopup();
    await expect(oldPopup.locator('#launcher-home')).toBeVisible();
    const staleOpen = await oldPopup.locator('#open-page-card').elementHandle();
    const erasingPopup = await openPopup();
    await expect(erasingPopup.locator('#launcher-home')).toBeVisible();
    await erasingPopup.locator('#open-popup-settings').click();
    await erasingPopup.locator('#open-privacy-settings').click();
    erasingPopup.once('dialog', (dialog) => dialog.accept());
    await erasingPopup.locator('#delete-all-data').click();
    await expect(oldPopup.locator('#vault-confirm-password')).toBeVisible();
    await expect(oldPopup.locator('#launcher-home')).toHaveCount(0);
    await expect(oldPopup.locator('#result')).toHaveCount(0);
    // The old JS context is destroyed by the production lock guard. A retained
    // automation handle must be unable to invoke the formerly available action.
    await expect(
      staleOpen!.evaluate((button) => button.click()),
    ).rejects.toThrow();
    await expectVaultEmpty(worker);
    await oldPopup.waitForTimeout(500);
    await expectVaultEmpty(worker);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
