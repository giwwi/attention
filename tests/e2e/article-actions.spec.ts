import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestExtension, initializeTestVault } from './helpers/vault';
import { initializeTestProfile } from './helpers/profile';
import {
  cardTextContent,
  clickCardElement,
  shadowElementState,
} from './helpers/card';

const url = 'http://127.0.0.1:4317/article/no-section-headings';
const claims = [
  'A controlled field experiment found that structured review reduced decision errors by 10 percent.',
  'A second independent study measured a 20 percent reduction in repeated work after introducing a review checklist.',
];

test('article actions jump to real passages without section headings and save with confirmation', async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(
    path.join(tmpdir(), 'attention-article-actions-'),
  );
  const extension = await createTestExtension(directory);
  const context = await chromium.launchPersistentContext(directory, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    await initializeTestVault(context);
    await initializeTestProfile(context);
    await context.route(url, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Reviewing decisions in practice</title>
        <style>html{color-scheme:light dark}body{font:19px/1.7 system-ui;margin:0}article{max-width:700px;margin:48px auto}p{margin:28px 0}.intro{min-height:760px}h1{font-size:36px}</style>
        <article><h1>Reviewing decisions in practice</h1><p class="intro">${'The review process separates observations from assumptions. Teams document practical limitations and compare each conclusion with the evidence before applying it to their work. '.repeat(10)}</p>
        <p id="first-passage">${claims[0]}</p><p>${'The authors explain the methods and limitations in the context of a practical workplace experiment. '.repeat(10)}</p>
        <p id="second-passage">${claims[1]}</p><p>${'Readers should consider the limits of these observations and assess relevance to their own circumstances. '.repeat(8)}</p></article></html>`,
      }),
    );
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await worker.evaluate(async (claims) => {
      await attentionVault.privateStorage.set({
        interfaceLanguage: 'ru',
        analysisContext: {
          scenario: 'work',
          intent: 'structured review decision errors',
          availableMinutes: 15,
        },
        novelPassageHighlightsEnabled: true,
        aiAnalyzerSettings: {
          provider: 'vercel-ai-gateway',
          model: 'google/gemini-2.5-flash-lite',
          apiKey: 'test-only-gateway-key',
          updatedAt: new Date().toISOString(),
        },
        privacySettings: {
          localOnly: false,
          updatedAt: new Date().toISOString(),
        },
      });
      // Authored provider response exercises extraction, real range matching and
      // the production UI without an external request or paid generation.
      globalThis.fetch = async (_url, init) => {
        const strings = (value: unknown): string[] =>
          typeof value === 'string'
            ? [value]
            : value && typeof value === 'object'
              ? Object.values(value).flatMap(strings)
              : [];
        const prompt = strings(JSON.parse(String(init?.body ?? '{}'))).find(
          (text) => text.includes('"coreIds"'),
        );
        const batch = JSON.parse(
          prompt!
            .split('BEGIN_UNTRUSTED_MATERIAL_JSON\n')[1]!
            .split('\nEND_UNTRUSTED_MATERIAL_JSON')[0]!,
        ).material;
        const passages = batch.blocks
          .filter(
            (block: { text: string; id: string }) =>
              batch.coreIds.includes(block.id) && claims.includes(block.text),
          )
          .map((block: { id: string }) => ({
            coreBlockId: block.id,
            contextBlockIds: [block.id],
            queryIndex: 0,
            relevance: 0.9,
            confidence: 0.8,
            contextSufficient: true,
            contribution: 'Evidence relevant to structured review.',
            knowledgeEvidenceIds: [],
            possiblyNew: false,
          }));
        return Response.json({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                passages,
                relevance: 75,
                actionability: 70,
                keyClaims: claims.map((claim) => ({
                  claim,
                  sourceExcerpt: claim,
                  type: 'fact',
                  importance: 'primary',
                  knownProbability: 0.1,
                  noveltyReason: 'No matching personal knowledge.',
                  confidence: 0.8,
                })),
                noveltySummary: 'Two findings may be new.',
                noveltyConfidence: 0.8,
                qualityBreakdown: {
                  evidence: 70,
                  reasoning: 70,
                  specificity: 75,
                  calibration: 70,
                },
                qualitySummary: 'Two concrete findings.',
                qualityStrengths: [],
                qualityLimitations: ['Not independently verified.'],
                qualityConfidence: 0.7,
                reason: 'Практические результаты исследований.',
                recommendedSections: [],
                confidence: 0.8,
              }),
            },
          ],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: { inputTokens: { total: 100 }, outputTokens: { total: 100 } },
        });
      };
    }, claims);
    const page = await context.newPage();
    await page.goto(url);
    const origin = await page.evaluate(() => performance.timeOrigin);
    const card = page.locator('[data-attention-preview]');
    await page.locator('h1').hover();
    await expect(card).toHaveCSS('display', 'block');
    await clickCardElement(context, page, '.ai-button');
    await expect(card).toHaveAttribute('data-attention-analysis-source', 'ai');
    await expect
      .poll(() => cardTextContent(context, page, '.passages-button'))
      .toBe('Перейти к 2 фрагментам');
    expect(await page.locator('article h2, article h3').count()).toBe(0);
    expect(
      await cardTextContent(context, page, '.article-actions'),
    ).not.toMatch(/Читать|Просмотреть|Пропустить/);
    expect(await cardTextContent(context, page, '.card-context')).not.toMatch(
      /5 мин|15 мин|30 мин|Доступное время/,
    );
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await card.screenshot({
        path: `output/playwright/article-actions-${theme}.png`,
      });
    }
    await clickCardElement(context, page, '.passages-button');
    await expect(card).toHaveCSS('display', 'none');
    const panel = page.locator('[data-attention-novel-passages]');
    await expect(panel).toBeVisible();
    expect(
      await cardTextContent(
        context,
        page,
        '.excerpt',
        'data-attention-novel-passages',
      ),
    ).toContain(claims[0]);
    await expect
      .poll(() =>
        page.locator('#first-passage').evaluate((p) => {
          const box = p.getBoundingClientRect();
          return box.top >= 0 && box.bottom < innerHeight;
        }),
      )
      .toBe(true);
    expect(
      await page.evaluate(
        () =>
          CSS.highlights?.has('attention-potential-new') ||
          Boolean(document.querySelector('.attention-potential-new-fallback')),
      ),
    ).toBe(true);
    expect(
      (
        await shadowElementState(
          context,
          page,
          '.close',
          'data-attention-novel-passages',
        )
      ).focused,
    ).toBe(true);
    await page.keyboard.press('Tab'); // Previous is disabled on the first passage.
    await page.keyboard.press('Enter');
    await expect
      .poll(() =>
        cardTextContent(
          context,
          page,
          '.excerpt',
          'data-attention-novel-passages',
        ),
      )
      .toContain(claims[1]);
    await page.screenshot({
      path: 'output/playwright/article-passages-reading.png',
    });
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.locator('[data-attention-trigger]')).toBeFocused();
    await page.locator('[data-attention-trigger]').scrollIntoViewIfNeeded();
    await page.keyboard.press('Enter');
    await expect(card).toHaveCSS('display', 'block');
    await clickCardElement(context, page, '.save-button');
    await expect
      .poll(() => cardTextContent(context, page, '.save-button'))
      .toBe('Сохранено ✓');
    await expect
      .poll(() =>
        worker.evaluate(
          async () =>
            (await attentionVault.privateStorage.get('savedMaterials'))
              .savedMaterials?.length,
        ),
      )
      .toBe(1);
    await expect(card).toHaveCSS('display', 'block');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
