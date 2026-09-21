import { describe, expect, it } from 'vitest';
import { createArticleMap } from '../src/reading/blocks';
import {
  prepareSemanticInput,
  semanticQueries,
  selectSemanticPassages,
} from '../src/semantic/selection';
import { validatePortableProfile } from '../src/profile/validator';
import { normalizePortableProfile } from '../src/profile/normalize';
import type { AnalysisContext, PageCapture } from '../src/shared/types';

const context: AnalysisContext = {
  scenario: 'work',
  intent: '',
  availableMinutes: 15,
};
function profile() {
  const result = validatePortableProfile(
    JSON.stringify({
      schema_version: '1.0',
      interests: [
        {
          topic: 'Проверять факты в ответах языковых моделей',
          strength: 0.9,
          confidence: 0.9,
        },
      ],
    }),
  );
  if (!result.ok) throw new Error(result.errors.join(','));
  return normalizePortableProfile(result.value, 'chatgpt');
}
function page(texts: string[]): PageCapture {
  const readingMap = createArticleMap(
    texts.map((text) => ({ text, section: '', kind: 'paragraph' })),
  );
  return {
    url: 'https://example.com/article',
    title: 'Evaluation',
    excerpt: '',
    content: texts.join('\n'),
    wordCount: 300,
    readingTimeMinutes: 2,
    headings: [],
    isArticle: true,
    extractionMethod: 'semantic',
    byline: null,
    siteName: 'Example',
    publishedTime: null,
    language: 'en',
    capturedAt: '2026-09-21T00:00:00Z',
    readingMap,
  };
}
const core =
  'Compare generated assertions against independent primary references. Record missing citations and unsupported claims instead of accepting fluent wording as evidence.';
const caveat =
  'However, agreement between models is not independent confirmation if they reproduce the same mistaken source.';

describe('optional semantic passage selection', () => {
  it('uses profile topics even without literal article overlap and retains qualifications', () => {
    const material = page([core, caveat]);
    const input = prepareSemanticInput(material, profile(), context, null);
    expect(input.queries[0]?.text).toContain('Проверять');
    const result = selectSemanticPassages(material, input, {
      positive: [[0.88], [0.83]],
      negative: [[], []],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.blockIds).toEqual(
      material.readingMap!.blocks.map((b) => b.id),
    );
    expect(result.items[0]?.knowledge).toBe('unknown');
    expect(result.source).toBe('local');
  });
  it('does not force a selection for unrelated or malformed scores', () => {
    const material = page([core, caveat]);
    const input = prepareSemanticInput(material, profile(), context, null);
    expect(
      selectSemanticPassages(material, input, {
        positive: [[0.72], [NaN]],
        negative: [],
      }).items,
    ).toEqual([]);
  });
  it('respects explicit low-value topics rather than selecting every semantic match', () => {
    const material = page([core]);
    const input = prepareSemanticInput(material, profile(), context, null);
    expect(
      selectSemanticPassages(material, input, {
        positive: [[0.86]],
        negative: [[0.89]],
      }).items,
    ).toEqual([]);
  });
  it('samples a long article across its whole length and reports partial coverage', () => {
    const material = page(
      Array.from({ length: 210 }, (_, i) => `Section ${i}: ${core}`),
    );
    const input = prepareSemanticInput(material, profile(), context, null);
    expect(input.chunks).toHaveLength(160);
    expect(input.chunks.at(-1)?.blockId).toBe(
      material.readingMap!.blocks.at(-1)?.id,
    );
    expect(input.partial).toBe(true);
  });
  it('does not truncate long paragraphs to only the first model window', () => {
    const material = page([core.repeat(30)]);
    const input = prepareSemanticInput(material, profile(), context, null);
    expect(input.chunks.length).toBeGreaterThan(2);
    expect(new Set(input.chunks.map((x) => x.blockId)).size).toBe(1);
  });
  it('omits paused goals, weak inferences and duplicated profile queries', () => {
    const p = profile();
    p.goals = [
      {
        id: 'old',
        goal: 'Old task',
        priority: 'high',
        status: 'paused',
        confidence: 1,
        sources: [],
      },
    ];
    p.interests.push({ ...p.interests[0]!, id: 'duplicate' });
    expect(semanticQueries(p, context)).toHaveLength(1);
  });
  it('respects the reading scenario while an explicit current intent stays first', () => {
    const p = profile();
    p.goals = [
      {
        id: 'work',
        goal: 'Evaluate model answers',
        priority: 'high',
        status: 'active',
        confidence: 1,
        sources: [],
      },
    ];
    p.leisureProfile.preferences = [
      {
        id: 'garden',
        kind: 'recreationalTopic',
        category: 'Growing tomatoes',
        preference: 'high',
        confidence: 1,
        evidenceType: 'explicitly_stated',
        basis: 'I enjoy gardening',
        sources: [],
      },
    ];
    const relaxed = semanticQueries(p, {
      ...context,
      scenario: 'relax',
      intent: 'My explicit task',
    });
    expect(relaxed[0]).toMatchObject({ text: 'My explicit task', priority: 1 });
    expect(
      relaxed.find((x) => x.text === 'Growing tomatoes')!.priority,
    ).toBeGreaterThan(
      relaxed.find((x) => x.text === 'Evaluate model answers')!.priority!,
    );
    const working = semanticQueries(p, context);
    expect(
      working.find((x) => x.text === 'Growing tomatoes')!.priority,
    ).toBeLessThan(
      working.find((x) => x.text === 'Evaluate model answers')!.priority!,
    );
  });
});
