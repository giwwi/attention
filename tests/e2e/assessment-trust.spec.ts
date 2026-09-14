import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestExtension, initializeTestVault } from './helpers/vault';
import { initializeTestProfile } from './helpers/profile';
import {
  cardTextContent,
  clickCardElement,
  shadowElementState,
} from './helpers/card';
import { EXTENSION_RUNTIME_VERSION } from '../../src/shared/version';

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
                  passages:
                    mode === 'partial-ai'
                      ? [
                          {
                            passageId: payload.material.passages[0].id,
                            queryIndex: 0,
                            relevance: 90,
                            confidence: 0.9,
                            contextSufficient: true,
                            contribution: 'A concrete caching procedure.',
                            knowledgeEvidenceIds: [],
                            possiblyNew: false,
                          },
                        ]
                      : [],
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
      // The fixture can load before the extension finishes installing listeners.
      await page
        .locator('[data-attention-trigger]')
        .waitFor({ state: 'attached' });
      await page.locator('h1').hover();
      const card = page.locator('[data-attention-preview]');
      await expect(card).toBeVisible();
      if (mode === 'partial-ai' || mode === 'partial-low') {
        await clickCardElement(context, page, '.ai-button');
        await expect(card).toHaveAttribute(
          'data-attention-analysis-source',
          'ai',
        );
        await expect
          .poll(() =>
            worker.evaluate(async () => {
              const stored = await attentionVault.privateStorage.get(
                'lastAiAnalysisDiagnostic',
              );
              return (
                stored.lastAiAnalysisDiagnostic as {
                  report?: { display?: { matched: number } };
                }
              )?.report?.display?.matched;
            }),
          )
          .toBe(mode === 'partial-ai' ? 1 : 0);
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
      const palettes = [];
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        const surface = await shadowElementState(context, page, '.card');
        expect(surface.colorScheme).toBe(colorScheme);
        palettes.push({
          colorScheme,
          verdict: await card.getAttribute('data-attention-verdict'),
          surface,
          primary: await shadowElementState(
            context,
            page,
            '[data-primary="true"]',
          ),
          muted: await shadowElementState(context, page, '.useful-time'),
        });
        await card.screenshot({
          path: `output/playwright/verdict-${mode}-${colorScheme}.png`,
        });
      }
      await writeFile(
        `output/playwright/verdict-${mode}-palettes.json`,
        JSON.stringify(palettes, null, 2),
      );
      if (mode === 'partial-ai') {
        const previousId = await worker.evaluate(async () => {
          const stored = await attentionVault.privateStorage.get(
            'lastAiAnalysisDiagnostic',
          );
          return (
            stored.lastAiAnalysisDiagnostic as {
              report: { analysisId: string };
            }
          ).report.analysisId;
        });
        await clickCardElement(context, page, '.ai-button');
        await expect
          .poll(() =>
            worker.evaluate(async (previousId) => {
              const stored = await attentionVault.privateStorage.get(
                'lastAiAnalysisDiagnostic',
              );
              const report = (
                stored.lastAiAnalysisDiagnostic as {
                  report?: {
                    analysisId: string;
                    display?: { matched: number };
                  };
                }
              )?.report;
              return (
                report?.analysisId !== previousId &&
                report?.display?.matched === 1
              );
            }, previousId),
          )
          .toBe(true);
        const popup = await context.newPage();
        await popup.goto(
          `chrome-extension://${new URL(worker.url()).host}/popup.html`,
        );
        await popup.locator('#open-popup-settings').click();
        await popup.locator('#open-privacy-settings').click();
        await popup.locator('#export-ai-analysis').scrollIntoViewIfNeeded();
        const pending = popup.waitForEvent('download');
        await popup.locator('#export-ai-analysis').click();
        const download = await pending;
        const contents = await readFile((await download.path())!, 'utf8');
        const report = JSON.parse(contents);
        expect(report).toMatchObject({
          version: EXTENSION_RUNTIME_VERSION,
          status: 'complete',
          input: { coverage: 'partial' },
          output: {
            returned: 1,
            accepted: 1,
            selected: 1,
            candidates: [
              {
                relevance: 0.9,
                relevanceInput: { kind: 'number', value: 90, scale: 'percent' },
                reasons: [],
              },
            ],
          },
          display: { reason: 'matched', matched: 1, fingerprintMatches: true },
        });
        expect(contents).not.toContain(url);
        expect(contents).not.toContain(paragraph);
        expect(contents).not.toContain('test-only-key');
        await download.saveAs(
          'output/ai-prepared-passages-20260914/browser-fixture-report.json',
        );
        await popup.screenshot({
          path: 'output/playwright/ai-passage-scale-download.png',
        });
      }
    } finally {
      await context.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
