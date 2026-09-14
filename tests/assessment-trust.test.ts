import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { LocalAnalyzer } from '../src/analyzer/local-analyzer';
import { goalTerms } from '../src/analyzer/goal-match';
import { AiGatewayAnalyzer } from '../src/analyzer/ai-gateway-analyzer';
import { sharedAnalysisInput } from '../src/analyzer/shared-input';
import { createArticleMap } from '../src/reading/blocks';
import {
  assessmentRecommendation,
  utilityRecommendation,
} from '../src/analyzer/utility';
import { createFullAnalysisHoverPreview } from '../src/analyzer/preview';
import {
  previewVerdict,
  personalValueReason,
} from '../src/content/hover-preview';
import { createProfileDemo } from '../src/onboarding/profile-demo';
import { calibrateMaterialEvaluation } from '../src/utility/calibration';
import { RAW_UTILITY_SCORE_VERSION } from '../src/utility/prediction';
import { assertExtensionCloudAiAllowed } from '../src/privacy/settings';
import type { AiAnalysisDiagnostic } from '../src/diagnostics/ai-analysis-types';
import type {
  AnalysisContext,
  PageCapture,
  RelevantProfileContext,
} from '../src/shared/types';

vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  createGateway: vi.fn(() => () => 'fixture-model'),
  generateText: vi.fn(),
}));
vi.mock('../src/privacy/settings', () => ({
  assertExtensionCloudAiAllowed: vi.fn(async () => {}),
}));

const context: AnalysisContext = {
  scenario: 'work',
  intent: 'reduce inference latency',
  availableMinutes: 15,
};
const festival =
  'The community festival brings musicians and artists together for a weekend of food, music and performances. Visitors can explore the stalls and enjoy the evening lantern walk. ';
const useful =
  'To reduce inference latency, configure caching for repeated requests and measure the response time on representative workloads.';
const caveat =
  'However, this only helps when the cached result is still valid for the current request.';
function material(
  text = festival.repeat(6),
  title = 'A community festival',
): PageCapture {
  return {
    title,
    content: text,
    excerpt: '',
    url: 'https://example.com/article',
    byline: null,
    siteName: 'Example',
    publishedTime: null,
    language: 'en',
    wordCount: 1000,
    readingTimeMinutes: 5,
    headings: ['Background'],
    isArticle: true,
    extractionMethod: 'readability',
    capturedAt: '2026-09-08',
  };
}
beforeEach(() => {
  vi.mocked(generateText).mockReset();
  vi.mocked(assertExtensionCloudAiAllowed).mockReset().mockResolvedValue();
});

describe('task evidence rather than title keywords', () => {
  it('counts an alias once and prevents the reported AI festival jump', async () => {
    expect([...goalTerms('AI')]).toEqual(['concept:ai']);
    expect([...goalTerms('AI LLM artificial intelligence')]).toEqual([
      'concept:ai',
    ]);
    const goal = {
      ...context,
      intent: 'Reduce AI inference latency in our production service',
    };
    const analyzer = new LocalAnalyzer();
    const baseline = await analyzer.analyze(material(), goal);
    const matched = await analyzer.analyze(
      material(undefined, 'An AI community festival'),
      goal,
    );
    expect(
      matched.components.relevance - baseline.components.relevance,
    ).toBeLessThan(5);
    expect(matched.components.actionability).toBe(
      baseline.components.actionability,
    );
    expect(matched.utilityScore - baseline.utilityScore).toBeLessThan(5);
    expect(matched.insights?.taskEvidence).toBe('metadata-only');
    expect(previewVerdict(createFullAnalysisHoverPreview(matched))).toBe(
      'skip',
    );
    expect(matched.prediction?.rawScoreVersion).toBe(RAW_UTILITY_SCORE_VERSION);
  });
  it('does not mistake an exact task in the title for a useful procedure', async () => {
    const analyzer = new LocalAnalyzer();
    const titleOnly = await analyzer.analyze(
      material(undefined, context.intent),
      context,
    );
    const actual = await analyzer.analyze(
      material(`${useful}\n\n${caveat}`, context.intent),
      context,
    );
    expect(titleOnly.insights?.taskEvidence).toBe('metadata-only');
    expect(actual.insights?.taskEvidence).toBe('body');
    expect(actual.components.actionability).toBeGreaterThan(
      titleOnly.components.actionability + 30,
    );
    expect(actual.components.relevance).toBeGreaterThan(
      titleOnly.components.relevance + 20,
    );
    expect(actual.insights?.readingPassages?.items.length).toBeGreaterThan(0);
    expect(titleOnly.recommendedAction).not.toBe('read');
  });
  it('evaluates all reading-profile goals, including a useful goal missed by the metadata shortlist', async () => {
    const signal = (id: string, label: string) => ({
      id,
      label,
      kind: 'goal' as const,
      effect: 'positive' as const,
      profileEntryId: id,
      explanation: '',
      confidence: 0.9,
      matchScore: 1,
    });
    const irrelevant = signal('first', 'underwater coral restoration');
    const relevant = signal('second', context.intent);
    const profile: RelevantProfileContext = {
      profileUpdatedAt: '2026-09-13',
      signals: [irrelevant],
      readingProfile: { signals: [irrelevant, relevant] },
    };
    const result = await new LocalAnalyzer().analyze(
      material(`${useful}\n\n${caveat}`),
      { ...context, intent: '' },
      profile,
    );
    expect(result.insights?.taskEvidence).toBe('body');
    expect(result.insights?.readingFocus?.label).toBe(context.intent);
    expect(result.insights?.readingPassages?.items.length).toBeGreaterThan(0);
    expect(result.components.actionability).toBeGreaterThan(70);
    expect(result.expectedValue).not.toContain('coral');
  });

  it('keeps an explicit task in charge when passages match a different profile goal', async () => {
    const unrelatedTask = 'underwater coral restoration';
    const profile: RelevantProfileContext = {
      profileUpdatedAt: '2026-09-13',
      signals: [
        {
          id: 'goal',
          profileEntryId: null,
          kind: 'goal',
          effect: 'positive',
          label: context.intent,
          explanation: '',
          confidence: 0.9,
          matchScore: 1,
        },
      ],
    };
    const result = await new LocalAnalyzer().analyze(
      material(`${useful}\n\n${caveat}`),
      { ...context, intent: unrelatedTask },
      profile,
    );
    expect(result.insights?.taskEvidence).toBe('no-match');
    expect(result.recommendedAction).toBe('skim');
    expect(result.components.actionability).toBe(32);
    expect(result.insights?.readingPassages?.items.length).toBeGreaterThan(0);
    const reason = personalValueReason(
      createFullAnalysisHoverPreview(result),
      'ru',
    );
    expect(reason).toContain(context.intent);
    expect(reason).toContain('выборочного чтения');
    expect(reason).not.toContain(unrelatedTask);
  });

  it('explains cross-language topic matches without inventing task-specific usefulness', async () => {
    const text =
      'Artificial intelligence research compares evaluation procedures on separate examples and records their limitations before deployment.';
    const result = await new LocalAnalyzer().analyze(material(text), {
      ...context,
      intent: 'искусственный интеллект исследование',
    });
    expect(result.insights?.readingFocus).toMatchObject({
      label: 'искусственный интеллект исследование',
      match: 'topic',
    });
    expect(result.insights?.readingPassages?.items.length).toBeGreaterThan(0);
    expect(result.recommendedAction).toBe('skim');
    expect(result.components.actionability).toBe(32);
    expect(
      personalValueReason(createFullAnalysisHoverPreview(result), 'ru'),
    ).toContain('искусственный интеллект исследование');
    const unrelated = await new LocalAnalyzer().analyze(material(text), {
      ...context,
      intent: 'искусственный интеллект инвестиции',
    });
    expect(unrelated.insights?.readingFocus).toBeUndefined();
    expect(unrelated.insights?.readingPassages?.items).toEqual([]);
  });

  it('gives a tentative skip when no connection was found and never recommends saving by score', async () => {
    const evaluation = await new LocalAnalyzer().analyze(material(), context);
    const calibrated = calibrateMaterialEvaluation(evaluation, 5, null);
    expect(calibrated.recommendedAction).toBe('skip');
    expect(
      personalValueReason(createFullAnalysisHoverPreview(calibrated), 'ru'),
    ).toContain('не нашлось явной связи');
    for (let score = 0; score <= 100; score++)
      expect(utilityRecommendation(score)).not.toBe('save');
  });
});

describe('a recommendation is distinct from its certainty', () => {
  it.each([
    [20, 'skip'],
    [50, 'skim'],
    [90, 'read'],
  ] as const)(
    'keeps the %i-point direction %s for partial coverage, including after calibration',
    async (score, action) => {
      const evaluation = await new LocalAnalyzer().analyze(
        material(`${useful}\n\n${caveat}`),
        context,
      );
      const insights = {
        ...evaluation.insights!,
        analysisCoverage: 'partial' as const,
      };
      delete insights.taskEvidence;
      expect(assessmentRecommendation(score, insights)).toBe(action);
      evaluation.insights = insights;
      evaluation.utilityScore = score;
      evaluation.prediction = {
        ...evaluation.prediction!,
        rawUtility: score,
        displayedUtility: score,
      };
      expect(
        calibrateMaterialEvaluation(evaluation, 5, null).recommendedAction,
      ).toBe(action);
    },
  );
  it('reserves abstention for a missing focus and treats weak extraction as a confidence limit', async () => {
    const result = await new LocalAnalyzer().analyze(material(), {
      ...context,
      intent: '',
    });
    expect(result.insights?.taskEvidence).toBe('no-context');
    expect(assessmentRecommendation(95, result.insights)).toBe('skim');
    expect(previewVerdict(createFullAnalysisHoverPreview(result))).toBe(
      'maybe',
    );
    result.insights!.reliability!.weakExtraction = true;
    result.insights!.taskEvidence = 'body';
    expect(assessmentRecommendation(95, result.insights)).toBe('read');
  });
});

function modelAnswer(prompt: string) {
  const payload = JSON.parse(
    prompt
      .split('BEGIN_UNTRUSTED_MATERIAL_JSON\n')[1]!
      .split('\nEND_UNTRUSTED_MATERIAL_JSON')[0]!,
  );
  const blocks = payload.material.blocks as { id: string; text: string }[];
  const core = blocks.find((block) => block.text === useful) ?? blocks[0]!;
  const offered = payload.material.passages.find(
    (passage: { coreBlockId: string }) => passage.coreBlockId === core.id,
  );
  return {
    output: {
      relevance: 90,
      actionability: 85,
      keyClaims: [
        {
          claim: core.text.slice(0, 400),
          sourceExcerpt: core.text.slice(0, 400),
          type: 'recommendation',
          importance: 'primary',
          knownProbability: 0.5,
          noveltyReason: 'Unknown knowledge',
          confidence: 0.6,
        },
      ],
      noveltySummary: 'Unknown knowledge',
      noveltyConfidence: 0.6,
      qualityBreakdown: {
        evidence: 65,
        reasoning: 65,
        specificity: 65,
        calibration: 65,
      },
      qualitySummary: 'Explanations are present.',
      qualityStrengths: [],
      qualityLimitations: ['Sources not verified.'],
      qualityConfidence: 0.6,
      reason: 'There is a procedure with a limitation.',
      recommendedSections: [],
      confidence: 0.8,
      passages: [
        {
          passageId: offered.id,
          queryIndex: 0,
          relevance: 0.9,
          confidence: 0.9,
          contextSufficient: true,
          contribution: 'A procedure and its limitation.',
          knowledgeEvidenceIds: [],
          possiblyNew: false,
        },
      ],
    },
    usage: { inputTokens: 1100, outputTokens: 350 },
  } as Awaited<ReturnType<typeof generateText>>;
}

describe('one source set for AI verdict and passages', () => {
  it.each([
    ['en', 'Compare the model checks and their limitations.'],
    ['de', 'Vergleichen Sie die Modellprüfungen und ihre Grenzen.'],
    ['ru', 'Сравните проверки моделей и их ограничения.'],
  ] as const)(
    'shows the model explanation in %s instead of a generic fallback',
    async (responseLanguage, reason) => {
      vi.mocked(generateText).mockImplementation(async (options) => {
        const result = modelAnswer(String(options.prompt));
        result.output.reason = reason;
        return result;
      });
      const result = await new AiGatewayAnalyzer('test-key').analyze(
        material(`${useful}\n\n${caveat}`),
        { ...context, responseLanguage },
      );
      expect(result.insights?.assessmentReason).toEqual({
        text: reason,
        language: responseLanguage,
      });
      expect(
        personalValueReason(
          createFullAnalysisHoverPreview(result),
          responseLanguage,
        ),
      ).toBe(reason);
      expect(generateText).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    'accepted',
    'percent-relevance',
    'empty',
    'rejected',
    'schema-error',
    'network-error',
  ] as const)('traces the real analyzer pipeline: %s', async (mode) => {
    const traces: AiAnalysisDiagnostic[] = [];
    vi.mocked(generateText).mockImplementation(async (options) => {
      if (mode === 'network-error') throw new Error('Network PRIVATE_SENTINEL');
      const answer = modelAnswer(String(options.prompt));
      const output = answer.output as unknown as {
        passages: { confidence: number; relevance: number }[];
        reason: unknown;
      };
      if (mode === 'empty') output.passages = [];
      if (mode === 'rejected') output.passages[0]!.confidence = 0.5;
      if (mode === 'percent-relevance') output.passages[0]!.relevance = 90;
      if (mode === 'schema-error') output.reason = null;
      return answer;
    });
    const analyzer = new AiGatewayAnalyzer(
      'PRIVATE_SENTINEL',
      undefined,
      async (report) => {
        traces.push(structuredClone(report));
      },
    );
    const run = analyzer.analyze(material(`${useful}\n\n${caveat}`), context);
    if (mode.endsWith('error')) await expect(run).rejects.toThrow();
    else {
      const result = await run;
      expect(result.insights?.aiAnalysisId).toBe(traces[0]?.analysisId);
      expect(result.insights?.readingPassages?.items).toHaveLength(
        mode === 'accepted' || mode === 'percent-relevance' ? 1 : 0,
      );
    }
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(traces[0]?.status).toBe('started');
    const final = traces.at(-1)!;
    expect(JSON.stringify(final)).not.toContain('PRIVATE_SENTINEL');
    expect(final.status).toBe(mode.endsWith('error') ? 'failed' : 'complete');
    expect(final.output.returned).toBe(
      mode === 'network-error' ? null : mode === 'empty' ? 0 : 1,
    );
    if (mode === 'rejected')
      expect(final.output.candidates[0]?.reasons).toEqual(['low-confidence']);
    if (mode === 'accepted')
      expect(final.output).toMatchObject({
        inspected: 1,
        accepted: 1,
        selected: 1,
      });
    if (mode === 'percent-relevance') {
      expect(final.output).toMatchObject({
        returned: 1,
        accepted: 1,
        selected: 1,
      });
      expect(final.output.candidates[0]).toMatchObject({
        relevance: 0.9,
        relevanceInput: { kind: 'number', value: 90, scale: 'percent' },
        reasons: [],
      });
    }
    expect(final.display).toBeNull();
  });
  it('evaluates and selects the middle procedure with its caveat in one request', async () => {
    const capture = material();
    capture.readingMap = createArticleMap([
      { section: 'Introduction', kind: 'paragraph', text: festival },
      { section: 'Procedure', kind: 'paragraph', text: useful },
      { section: 'Procedure', kind: 'paragraph', text: caveat },
      { section: 'Conclusion', kind: 'paragraph', text: festival },
    ]);
    capture.content = capture.readingMap.blocks
      .map((block) => block.text)
      .join('\n\n');
    vi.mocked(generateText).mockImplementation(async (options) =>
      modelAnswer(String(options.prompt)),
    );
    const result = await new AiGatewayAnalyzer('test-key').analyze(
      capture,
      context,
    );
    expect(result.insights?.assessmentReason).toEqual({
      text: 'There is a procedure with a limitation.',
      language: 'en',
    });
    expect(
      personalValueReason(createFullAnalysisHoverPreview(result), 'en'),
    ).toBe('There is a procedure with a limitation.');
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(result.insights?.analysisCoverage).toBe('complete');
    expect(result.insights?.analysisUsage).toMatchObject({
      requests: 1,
      inputTokens: 1100,
      outputTokens: 350,
    });
    expect(result.insights?.readingPassages?.items[0]?.blockIds).toEqual(
      capture.readingMap.blocks.slice(1, 3).map((block) => block.id),
    );
    expect(result.insights?.keyClaims[0]?.sourceExcerpt).toBe(useful);
  });
  it('samples across sections, preserves whole blocks and does not call partial reading complete', async () => {
    const capture = material();
    capture.readingMap = createArticleMap(
      Array.from({ length: 45 }, (_, i) => ({
        section: ['Beginning', 'Middle', 'Ending'][Math.floor(i / 15)]!,
        kind: 'paragraph' as const,
        text: `Paragraph ${i}. ${festival.repeat(12)}`,
      })),
    );
    capture.content = capture.readingMap.blocks
      .map((block) => block.text)
      .join('\n\n');
    const input = sharedAnalysisInput(capture);
    expect(input.complete).toBe(false);
    expect(input.content.length).toBeLessThanOrEqual(24000);
    expect(new Set(input.batch.blocks.map((block) => block.section))).toEqual(
      new Set(['Beginning', 'Middle', 'Ending']),
    );
    for (const block of input.batch.blocks)
      expect(capture.readingMap.blocks).toContainEqual(block);
    vi.mocked(generateText).mockImplementation(async (options) =>
      modelAnswer(String(options.prompt)),
    );
    const result = await new AiGatewayAnalyzer('test-key').analyze(
      capture,
      context,
    );
    expect(result.insights?.analysisCoverage).toBe('partial');
    expect(result.insights?.readingPassages?.coverage).toBe('partial');
    expect(result.recommendedAction).toBe(
      utilityRecommendation(result.utilityScore),
    );
    expect(result.confidence).toBeLessThan(0.45);
    expect(calibrateMaterialEvaluation(result, 5, null).recommendedAction).toBe(
      utilityRecommendation(result.utilityScore),
    );
  });
  it('rejects a quote from omitted content even when it exists in the full article', async () => {
    const capture = material();
    capture.readingMap = createArticleMap([
      { section: '', kind: 'paragraph', text: useful },
    ]);
    capture.content = `${useful}\n${festival}`;
    vi.mocked(generateText).mockImplementation(async (options) => {
      const response = modelAnswer(String(options.prompt));
      (
        response.output as { keyClaims: { sourceExcerpt: string }[] }
      ).keyClaims[0]!.sourceExcerpt = festival;
      return response;
    });
    const result = await new AiGatewayAnalyzer('test-key').analyze(
      capture,
      context,
    );
    expect(result.insights?.keyClaims[0]?.sourceExcerpt).toBeUndefined();
    expect(result.insights?.keyClaims[0]?.confidence).toBeLessThan(0.45);
  });
  it('does not return or start further work after cancellation', async () => {
    const controller = new AbortController();
    vi.mocked(generateText).mockImplementation(async (options) => {
      controller.abort();
      return modelAnswer(String(options.prompt));
    });
    await expect(
      new AiGatewayAnalyzer('test-key').analyze(
        material(useful),
        context,
        null,
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(generateText).toHaveBeenCalledTimes(1);
  });
  it('still blocks all model calls in local-only mode', async () => {
    vi.mocked(assertExtensionCloudAiAllowed).mockRejectedValue(
      new Error('Local only'),
    );
    await expect(
      new AiGatewayAnalyzer('test-key').analyze(material(useful), context),
    ).rejects.toThrow('Local only');
    expect(generateText).not.toHaveBeenCalled();
  });
});

it('offers a clearly labelled example without creating a profile or vault', () => {
  const demo = createProfileDemo('ru');
  document.body.append(demo);
  expect(demo.textContent).toContain('Учебный пример');
  expect(demo.querySelector('[role=status]')!.textContent).toContain(
    'Стоит прочитать',
  );
  demo.querySelectorAll('button')[1]!.click();
  expect(demo.querySelector('[role=status]')!.textContent).toContain(
    'Основы можно пропустить',
  );
  expect(demo.querySelectorAll('button')[1]!.getAttribute('aria-pressed')).toBe(
    'true',
  );
  demo.remove();
});
