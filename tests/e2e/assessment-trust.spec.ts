import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestExtension, initializeTestVault } from './helpers/vault';
import { initializeTestProfile } from './helpers/profile';
import { cardTextContent, clickCardElement } from './helpers/card';

for (const mode of [
  'title-only',
  'local-topic',
  'partial-ai',
  'partial-low',
] as const)
  test(`${mode}: shows a decision with its evidence limits`, async () => {
    test.setTimeout(60_000);
    const directory = await mkdtemp(path.join(tmpdir(), 'attention-trust-'));
    const extension = await createTestExtension(directory);
    const context = await chromium.launchPersistentContext(directory, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1360, height: 1000 },
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    try {
      await initializeTestVault(context);
      await initializeTestProfile(context);
      const worker = context.serviceWorkers()[0]!;
      await worker.evaluate(async (mode) => {
        await attentionVault.privateStorage.set({
          interfaceLanguage: 'ru',
          novelPassageHighlightsEnabled: true,
          analysisContext: {
            scenario: 'work',
            intent:
              mode === 'local-topic'
                ? 'искусственный интеллект исследование'
                : 'Reduce AI inference latency in our production service',
            availableMinutes: 15,
          },
          privacySettings: {
            localOnly: mode === 'title-only' || mode === 'local-topic',
            updatedAt: new Date().toISOString(),
          },
          aiAnalyzerSettings: {
            provider: 'vercel-ai-gateway',
            model: 'google/gemini-2.5-flash-lite',
            apiKey: 'test-only-key',
            updatedAt: new Date().toISOString(),
          },
        });
        globalThis.fetch = async (_url, init) => {
          const strings = (value: unknown): string[] =>
            typeof value === 'string'
              ? [value]
              : value && typeof value === 'object'
                ? Object.values(value).flatMap(strings)
                : [];
          const prompt = strings(JSON.parse(String(init?.body ?? '{}'))).find(
            (text) => text.includes('BEGIN_UNTRUSTED_MATERIAL_JSON'),
          )!;
          const payload = JSON.parse(
            prompt
              .split('BEGIN_UNTRUSTED_MATERIAL_JSON\n')[1]!
              .split('\nEND_UNTRUSTED_MATERIAL_JSON')[0]!,
          );
          if (payload.material.coverage !== 'partial')
            throw new Error('Expected partial source coverage');
          const source = payload.material.blocks[0].text.slice(0, 350);
          return Response.json({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  relevance: mode === 'partial-low' ? 5 : 100,
                  actionability: mode === 'partial-low' ? 5 : 100,
                  keyClaims: [
                    {
                      claim: source,
                      sourceExcerpt: source,
                      type: 'fact',
                      importance: 'primary',
                      knownProbability: mode === 'partial-low' ? 0.95 : 0.5,
                      noveltyReason: 'Unknown familiarity',
                      confidence: 0.8,
                    },
                  ],
                  noveltySummary: 'Unknown familiarity',
                  noveltyConfidence: 0.8,
                  qualityBreakdown: {
                    evidence: 100,
                    reasoning: 100,
                    specificity: 100,
                    calibration: 100,
                  },
                  qualitySummary: 'Explanations are present.',
                  qualityStrengths: [],
                  qualityLimitations: ['Sources not verified.'],
                  qualityConfidence: 0.8,
                  reason:
                    mode === 'partial-low'
                      ? 'В рассмотренных частях описан фестиваль. Приёмов сокращения задержки модели здесь нет.'
                      : 'В рассмотренных частях есть приёмы кеширования запросов и измерения задержки модели.',
                  recommendedSections: [],
                  confidence: 1,
                  passages: [],
                }),
              },
            ],
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: 100 },
              outputTokens: { total: 100 },
            },
          });
        };
      }, mode);
      const paragraph =
        mode === 'local-topic'
          ? 'Artificial intelligence research compares evaluation procedures on separate examples and records their limitations before deployment.'
          : mode === 'partial-ai'
            ? 'To reduce AI inference latency in our production service, configure caching for repeated requests and measure response times on representative workloads. However, the cached result must remain valid for each request.'
            : 'The community festival brings musicians and artists together for a weekend of food, music and performances. Visitors can explore the stalls and enjoy the evening lantern walk.';
      const body =
        mode === 'title-only' || mode === 'local-topic'
          ? Array.from({ length: 8 }, () => `<p>${paragraph}</p>`).join('')
          : Array.from(
              { length: 45 },
              (_, i) =>
                `${i % 15 === 0 ? `<h2>Section ${i / 15}</h2>` : ''}<p>Paragraph ${i}. ${paragraph.repeat(12)}</p>`,
            ).join('');
      const url = `http://127.0.0.1:4317/article/${mode}`;
      await context.route(url, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="en"><meta charset="utf-8"><title>An AI community festival</title><style>body{font:18px/1.7 system-ui;background:#f7f8f4;color:#193528}article{max-width:740px;margin:50px auto}h1{font-size:38px}</style><article><h1>An AI community festival</h1>${body}</article></html>`,
        }),
      );
      const page = await context.newPage();
      await page.goto(url);
      await page.locator('h1').hover();
      const card = page.locator('[data-attention-preview]');
      await expect(card).toBeVisible();
      if (mode === 'partial-ai' || mode === 'partial-low') {
        await clickCardElement(context, page, '.ai-button');
        await expect(card).toHaveAttribute(
          'data-attention-analysis-source',
          'ai',
        );
      }
      await expect
        .poll(() => cardTextContent(context, page, '.verdict'))
        .toContain(
          mode === 'local-topic'
            ? 'Начните с фрагментов'
            : mode === 'partial-ai'
              ? 'Скорее стоит прочитать'
              : 'Скорее можно пропустить',
        );
      if (mode === 'partial-ai' || mode === 'partial-low') {
        await expect
          .poll(() => cardTextContent(context, page, '.reliability-note'))
          .toContain('Вывод предварительный');
        await expect
          .poll(() => cardTextContent(context, page, '.score'))
          .toContain(mode === 'partial-ai' ? 'кеширования' : 'фестиваль');
      }
      if (mode === 'local-topic') {
        await expect
          .poll(() => cardTextContent(context, page, '.score'))
          .toContain('искусственный интеллект исследование');
        await expect
          .poll(() => cardTextContent(context, page, '.passages-button'))
          .toContain('Перейти к');
      }
      await page.screenshot({ path: `output/playwright/trust-${mode}.png` });
    } finally {
      await context.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
