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
import { PROFILE_WEB_URLS } from '../../src/profile/provider-sites';
import { PROFILE_PROVIDERS } from '../../src/profile/providers';
import { PROFILE_IMPORT } from './helpers/profile';

for (const provider of [
  'chatgpt',
  'gemini',
  'copilot',
  'perplexity',
] as const) {
  const providerName = PROFILE_PROVIDERS[provider].name;
  const origin = new URL(PROFILE_WEB_URLS[provider]).origin;
  test(`fresh ${provider} setup: copy, open, paste, return and protect profile`, async () => {
    test.setTimeout(60_000);
    const directory = await mkdtemp(path.join(tmpdir(), 'attention-handoff-'));
    const extension = await createTestExtension(directory);
    const context = await chromium.launchPersistentContext(directory, {
      channel: 'chromium',
      headless: process.env.HEADED !== 'true',
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        `--host-resolver-rules=MAP ${new URL(origin).hostname} ~NOTFOUND`,
      ],
    });
    try {
      // Real extension messages; assistant pages use a local fixture, without an account or AI call.
      await context.route(`${origin}/**`, (route) =>
        route.fulfill({
          contentType: 'text/html',
          headers: { 'Permissions-Policy': 'clipboard-write=()' },
          body: '<!doctype html><html><head><title>ChatGPT handoff test</title></head><body><h1>ChatGPT</h1><textarea aria-label="Message"></textarea></body></html>',
        }),
      );
      const worker = await extensionWorker(context);
      const setup = await context.newPage();
      await setup.goto(
        `chrome-extension://${new URL(worker.url()).host}/popup.html?language=ru`,
      );
      await setup.locator('#profile-start').click();
      if (provider === 'chatgpt') {
        const language = setup.locator(
          '#profile-onboarding .onboarding-language select',
        );
        await language.selectOption('en');
        await expect(
          setup.locator('.profile-provider-choices strong'),
        ).toHaveText([
          'Let ChatGPT introduce me',
          'Let Claude introduce me',
          'Let Gemini introduce me',
          'Let Copilot introduce me',
          'Let Perplexity introduce me',
        ]);
        await setup.screenshot({
          path: 'output/playwright/profile-provider-choices-en.png',
          fullPage: true,
        });
        await language.selectOption('ru');
      }
      await setup.locator(`[data-profile-source="${provider}"]`).click();
      await expect(setup.locator('#profile-prompt-step')).toBeVisible();
      const opened = context.waitForEvent('page');
      await setup.locator('#reopen-profile-provider').click();
      const chat = await opened;
      // Extension-created tabs can start navigating before Playwright attaches.
      // Reload through the routed fixture once attached; DNS is disabled above.
      await chat.goto(`${origin}/?attention-handoff-test=1`);
      await expect(
        chat.getByRole('textbox', { name: 'Message' }),
      ).toBeVisible();
      await chat.bringToFront();
      const notice = chat.locator('[data-attention-profile-handoff-notice]');
      await expect(notice).toBeVisible();
      await expect(notice.locator('strong')).toHaveText(
        'Промпт Attention уже скопирован',
      );
      await expect(notice).toContainText(`в поле сообщения ${providerName}`);
      await expect(notice).toContainText(
        'скопируйте весь ответ и вставьте его во вкладке настройки Attention',
      );
      expect(await worker.evaluate(() => attentionVault.getVaultStatus())).toBe(
        'unconfigured',
      );
      await expect(setup.locator('#vault-password')).toHaveCount(0);
      const raw = await readRawVaultStorage(worker);
      expect(
        Object.keys(
          raw.session.attentionFirstRunHandoffNotice as object,
        ).sort(),
      ).toEqual([
        'language',
        'method',
        'ownerDocumentId',
        'profileImportProvider',
        'profileImportStage',
        'promptCopied',
        'startedAt',
      ]);
      expect(raw.local).toEqual({});
      expect(JSON.stringify(raw)).not.toContain('personalProfile');
      await chat.screenshot({
        path: `output/playwright/first-run-${provider}-notice.png`,
      });
      await notice.getByRole('button', { name: 'Скопировать ещё раз' }).click();
      await expect(notice).toContainText('Скопировано ✓');
      await chat.getByRole('textbox', { name: 'Message' }).focus();
      await chat.keyboard.press(
        process.platform === 'darwin' ? 'Meta+V' : 'Control+V',
      );
      await expect(chat.getByRole('textbox', { name: 'Message' })).toHaveValue(
        PROFILE_PROVIDERS[provider].prompt,
      );
      await expect(notice).toHaveCount(0);

      await setup.bringToFront();
      await expect(setup.locator('#profile-provider-title')).toContainText(
        providerName,
      );
      await setup.locator('#profile-import-json').fill(PROFILE_IMPORT);
      await setup.locator('#validate-profile').click();
      await expect(setup.locator('#profile-review-step')).toBeVisible();
      await setup.locator('#save-profile').click();
      await createVaultThroughUi(setup);
      await expect(setup.locator('#profile-complete-step')).toBeVisible();
      const saved = await worker.evaluate(async () =>
        attentionVault.privateStorage.get([
          'personalProfile',
          'profileImportHistory',
        ]),
      );
      expect(saved.profileImportHistory).toEqual([
        expect.objectContaining({ source: provider }),
      ]);
      expect(
        (
          saved.personalProfile as {
            interests: { sources: { source: string }[] }[];
          }
        ).interests[0]!.sources[0]!.source,
      ).toBe(provider);
      const protectedStorage = await readRawVaultStorage(worker);
      expect(
        protectedStorage.session.attentionFirstRunHandoffNotice,
      ).toBeUndefined();
      expect(JSON.stringify(protectedStorage.local)).not.toContain(
        'Software quality',
      );
      await setup.close();
    } finally {
      await context.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
