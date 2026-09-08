import { initializeTestProfile } from './helpers/profile';
import { createTestExtension, initializeTestVault } from './helpers/vault';
import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizePortableProfile } from '../../src/profile/normalize';
import type { MaterialMemoryRecord } from '../../src/memory/material-memory';

test('a matching personal goal cannot promote an unrelated article', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'attention-relevance-'));
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
    const goal = 'Optimize PostgreSQL database indexes';
    const personalProfile = normalizePortableProfile(
      {
        schemaVersion: '2.0',
        generatedAt: null,
        interests: [],
        goals: [{ goal, priority: 'high', status: 'active', confidence: 1 }],
        expertise: [],
        contentPreferences: null,
        lowValueTopics: [],
        demonstratedKnowledge: [],
        learningAreas: [],
        uncertainties: [],
        leisureProfile: {
          status: 'insufficient_data',
          preferences: [],
          noveltyPreference: null,
          effortPreference: null,
          typicalSessionMinutes: null,
          confidence: 0,
        },
      },
      'manual',
    );
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await worker.evaluate(
      async ({ goal }) => {
        await attentionVault.privateStorage.set({
          profileOnboardingComplete: true,
          analysisContext: {
            scenario: 'work',
            intent: goal,
            availableMinutes: 15,
          },
        });
      },
      { goal },
    );
    const articleUrl = 'http://127.0.0.1:4317/article/pottery';
    await context.route(articleUrl, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><head><title>Ancient ceramic pottery</title>
        <meta property="og:title" content="Ancient ceramic pottery">
        <style>body{font:18px/1.5 system-ui}article{max-width:740px;margin:60px auto}h1{font-size:38px}</style>
        </head><body><article><h1>Ancient ceramic pottery</h1><p>Pottery fragments from an ancient village.</p>
        <h2>Vessels and fragments</h2>${'<p>Archaeologists examine ceramic vessels from an ancient village. The fragments illustrate historical pottery techniques and traditional kiln construction.</p>'.repeat(24)}
        </article></body></html>`,
      }),
    );
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(articleUrl);
    await page.locator('h1').hover();
    const card = page.locator('[data-attention-preview="true"]');
    await expect(card).toHaveAttribute(
      'data-attention-source',
      'full-analysis',
    );
    const evaluation = () =>
      worker.evaluate(async (url) => {
        const stored =
          await attentionVault.privateStorage.get('materialMemory');
        const records = stored.materialMemory as
          MaterialMemoryRecord[] | undefined;
        return records?.find((record) => record.url === url)?.storedEvaluation
          ?.evaluation;
      }, articleUrl);
    await expect.poll(evaluation).toBeTruthy();
    const before = await evaluation();
    const profileVersion = () =>
      worker.evaluate(async (url) => {
        const stored =
          await attentionVault.privateStorage.get('materialMemory');
        return (
          stored.materialMemory as MaterialMemoryRecord[] | undefined
        )?.find((record) => record.url === url)?.storedEvaluation?.cacheVersion
          ?.profile;
      }, articleUrl);
    const previousProfileVersion = await profileVersion();

    await page.mouse.move(5, 5);
    await worker.evaluate(async (profile) => {
      await attentionVault.privateStorage.set({ personalProfile: profile });
    }, personalProfile);
    // The new profile invalidates the open page: no reload should be necessary.
    await expect(card).toHaveCSS('display', 'none');
    await page.locator('h1').hover();
    await expect(card).toHaveCSS('display', 'block');
    await expect(card).toHaveAttribute(
      'data-attention-source',
      'full-analysis',
    );
    await expect.poll(profileVersion).not.toBe(previousProfileVersion);
    await expect
      .poll(async () => (await evaluation())?.profileSignals)
      .toEqual([]);
    const after = await evaluation();
    expect(after?.utilityScore).toBe(before?.utilityScore);
    expect(after?.recommendedAction).not.toBe('read');
    expect(after?.profileSignals.some((signal) => signal.kind === 'goal')).toBe(
      false,
    );
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('identical articles receive the same full evaluation across URL shapes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'attention-url-shapes-'));
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
    const html = `<!doctype html><html lang="en"><head><title>Methods for evaluating practical evidence</title></head><body><article><h1>Methods for evaluating practical evidence</h1><h2>Testable practical steps</h2>${'<p>Careful evidence evaluation requires a concrete method. Compare measured results with initial predictions, examine causal mechanisms and limitations, and document practical examples.</p>'.repeat(25)}</article></body></html>`;
    const paths = [
      '/article/evidence',
      '/evidence.html',
      '/a-short-slug',
      '/view?id=17',
    ];
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const page = context.pages()[0] ?? (await context.newPage());
    const evaluations: unknown[] = [];
    for (const pathname of paths) {
      const url = `http://127.0.0.1:4317${pathname}`;
      await context.route(url, (route) =>
        route.fulfill({ contentType: 'text/html', body: html }),
      );
      await page.goto(url);
      await page.locator('[data-attention-trigger]').focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-attention-preview]')).toHaveAttribute(
        'data-attention-source',
        'full-analysis',
      );
      const read = () =>
        worker.evaluate(async (url) => {
          const records = (
            await attentionVault.privateStorage.get('materialMemory')
          ).materialMemory as MaterialMemoryRecord[] | undefined;
          const evaluation = records?.find((record) => record.url === url)
            ?.storedEvaluation?.evaluation;
          return (
            evaluation && {
              utility: evaluation.utilityScore,
              components: evaluation.components,
              action: evaluation.recommendedAction,
            }
          );
        }, url);
      await expect.poll(read).toBeTruthy();
      evaluations.push(await read());
    }
    for (const evaluation of evaluations.slice(1))
      expect(evaluation).toEqual(evaluations[0]);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
