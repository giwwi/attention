import { beforeEach, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { assertExtensionCloudAiAllowed } from '../src/privacy/settings';
import { selectAiPassages } from '../src/reading/ai-passages';
import { createArticleMap } from '../src/reading/blocks';
import type { PageCapture, AnalysisContext } from '../src/shared/types';

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  createGateway: vi.fn(() => () => 'fixture-model'),
  generateText: vi.fn(),
}));
vi.mock('../src/privacy/settings', () => ({
  assertExtensionCloudAiAllowed: vi.fn(async () => {}),
}));
const context: AnalysisContext = {
  scenario: 'work',
  intent: 'model evaluation methods',
  availableMinutes: 15,
};
const text =
  'Model evaluation methods need independent examples and a clear comparison of errors. ';
function material(count = 1): PageCapture {
  const readingMap = createArticleMap(
    Array.from({ length: count }, (_, index) => ({
      section: String(index),
      kind: 'paragraph' as const,
      text: `${index} ${text.repeat(30)}`,
    })),
  );
  return {
    readingMap,
    content: readingMap.blocks.map((block) => block.text).join('\n'),
    title: 'Model evaluation',
    url: 'https://example.com/reading',
    excerpt: '',
    byline: null,
    siteName: 'Example',
    publishedTime: null,
    language: 'en',
    wordCount: 1000,
    readingTimeMinutes: 5,
    headings: [],
    isArticle: true,
    extractionMethod: 'semantic',
    capturedAt: '2026-09-08',
  };
}
function answer(prompt: unknown) {
  const payload = JSON.parse(String(prompt).split('\n').at(-1)!);
  return {
    output: {
      passages: [
        {
          coreBlockId: payload.coreIds[0],
          contextBlockIds: [payload.coreIds[0]],
          queryIndex: 0,
          relevance: 0.9,
          confidence: 0.9,
          contextSufficient: true,
          contribution: 'Comparison of model evaluation methods.',
          knowledgeEvidenceIds: [],
          possiblyNew: false,
        },
      ],
    },
  } as Awaited<ReturnType<typeof generateText>>;
}
beforeEach(() => {
  vi.mocked(generateText).mockReset();
  vi.mocked(assertExtensionCloudAiAllowed).mockReset().mockResolvedValue();
});
it('executes a separate structured block selection and preserves source IDs', async () => {
  vi.mocked(generateText).mockImplementation(async (options) =>
    answer(options.prompt),
  );
  const capture = material();
  const result = await selectAiPassages(
    capture,
    context,
    null,
    'test-key',
    'fixture-model',
  );
  expect(result.source).toBe('ai');
  expect(result.status).toBe('ready');
  expect(result.items[0]?.coreBlockId).toBe(capture.readingMap!.blocks[0]!.id);
  expect(generateText).toHaveBeenCalledTimes(1);
});
it('stops all following batches after cancellation and never falls back after erasure', async () => {
  const controller = new AbortController();
  vi.mocked(generateText).mockImplementation(async (options) => {
    controller.abort();
    return answer(options.prompt);
  });
  await expect(
    selectAiPassages(
      material(30),
      context,
      null,
      'test-key',
      'fixture-model',
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(generateText).toHaveBeenCalledTimes(1);
});
it('keeps partial successful AI selections and labels unreviewed blocks', async () => {
  vi.mocked(generateText)
    .mockRejectedValueOnce(new Error('Provider unavailable'))
    .mockImplementation(async (options) => answer(options.prompt));
  const result = await selectAiPassages(
    material(12),
    context,
    null,
    'test-key',
    'fixture-model',
  );
  expect(result.source).toBe('ai');
  expect(result.coverage).toBe('partial');
  expect(result.items.length).toBeGreaterThan(0);
});
it('labels local fallback honestly if all AI passage requests fail', async () => {
  vi.mocked(generateText).mockRejectedValue(new Error('Unavailable'));
  const result = await selectAiPassages(
    material(),
    context,
    null,
    'test-key',
    'fixture-model',
  );
  expect(result.source).toBe('local');
  expect(result.status).toBe('unavailable');
});
it('does not send any request when cloud analysis is disabled', async () => {
  vi.mocked(assertExtensionCloudAiAllowed).mockRejectedValue(
    new Error('Local only'),
  );
  await expect(
    selectAiPassages(material(), context, null, 'test-key', 'fixture-model'),
  ).rejects.toThrow('Local only');
  expect(generateText).not.toHaveBeenCalled();
});
