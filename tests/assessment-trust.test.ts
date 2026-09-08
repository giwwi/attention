import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { LocalAnalyzer } from '../src/analyzer/local-analyzer';
import { goalTerms } from '../src/analyzer/goal-match';
import { AiGatewayAnalyzer } from '../src/analyzer/ai-gateway-analyzer';
import { sharedAnalysisInput } from '../src/analyzer/shared-input';
import { createArticleMap } from '../src/reading/blocks';
import { utilityRecommendation } from '../src/analyzer/utility';
import { createFullAnalysisHoverPreview } from '../src/analyzer/preview';
import {
  previewVerdict,
  personalValueReason,
} from '../src/content/hover-preview';
import { createProfileDemo } from '../src/onboarding/profile-demo';
import { calibrateMaterialEvaluation } from '../src/utility/calibration';
import { RAW_UTILITY_SCORE_VERSION } from '../src/utility/prediction';
import { assertExtensionCloudAiAllowed } from '../src/privacy/settings';
import type { AnalysisContext, PageCapture } from '../src/shared/types';

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
      'maybe',
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
  it('keeps absent evidence uncertain after calibration and never recommends saving by score', async () => {
    const evaluation = await new LocalAnalyzer().analyze(material(), context);
    const calibrated = calibrateMaterialEvaluation(evaluation, 5, null);
    expect(calibrated.recommendedAction).toBe('skim');
    expect(
      personalValueReason(createFullAnalysisHoverPreview(calibrated), 'ru'),
    ).toContain('пока неясно');
    for (let score = 0; score <= 100; score++)
      expect(utilityRecommendation(score)).not.toBe('save');
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
  const ids = [
    core.id,
    ...blocks.filter((block) => block.text === caveat).map((block) => block.id),
  ];
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
          coreBlockId: core.id,
          contextBlockIds: ids,
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
    expect(result.recommendedAction).toBe('skim');
    expect(result.confidence).toBeLessThan(0.45);
    expect(calibrateMaterialEvaluation(result, 5, null).recommendedAction).toBe(
      'skim',
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
  expect(demo.open).toBe(false);
  expect(demo.textContent).toContain('Учебный пример');
  demo.querySelector('button')!.click();
  expect(demo.querySelector('[role=status]')!.hasAttribute('hidden')).toBe(
    false,
  );
  expect(demo.querySelector('article p:last-child')!.textContent).toContain(
    'Однако',
  );
  demo.remove();
});
