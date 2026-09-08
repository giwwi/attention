import { initializeTestProfile } from './helpers/profile';
import {
  changeScenario,
  createDefaultScenarioState,
} from '../../src/scenario/scenario';
import { createTestExtension, initializeTestVault } from './helpers/vault';
import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clickCardElement, selectCardOption } from './helpers/card';
import type { StoredEvaluation } from '../../src/shared/types';
import type { MaterialMemoryRecord } from '../../src/memory/material-memory';
import type { UtilityCalibrationModel } from '../../src/utility/calibration';
import {
  RAW_UTILITY_SCORE_VERSION,
  UTILITY_CALIBRATION_VERSION,
} from '../../src/utility/prediction';

const articleUrl = 'http://127.0.0.1:4317/article/learning-integrity';
const title = 'Structured review reduces decision errors';
const currentClaim =
  'A controlled field experiment found that structured review reduced decision errors by 10 percent.';
const previousClaim = currentClaim.replace('10 percent', '90 percent');
const calibrationDate = '2026-09-05T00:00:00.000Z';
const workCurve = {
  sampleSize: 8,
  meanPredicted: 80,
  meanActual: 30,
  slope: 1,
  strength: 0.8,
  meanAbsoluteError: 50,
};
const workOnlyCalibration: UtilityCalibrationModel = {
  schemaVersion: 2,
  version: UTILITY_CALIBRATION_VERSION,
  rawScoreVersion: RAW_UTILITY_SCORE_VERSION,
  updatedAt: calibrationDate,
  sampleSize: 8,
  // A populated global curve makes this fail if cross-scenario fallback returns.
  global: workCurve,
  byScenario: { work: workCurve },
};

function articleHtml(): string {
  const supportingParagraph =
    'The article explains how reviewers compare a written decision with the original evidence. ' +
    'The method separates observations from assumptions and records the reason for each change. ' +
    'Participants inspect practical examples, discuss limitations, and document the remaining uncertainty. ' +
    'This evidence supports a careful evaluation of the procedure in ordinary working conditions.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <title>${title}</title><meta property="og:title" content="${title}"></head>
    <body><main><article itemprop="articleBody"><h1>${title}</h1>
    <p>${currentClaim}</p><h2>Method and evidence</h2>
    ${Array.from({ length: 9 }, () => `<p>${supportingParagraph}</p>`).join('')}
    </article></main></body></html>`;
}

test('the article card preserves prediction provenance, isolates scenario calibration, and rejects changed numerical knowledge', async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(
    path.join(tmpdir(), 'attention-learning-integrity-'),
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
    // A network fixture still goes through the extension's real extraction and
    // analyzer. Neither the result DOM nor the evaluation is supplied by the test.
    await context.route(articleUrl, (route) =>
      route.fulfill({ contentType: 'text/html', body: articleHtml() }),
    );
    const article = context.pages()[0] ?? (await context.newPage());
    await article.goto(articleUrl);
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await worker.evaluate(
      async (fixture) => attentionVault.privateStorage.set(fixture),
      {
        attentionScenario: changeScenario(createDefaultScenarioState(), 'work'),
        utilityCalibration: workOnlyCalibration,
        novelPassageFeedback: [
          {
            id: 'known-numerical-claim',
            url: articleUrl,
            title,
            claim: previousClaim,
            excerpt: previousClaim,
            value: 'known',
            createdAt: calibrationDate,
          },
        ],
        claimMemoryRevision: calibrationDate,
      },
    );
    const popup = await context.newPage();
    await popup.goto(
      `chrome-extension://${new URL(worker.url()).host}/popup.html`,
    );
    await expect(popup.locator('#launcher-home')).toBeVisible();
    await article.bringToFront();
    const onboardingClosed = popup.waitForEvent('close');
    await popup.locator('#open-page-card').click();
    await onboardingClosed;
    const card = article.locator('[data-attention-preview]');
    await expect(card).toHaveCSS('display', 'block');
    await expect(card).toHaveAttribute('data-attention-expanded', 'true');
    await expect(card).toHaveAttribute('data-attention-scenario', 'work');
    await expect(card).toHaveAttribute('data-attention-score', /^\d+$/);

    // Page-card evaluations live in material memory; latestEvaluation belonged
    // to the removed popup evaluation surface.
    const readEvaluation = (): Promise<StoredEvaluation | undefined> =>
      worker.evaluate(async (url) => {
        const stored =
          await attentionVault.privateStorage.get('materialMemory');
        const records = (stored.materialMemory ?? []) as MaterialMemoryRecord[];
        return records.find((record) => record.url === url)?.storedEvaluation;
      }, articleUrl);
    const work = (await readEvaluation())!;
    expect(work.url).toBe(articleUrl);
    expect(work.evaluation.analyzerId).toContain('local-');
    expect(work.evaluation.prediction).toMatchObject({
      schemaVersion: 1,
      provenance: 'captured',
      scenario: 'work',
      analyzerVersion: work.evaluation.analyzerId,
      rawScoreVersion: RAW_UTILITY_SCORE_VERSION,
      calibrationVersion: UTILITY_CALIBRATION_VERSION,
      calibrationModelUpdatedAt: calibrationDate,
      calibrationSampleSize: 8,
      displayedUtility: work.evaluation.utilityScore,
    });
    const workRaw = work.evaluation.prediction!.rawUtility!;
    expect(workRaw).toBeGreaterThan(15);
    expect(work.evaluation.utilityScore).toBe(workRaw - 15);
    await expect(card).toHaveAttribute(
      'data-attention-score',
      String(work.evaluation.utilityScore),
    );

    const numericalClaim = work.evaluation.insights?.keyClaims.find(
      (claim) => claim.claim === currentClaim,
    );
    expect(
      numericalClaim,
      'the real extractor must retain the numerical claim',
    ).toBeDefined();
    expect(numericalClaim!.knownProbability).toBeLessThanOrEqual(0.5);
    expect(numericalClaim!.novelty).not.toBe('known');

    await clickCardElement(context, article, '.context-summary');
    // The visible native select order is Work, Learn, Explore, Relax. Change
    // the draft, then commit it with a trusted click on the Apply button.
    await selectCardOption(context, article, '.context-scenario', 3);
    expect((await readEvaluation())?.evaluation.scenario).toBe('work');
    await clickCardElement(context, article, '.context-apply');
    await expect(card).toHaveAttribute('data-attention-scenario', 'relax');
    await expect
      .poll(async () => (await readEvaluation())?.evaluation.scenario)
      .toBe('relax');
    const relax = (await readEvaluation())!;
    expect(relax.evaluation.prediction).toMatchObject({
      provenance: 'captured',
      scenario: 'relax',
      analyzerVersion: relax.evaluation.analyzerId,
      rawScoreVersion: RAW_UTILITY_SCORE_VERSION,
      rawUtility: relax.evaluation.utilityScore,
      displayedUtility: relax.evaluation.utilityScore,
      calibrationModelUpdatedAt: null,
      calibrationSampleSize: 0,
    });
    await expect(card).toHaveAttribute(
      'data-attention-score',
      String(relax.evaluation.utilityScore),
    );
    expect(
      await worker.evaluate(
        async () =>
          (await attentionVault.privateStorage.get('utilityCalibration'))
            .utilityCalibration,
      ),
    ).toEqual(workOnlyCalibration);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
