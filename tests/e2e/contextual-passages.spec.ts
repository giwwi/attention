import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestExtension, initializeTestVault } from './helpers/vault';
import { initializeTestProfile } from './helpers/profile';
import {
  cardTextContent,
  clickCardElement,
  fillCardInput,
} from './helpers/card';

const useful =
  'Compare model evaluation methods on separate test examples before selecting a benchmark. Keep the evaluation data out of the training set.';
const caveat =
  'However, this comparison only applies when the test examples represent the actual tasks and users.';

for (const mode of ['local', 'ai'] as const)
  test(`${mode}: contextual passages retain caveats and disappear after article mutation`, async () => {
    test.setTimeout(60_000);
    const directory = await mkdtemp(
      path.join(tmpdir(), 'attention-context-passages-'),
    );
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
      await worker.evaluate(
        async ({ mode, useful }) => {
          await attentionVault.privateStorage.set({
            interfaceLanguage: 'ru',
            analysisContext: {
              scenario: 'work',
              intent: 'compare model evaluation methods',
              availableMinutes: 15,
            },
            novelPassageHighlightsEnabled: true,
            privacySettings: {
              localOnly: mode === 'local',
              updatedAt: new Date().toISOString(),
            },
            aiAnalyzerSettings: {
              provider: 'vercel-ai-gateway',
              model: 'google/gemini-2.5-flash-lite',
              apiKey: 'test-only-fixture-gateway-key',
              updatedAt: new Date().toISOString(),
            },
          });
          (
            globalThis as unknown as { passageRequests: number }
          ).passageRequests = 0;
          globalThis.fetch = async (_url, init) => {
            (globalThis as unknown as { passageRequests: number })
              .passageRequests++;
            const strings = (value: unknown): string[] =>
              typeof value === 'string'
                ? [value]
                : value && typeof value === 'object'
                  ? Object.values(value).flatMap(strings)
                  : [];
            const prompt = strings(JSON.parse(String(init?.body ?? '{}'))).find(
              (text) => text.includes('"coreIds"'),
            );
            let output: unknown;
            if (prompt) {
              const batch = JSON.parse(
                prompt.slice(prompt.lastIndexOf('\n') + 1),
              );
              const index = batch.blocks.findIndex(
                (block: { text: string }) => block.text === useful,
              );
              const block = batch.blocks[index];
              output = {
                passages: [
                  {
                    coreBlockId: block.id,
                    contextBlockIds: [block.id, batch.blocks[index + 1].id],
                    queryIndex: 0,
                    relevance: 0.9,
                    confidence: 0.9,
                    contextSufficient: true,
                    contribution: 'A comparison procedure and its limitation.',
                    knowledgeEvidenceIds: [],
                    possiblyNew: true,
                  },
                ],
              };
            } else {
              output = {
                relevance: 85,
                actionability: 85,
                keyClaims: [
                  {
                    claim: useful,
                    sourceExcerpt: useful,
                    type: 'recommendation',
                    importance: 'supporting',
                    knownProbability: 0.5,
                    noveltyReason: 'Unknown familiarity',
                    confidence: 0.4,
                  },
                ],
                noveltySummary: 'Unknown familiarity',
                noveltyConfidence: 0.4,
                qualityBreakdown: {
                  evidence: 60,
                  reasoning: 60,
                  specificity: 60,
                  calibration: 60,
                },
                qualitySummary: 'A practical explanation.',
                qualityStrengths: [],
                qualityLimitations: ['Sources not independently verified.'],
                qualityConfidence: 0.6,
                reason: 'Relevant to comparison.',
                recommendedSections: [],
                confidence: 0.8,
              };
            }
            return Response.json({
              content: [{ type: 'text', text: JSON.stringify(output) }],
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 100 },
                outputTokens: { total: 100 },
              },
            });
          };
        },
        { mode, useful },
      );
      const url = 'http://127.0.0.1:4317/article/context-passages';
      await context.route(url, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Evaluation methods</title><style>body{font:18px/1.6 system-ui;margin:0;color:#142b24;background:#f7f8f4}article{max-width:760px;margin:48px auto}p{margin:26px 0}h1{font-size:38px}.intro{min-height:800px}h2{margin-top:50px}</style><article><h1>Evaluation methods</h1><h2>Background</h2><p class="intro">${'General background describes the history of software and offers introductory observations for readers. '.repeat(14)}</p><h2>Practical comparison</h2><p id="core">${useful}</p><p id="caveat">${caveat}</p><h2>Further reading</h2><p>Other publications discuss unrelated questions about industrial history.</p></article></html>`,
        }),
      );
      const page = await context.newPage();
      await page.goto(url);
      await page.locator('h1').hover();
      await expect(page.locator('[data-attention-preview]')).toHaveCSS(
        'display',
        'block',
      );
      if (mode === 'ai') {
        await clickCardElement(context, page, '.ai-button');
        await expect(page.locator('[data-attention-preview]')).toHaveAttribute(
          'data-attention-analysis-source',
          'ai',
        );
      }
      await expect
        .poll(() => cardTextContent(context, page, '.passages-button'))
        .toBe('Перейти к 1 фрагменту');
      expect(await cardTextContent(context, page, '.passage-hint')).not.toMatch(
        /новыми|новое/,
      );
      const requests = await worker.evaluate(
        () =>
          (globalThis as unknown as { passageRequests: number })
            .passageRequests,
      );
      expect(requests).toBe(mode === 'local' ? 0 : 2);
      await clickCardElement(context, page, '.passages-button');
      const panel = page.locator('[data-attention-novel-passages]');
      await expect(panel).toBeVisible();
      const excerpt = await cardTextContent(
        context,
        page,
        '.excerpt',
        'data-attention-novel-passages',
      );
      expect(excerpt).toContain(useful);
      expect(excerpt).toContain(caveat);
      const ranges = await page.evaluate(() =>
        [...(CSS.highlights?.get('attention-potential-new') ?? [])].map(
          (range) => range.toString(),
        ),
      );
      expect(ranges).toEqual([useful, caveat]);
      await expect
        .poll(() =>
          page
            .locator('#core')
            .evaluate(
              (element) =>
                element.getBoundingClientRect().top >= 0 &&
                document.querySelector('#caveat')!.getBoundingClientRect()
                  .bottom < innerHeight &&
                (element.getBoundingClientRect().top < innerHeight * 0.65 ||
                  Math.abs(
                    scrollY -
                      (document.scrollingElement!.scrollHeight - innerHeight),
                  ) < 2),
            ),
        )
        .toBe(true);
      await page.screenshot({
        path: `output/playwright/contextual-passages-${mode}.png`,
      });
      await page.locator('#caveat').evaluate((element) => {
        element.textContent = 'The article was changed after the analysis.';
      });
      await expect(panel).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          CSS.highlights?.has('attention-potential-new'),
        ),
      ).toBe(false);
      if (mode === 'local') {
        await page.locator('[data-attention-trigger]').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-attention-preview]')).toHaveCSS(
          'display',
          'block',
        );
        await clickCardElement(context, page, '.context-summary');
        await fillCardInput(
          context,
          page,
          '.context-intent',
          'underwater coral restoration',
        );
        await clickCardElement(context, page, '.context-apply');
        await expect
          .poll(() => cardTextContent(context, page, '.context-summary'))
          .toContain('underwater coral restoration');
        await expect
          .poll(() => cardTextContent(context, page, '.passage-hint'))
          .toBe('Не нашла явно подходящих фрагментов.');
      }
    } finally {
      await context.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
