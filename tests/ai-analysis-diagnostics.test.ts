import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_ANALYSIS_DIAGNOSTIC_KEY,
  aiAnalysisDiagnosticExport,
  loadAiAnalysisDiagnostic,
  saveAiAnalysisDiagnostic,
  recordAiPassageDisplay,
} from '../src/diagnostics/ai-analysis';
import { AI_PASSAGE_DISPLAY_TYPE } from '../src/diagnostics/ai-analysis-messages';
import {
  emptyDisplayTrace,
  type AiAnalysisDiagnostic,
} from '../src/diagnostics/ai-analysis-types';
import { handleAiPassageDisplay } from '../src/background/ai-diagnostics';
import { clearDiagnostics } from '../src/diagnostics/diagnostics';
import {
  beginDataOperation,
  commitDataOperation,
} from '../src/privacy/data-operations';
import { deleteAllAttentionData } from '../src/privacy/data-erasure';
import { DataTestStorage, installDataLocks } from './helpers/data-locks';
import { validatePassageOutput } from '../src/reading/ai-passages';
import { sharedAnalysisInput } from '../src/analyzer/shared-input';
import { findNovelPassageMatches } from '../src/content/novel-passages';
import { captureDocument } from '../src/content/capture';
import type { ReadingPassages } from '../src/reading/types';

const url = 'https://example.com/private-article';
const context = {
  scenario: 'work' as const,
  intent: 'compare evaluation methods',
  availableMinutes: 15 as const,
};
const text =
  'Compare evaluation methods on separate test examples before choosing a benchmark. Keep evaluation data out of the training set.';
let local: DataTestStorage;
beforeEach(() => {
  installDataLocks();
  local = new DataTestStorage();
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension' },
    storage: { local, session: new DataTestStorage() },
  });
  document.title = 'Evaluation methods';
  document.body.innerHTML = `<article><h1>Evaluation methods</h1><p>${text}</p><p>However, this comparison only applies when the test examples represent the actual tasks and users.</p></article>`;
});
afterEach(() => vi.unstubAllGlobals());
function report(): AiAnalysisDiagnostic {
  return {
    schemaVersion: 1,
    analysisId: crypto.randomUUID(),
    at: new Date().toISOString(),
    version: '0.28.2',
    model: 'google/gemini-2.5-flash-lite',
    status: 'started',
    stage: 'request',
    errorCategory: null,
    input: {
      articleBlocks: 10,
      sentBlocks: 8,
      sentCharacters: 500,
      queries: 1,
      knowledgeSignals: 0,
      coverage: 'partial',
    },
    output: {
      returned: 2,
      inspected: 2,
      overLimit: 0,
      accepted: 1,
      selected: 1,
      mergedOrLimited: 0,
      candidates: [
        {
          index: 0,
          accepted: true,
          relevance: 0.9,
          confidence: 0.8,
          reasons: [],
        },
        {
          index: 1,
          accepted: false,
          relevance: 0.9,
          confidence: 0.5,
          reasons: ['low-confidence'],
        },
      ],
    },
    display: null,
  };
}
async function completed(r = report()) {
  await saveAiAnalysisDiagnostic(r, url, local.area);
  r.status = 'complete';
  r.stage = 'complete';
  await saveAiAnalysisDiagnostic(r, url, local.area);
  return r;
}

describe('safe local AI report', () => {
  it('exports only fixed fields even when raw response, URL or key were injected into storage', async () => {
    const secret = 'PRIVATE_SENTINEL';
    const injected = {
      ...report(),
      model: secret,
      rawResponse: secret,
      pageUrl: secret,
      input: { ...report().input, text: secret, offeredPassages: secret },
      output: {
        ...report().output,
        candidates: [
          {
            index: 0,
            accepted: false,
            relevance: 0.9,
            confidence: 0.5,
            reasons: ['low-confidence', secret],
            contribution: secret,
            coreBlockId: secret,
            relevanceInput: { kind: secret, value: secret, scale: secret },
          },
        ],
      },
    } as unknown as AiAnalysisDiagnostic;
    await saveAiAnalysisDiagnostic(injected, url, local.area);
    const exported = aiAnalysisDiagnosticExport(
      (await loadAiAnalysisDiagnostic(local.area))!,
    );
    expect(exported).not.toContain(secret);
    expect(exported).not.toContain(url);
    expect(JSON.parse(exported)).toMatchObject({
      model: 'custom-model',
      input: { offeredPassages: 0 },
      output: {
        candidates: [
          {
            reasons: ['low-confidence'],
            relevanceInput: { kind: 'other', value: null, scale: 'invalid' },
          },
        ],
      },
    });
  });
  it('preserves bounded original percentage scores alongside normalized relevance', async () => {
    const r = report();
    r.output.candidates[0]!.relevance = 0.95;
    r.output.candidates[0]!.relevanceInput = {
      kind: 'number',
      value: 95,
      scale: 'percent',
    };
    await completed(r);
    const exported = JSON.parse(
      aiAnalysisDiagnosticExport((await loadAiAnalysisDiagnostic(local.area))!),
    );
    expect(exported.output.candidates[0]).toMatchObject({
      relevance: 0.95,
      relevanceInput: { kind: 'number', value: 95, scale: 'percent' },
    });
    // Reports created before this field was introduced stay readable.
    expect(exported.output.candidates[1]).not.toHaveProperty('relevanceInput');
  });
  it.each(['missing', 'null', 'string', 'non-finite', 'other'] as const)(
    'exports only the fixed input kind for invalid relevance: %s',
    (kind) => {
      const r = report();
      r.output.candidates[0]!.relevanceInput = {
        kind,
        value: null,
        scale: 'invalid',
      };
      const exported = JSON.parse(aiAnalysisDiagnosticExport(r));
      expect(exported.output.candidates[0].relevanceInput).toEqual({
        kind,
        value: null,
        scale: 'invalid',
      });
    },
  );
  it.each([-1, 101, Infinity, NaN])(
    'does not export out-of-range original relevance: %s',
    (value) => {
      const r = report();
      r.output.candidates[0]!.relevanceInput = {
        kind: 'number',
        value,
        scale: 'percent',
      };
      const exported = JSON.parse(aiAnalysisDiagnosticExport(r));
      expect(exported.output.candidates[0].relevanceInput).toEqual({
        kind: 'number',
        value: null,
        scale: 'invalid',
      });
    },
  );
  it('keeps only the newest request, distinguishes an unobserved page, and rejects stale/page-mismatched observations', async () => {
    const first = await completed();
    const second = await completed();
    const trace = {
      ...emptyDisplayTrace(1),
      reason: 'matched' as const,
      matched: 1,
      fingerprintMatches: true,
    };
    expect(
      await recordAiPassageDisplay(first.analysisId, url, trace, local.area),
    ).toBe(false);
    expect(
      await recordAiPassageDisplay(
        second.analysisId,
        'https://other.test/',
        trace,
        local.area,
      ),
    ).toBe(false);
    await saveAiAnalysisDiagnostic(first, url, local.area);
    expect((await loadAiAnalysisDiagnostic(local.area))?.display).toBeNull();
    expect(
      await recordAiPassageDisplay(second.analysisId, url, trace, local.area),
    ).toBe(true);
    expect((await loadAiAnalysisDiagnostic(local.area))?.display?.matched).toBe(
      1,
    );
  });
  it('clears the report without a late model response recreating it', async () => {
    const r = await completed();
    await clearDiagnostics(local.area);
    await saveAiAnalysisDiagnostic(r, url, local.area);
    expect(await loadAiAnalysisDiagnostic(local.area)).toBeNull();
  });
  it('does not restore reports after data erasure', async () => {
    const op = await beginDataOperation(local.area);
    await completed();
    await deleteAllAttentionData(
      local.area,
      new DataTestStorage().area,
      async () => {},
    );
    await expect(
      commitDataOperation(
        op,
        () => saveAiAnalysisDiagnostic(report(), url, local.area),
        local.area,
      ),
    ).rejects.toThrow();
    expect((await local.get(null))[AI_ANALYSIS_DIAGNOSTIC_KEY]).toBeUndefined();
  });
  it('accepts a valid content observation and rejects foreign senders, frames and invalid counters', async () => {
    const r = await completed();
    const message = {
      type: AI_PASSAGE_DISPLAY_TYPE,
      analysisId: r.analysisId,
      url,
      display: { ...emptyDisplayTrace(1), reason: 'matched', matched: 1 },
    };
    const sender = {
      id: 'test-extension',
      frameId: 0,
      tab: { id: 1, url },
    } as chrome.runtime.MessageSender;
    for (const bad of [
      { ...sender, id: 'foreign' },
      { ...sender, frameId: 2 },
      { ...sender, tab: { id: 1, url: 'https://other.test' } },
    ]) {
      const respond = vi.fn();
      handleAiPassageDisplay(
        message,
        bad as chrome.runtime.MessageSender,
        respond,
      );
      expect(respond).toHaveBeenCalledWith({ ok: false });
    }
    const invalid = vi.fn();
    handleAiPassageDisplay(
      { ...message, display: { ...message.display, matched: 9 } },
      sender,
      invalid,
    );
    expect(invalid).toHaveBeenCalledWith({ ok: false });
    const result = await new Promise((resolve) =>
      handleAiPassageDisplay(message, sender, resolve),
    );
    expect(result).toEqual({ ok: true });
    expect((await loadAiAnalysisDiagnostic(local.area))?.display?.matched).toBe(
      1,
    );
  });
});

describe('selection and DOM observations preserve decisions', () => {
  it('reports exact rejection reasons while keeping the accepted result unchanged', () => {
    const capture = captureDocument(document, url);
    const input = sharedAnalysisInput(capture);
    const choice = {
      passageId: input.batch.passages[0]!.id,
      queryIndex: 0,
      relevance: 0.9,
      confidence: 0.9,
      contextSufficient: true,
      contribution: 'Use a separate test set.',
      knowledgeEvidenceIds: [],
      possiblyNew: false,
    };
    const output = {
      passages: [
        choice,
        { ...choice, confidence: 0.5 },
        { ...choice, contextSufficient: false },
        { ...choice, passageId: 'invented' },
        { ...choice, relevance: 0.5 },
        { ...choice, queryIndex: 99 },
      ],
    };
    const trace: AiAnalysisDiagnostic['output']['candidates'] = [];
    const result = validatePassageOutput(
      output,
      input.batch,
      input.map,
      context,
      null,
      trace,
    );
    expect(result).toEqual(
      validatePassageOutput(output, input.batch, input.map, context, null),
    );
    expect(result).toHaveLength(1);
    expect(trace.map((t) => t.reasons)).toEqual([
      [],
      ['low-confidence'],
      ['insufficient-context'],
      ['passage-not-offered'],
      ['low-relevance'],
      ['invalid-query'],
    ]);
    expect(trace[0]?.accepted).toBe(true);
    const selection: ReadingPassages = {
      version: 1,
      source: 'ai',
      coverage: 'complete',
      status: 'ready',
      fingerprint: input.map.fingerprint,
      items: result,
    };
    const matchTrace = emptyDisplayTrace(1);
    expect(
      findNovelPassageMatches(document, capture, [], 3, selection, matchTrace),
    ).toHaveLength(1);
    expect(matchTrace).toMatchObject({
      reason: 'matched',
      matched: 1,
      fingerprintMatches: true,
    });
    document
      .querySelector('article')!
      .insertAdjacentHTML(
        'beforeend',
        '<p>Another paragraph was appended by the site after the model analysed the article.</p>',
      );
    const changedTrace = emptyDisplayTrace(1);
    expect(
      findNovelPassageMatches(
        document,
        capture,
        [],
        3,
        selection,
        changedTrace,
      ),
    ).toHaveLength(0);
    expect(changedTrace).toMatchObject({
      reason: 'fingerprint-changed',
      matched: 0,
      fingerprintMatches: false,
    });
  });
});
