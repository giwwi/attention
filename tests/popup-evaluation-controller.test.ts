import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EvaluationController } from '../src/popup/controllers/evaluation-controller';
import { createAnalyzer } from '../src/analyzer';
import { recordMaterialEvaluation } from '../src/memory/material-memory';
import { recordDiagnostic } from '../src/diagnostics/diagnostics';
import { DATA_GENERATION_KEY } from '../src/privacy/data-operations';
import type {
  AnalysisContext,
  MaterialEvaluation,
  PageCapture,
} from '../src/shared/types';
import { DataTestStorage, installDataLocks } from './helpers/data-locks';

vi.mock('../src/analyzer', () => ({ createAnalyzer: vi.fn() }));
vi.mock('../src/diagnostics/diagnostics', () => ({
  recordDiagnostic: vi.fn(async () => {}),
}));
vi.mock('../src/profile/storage', () => ({
  loadProfile: vi.fn(async () => null),
}));
vi.mock('../src/history/storage', () => ({
  loadBrowserHistoryEvidence: vi.fn(async () => null),
}));
vi.mock('../src/readwise/storage', () => ({
  loadReadwiseEvidence: vi.fn(async () => null),
}));
vi.mock('../src/obsidian/evidence', () => ({
  loadObsidianEvidence: vi.fn(async () => null),
}));
vi.mock('../src/notion/evidence', () => ({
  loadNotionEvidence: vi.fn(async () => null),
}));
vi.mock('../src/novelty/feedback', () => ({
  loadNovelPassageFeedback: vi.fn(async () => []),
}));
vi.mock('../src/history/relevance', () => ({
  selectRelevantPersonalContext: vi.fn(async () => null),
}));
vi.mock('../src/analyzer/material-features', () => ({
  buildMaterialFeatures: vi.fn(async () => ({})),
}));
vi.mock('../src/analyzer/evaluation-cache', () => ({
  loadEvaluationSourceVersions: vi.fn(async () => ({})),
  createEvaluationCacheVersion: vi.fn(() => ({})),
  isEvaluationCacheCurrent: vi.fn(() => false),
}));
vi.mock('../src/utility/storage', () => ({
  loadUtilityCalibration: vi.fn(async () => null),
}));
vi.mock('../src/memory/material-memory', () => ({
  findMaterialMemory: vi.fn(async () => null),
  recordMaterialEvaluation: vi.fn(async () => {}),
}));

const html = readFileSync('tests/fixtures/popup-controller.html', 'utf8');
const capture: PageCapture = {
  title: 'Current article',
  url: 'https://example.com/current',
  content: 'An article about useful subjects.',
  excerpt: 'Useful subjects',
  byline: null,
  siteName: 'Example',
  publishedTime: null,
  language: 'en',
  wordCount: 500,
  readingTimeMinutes: 3,
  headings: [],
  isArticle: true,
  extractionMethod: 'readability',
  capturedAt: '2026-09-05T10:00:00.000Z',
};
let storage: DataTestStorage;

function evaluation(
  score: number,
  scenario: MaterialEvaluation['scenario'] = 'work',
): MaterialEvaluation {
  return {
    scenario,
    recommendedAction: 'skim',
    utilityScore: score,
    components: { relevance: 50, novelty: 50, actionability: 50, quality: 50 },
    scenarioSignals: {
      relevance: 50,
      novelty: 50,
      actionability: 50,
      quality: 50,
      knowledgeFit: 50,
      timeFit: 100,
      effortFit: 50,
      tasteFit: 50,
      serendipity: 50,
      enjoymentFit: 50,
    },
    estimatedUsefulMinutes: 1,
    reason: 'Assessment',
    expectedValue: 'Possible value',
    recommendedSections: [],
    profileSignals: [],
    confidence: 0.5,
    analyzerId: 'local-test',
    analyzedAt: '2026-09-05T10:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.innerHTML = new DOMParser().parseFromString(
    html,
    'text/html',
  ).documentElement.innerHTML;
  storage = new DataTestStorage();
  vi.stubGlobal('chrome', { storage: { local: storage.area } });
  installDataLocks();
});
afterEach(() => vi.unstubAllGlobals());

function controller(getContext: () => AnalysisContext) {
  const refreshAiSettings = vi.fn(async () => ({
    provider: 'vercel-ai-gateway' as const,
    apiKey: 'existing-user-key',
    model: 'provider/model',
    updatedAt: 'now',
  }));
  return {
    refreshAiSettings,
    instance: new EvaluationController({
      status: document.querySelector<HTMLParagraphElement>('#status')!,
      decisionButtons: [],
      getCapture: () => capture,
      getContext,
      getScenario: () => getContext().scenario,
      getLanguage: () => 'en',
      getAiSettings: () => null,
      refreshAiSettings,
      applyContext: vi.fn(),
      refreshProfile: vi.fn(),
      onSectionSelected: vi.fn(),
      onHighlightSections: vi.fn(),
    }),
  };
}

describe('popup evaluation lifecycle', () => {
  it('rejects feedback on a displayed old evaluation before an erasure event reaches the popup', async () => {
    vi.mocked(createAnalyzer).mockReturnValue({
      id: 'local-test',
      analyze: async () => evaluation(61),
    });
    const { instance } = controller(() => ({
      scenario: 'work',
      intent: '',
      availableMinutes: 15,
    }));
    await instance.evaluateLocal();
    await storage.clear();
    await storage.set({ [DATA_GENERATION_KEY]: 'erased' });
    document.querySelector<HTMLButtonElement>('#evaluation-useful')!.click();
    document.querySelector<HTMLButtonElement>('#wrong-recommendation')!.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(storage.data).toEqual({ [DATA_GENERATION_KEY]: 'erased' });
  });
  it('shows first value locally without consulting configured cloud AI', async () => {
    const analyze = vi.fn(async () => evaluation(61));
    vi.mocked(createAnalyzer).mockReturnValue({ id: 'local-test', analyze });
    const { instance, refreshAiSettings } = controller(() => ({
      scenario: 'work',
      intent: '',
      availableMinutes: 5,
    }));
    await instance.evaluateLocal();
    expect(createAnalyzer).toHaveBeenCalledWith(null, expect.any(Function));
    expect(refreshAiSettings).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>('#evaluation')?.hidden).toBe(
      false,
    );
    expect(document.querySelector('#utility-score')?.textContent).toBe(
      '61/100',
    );
    expect(recordMaterialEvaluation).toHaveBeenCalledOnce();
  });

  it('discards an earlier result when the scenario changes during analysis', async () => {
    let resolveFirst!: (value: MaterialEvaluation) => void;
    const first = new Promise<MaterialEvaluation>((resolve) => {
      resolveFirst = resolve;
    });
    const analyze = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(evaluation(73, 'learn'));
    vi.mocked(createAnalyzer).mockReturnValue({ id: 'local-test', analyze });
    let context: AnalysisContext = {
      scenario: 'work',
      intent: '',
      availableMinutes: 15,
    };
    const { instance } = controller(() => context);
    const pending = instance.evaluateLocal();
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledOnce());
    context = { ...context, scenario: 'learn' };
    instance.clear();
    await instance.evaluateLocal();
    resolveFirst(evaluation(42));
    await pending;
    expect(instance.current?.scenario).toBe('learn');
    expect(document.querySelector('#utility-score')?.textContent).toBe(
      '73/100',
    );
    expect(recordMaterialEvaluation).toHaveBeenCalledOnce();
    expect(storage.data.latestEvaluation).toMatchObject({
      context: { scenario: 'learn' },
    });
  });

  it('does not restore diagnostics or evaluation when pending AI fails after erasure', async () => {
    let rejectAnalysis!: (error: Error) => void;
    const analysis = new Promise<MaterialEvaluation>((_, reject) => {
      rejectAnalysis = reject;
    });
    const analyze = vi.fn(() => analysis);
    vi.mocked(createAnalyzer).mockReturnValue({ id: 'local-test', analyze });
    const { instance } = controller(() => ({
      scenario: 'work',
      intent: '',
      availableMinutes: 15,
    }));
    const pending = instance.evaluateLocal();
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledOnce());
    await storage.clear();
    await storage.set({ [DATA_GENERATION_KEY]: 'erased' });
    const fallbackDiagnostic = vi.mocked(createAnalyzer).mock.calls[0]![1]!;
    await expect(
      fallbackDiagnostic(new Error('Late network failure')),
    ).rejects.toThrow('Attention data changed');
    rejectAnalysis(new Error('Late network failure'));
    await pending;
    expect(recordDiagnostic).not.toHaveBeenCalled();
    expect(recordMaterialEvaluation).not.toHaveBeenCalled();
    expect(storage.data).toEqual({ [DATA_GENERATION_KEY]: 'erased' });
    expect(instance.current).toBeNull();
  });
});
