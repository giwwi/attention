import { describe, expect, it } from 'vitest';
import { captureDocument } from '../src/content/capture';
import { collectReadingBlocks } from '../src/content/reading-blocks';
import { findNovelPassageMatches } from '../src/content/novel-passages';
import { passageWindow, createArticleMap } from '../src/reading/blocks';
import { selectLocalPassages } from '../src/reading/local-passages';
import {
  buildPassagePrompt,
  passageBatches,
  validatePassageOutput,
} from '../src/reading/ai-passages';
import type {
  AnalysisContext,
  PageCapture,
  RelevantProfileContext,
} from '../src/shared/types';

const context: AnalysisContext = {
  scenario: 'work',
  intent: 'compare model evaluation methods',
  availableMinutes: 15,
};
function page(body: string): PageCapture {
  document.title = 'Evaluation methods';
  document.body.innerHTML = `<article><h1>Evaluation methods</h1>${body}</article>`;
  return captureDocument(document, 'https://example.com/article');
}
const useful =
  'Compare model evaluation methods on separate test examples before selecting a benchmark. Keep the evaluation data out of the training set.';
const caveat =
  'However, this comparison only applies when the test examples represent the actual tasks and users.';

describe('contextual local passages', () => {
  it('finds a supporting recommendation deep in the article and retains its qualification', () => {
    const material = page(
      `<h2>Introduction</h2>${'<p>General background describes the history of software and offers broad introductory observations for readers.</p>'.repeat(45)}<h2>Practical comparison</h2><p>${useful}</p><p>${caveat}</p>`,
    );
    const selection = selectLocalPassages(material, context, null);
    expect(selection.items).toHaveLength(1);
    expect(selection.items[0]?.knowledge).toBe('unknown');
    const matches = findNovelPassageMatches(
      document,
      material,
      [],
      3,
      selection,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.excerpt).toBe(`${useful}\n\n${caveat}`);
    expect(matches[0]?.ranges).toHaveLength(2);
    expect(matches[0]?.coreRanges?.[0]?.toString()).toBe(useful);
  });

  it('abstains without a relevant goal rather than calling missing knowledge new', () => {
    const material = page(`<p>${useful}</p>`);
    expect(
      selectLocalPassages(material, { ...context, intent: '' }, null).status,
    ).toBe('no-context');
    expect(
      selectLocalPassages(
        material,
        { ...context, intent: 'underwater coral restoration' },
        null,
      ).items,
    ).toEqual([]);
  });

  it('uses multilingual topic aliases conservatively when goal and article languages differ', () => {
    const material = page(
      '<p>Artificial intelligence research compares evaluation procedures on separate examples and records their limitations before deployment.</p>',
    );
    const result = selectLocalPassages(
      material,
      { ...context, intent: 'искусственный интеллект исследование' },
      null,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.knowledge).toBe('unknown');
    expect(
      selectLocalPassages(
        material,
        { ...context, intent: 'искусственный интеллект инвестиции' },
        null,
      ).items,
    ).toEqual([]);
  });

  it('uses a profile goal while excluding a specifically confirmed known block', () => {
    const material = page(`<p>${useful}</p>`);
    const profile: RelevantProfileContext = {
      profileUpdatedAt: '2026-09-08',
      signals: [
        {
          id: 'g',
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
    expect(
      selectLocalPassages(material, { ...context, intent: '' }, profile).items,
    ).toHaveLength(1);
    profile.knowledgeSignals = [
      {
        id: 'k',
        profileEntryId: 'k',
        kind: 'known',
        topic: 'Evaluation methods',
        statement: useful,
        evidenceType: 'explicitly_stated',
        confidence: 0.9,
        matchScore: 1,
      },
    ];
    expect(selectLocalPassages(material, context, profile).items).toEqual([]);
  });

  it('keeps a list with its introduction, without crossing into another section', () => {
    const material = page(
      '<h2>Practical comparison</h2><p>To compare model evaluation methods, follow these steps:</p><ol><li>Set aside independent examples from actual users.</li><li>Check model evaluation methods for systematic errors.</li></ol><h2>Different topic</h2><p>However, unrelated astronomical observations must not be attached to the comparison.</p>',
    );
    const map = material.readingMap!;
    const list = map.blocks.find((block) => block.kind === 'list')!;
    const blocks = passageWindow(map, list.id);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.text).toContain('follow these steps:');
    expect(blocks[1]?.text).toContain('systematic errors');
  });

  it('refuses stale anchors even when a similar sentence remains elsewhere', () => {
    const material = page(`<p>${useful}</p><p>${caveat}</p>`);
    const selection = selectLocalPassages(material, context, null);
    document.querySelectorAll('p')[1]!.textContent = caveat.replace(
      'only applies',
      'does not apply',
    );
    expect(
      findNovelPassageMatches(document, material, [], 3, selection),
    ).toEqual([]);
  });

  it('keeps a qualification after a list when its introduction is selected', () => {
    const material = page(
      `<p>To compare model evaluation methods, follow these steps:</p><ol><li>Set aside independent examples from actual users.</li><li>Check systematic errors.</li></ol><p>${caveat}</p>`,
    );
    const map = material.readingMap!;
    expect(passageWindow(map, map.blocks[0]!.id)).toEqual(map.blocks);
  });

  it('keeps the preceding explanation for a Russian dependent opening', () => {
    const material = page(
      '<p>Сравнение проводилось на независимой выборке из обращений пользователей.</p><p>Это сравнение методов оценки моделей помогает выбрать подходящую проверку качества.</p><p>Однако результат зависит от того, насколько выборка представляет реальные задачи.</p>',
    );
    const map = material.readingMap!;
    expect(passageWindow(map, map.blocks[1]!.id)).toEqual(map.blocks);
  });

  it('does not chop a very large context to fit a highlight', () => {
    const material = page(
      `<p>${useful}</p><p>However, ${'the qualification must remain complete. '.repeat(180)}</p>`,
    );
    expect(selectLocalPassages(material, context, null).items).toEqual([]);
  });

  it('does not index hidden content or duplicate nested list and table paragraphs', () => {
    page(
      '<p hidden>Private hidden irrelevant text must stay out.</p><p>Visible introduction with enough characters.</p><table><tr><th>Method</th><th>Condition</th></tr><tr><td><p>Evaluation method</p></td><td>Independent examples</td></tr></table>',
    );
    const { map } = collectReadingBlocks(document.querySelector('article')!);
    expect(map.blocks).toHaveLength(2);
    expect(map.blocks[1]?.kind).toBe('table');
    expect(map.blocks.map((block) => block.text).join(' ')).not.toContain(
      'Private hidden',
    );
  });
});

describe('AI passage boundaries', () => {
  function setup() {
    const material = page(
      `<h2>Comparison</h2><p>${useful}</p><p>${caveat}</p>`,
    );
    const map = material.readingMap!;
    const batch = passageBatches(map).batches[0]!;
    const choice = {
      coreBlockId: map.blocks[0]!.id,
      contextBlockIds: map.blocks.map((block) => block.id),
      queryIndex: 0,
      relevance: 0.9,
      confidence: 0.85,
      contextSufficient: true,
      contribution: 'A comparison procedure with its applicability condition.',
      knowledgeEvidenceIds: [],
      possiblyNew: true,
    };
    return { map, batch, choice };
  }
  it('accepts a recommendation with context but does not infer novelty from absence of evidence', () => {
    const { map, batch, choice } = setup();
    const items = validatePassageOutput(
      { passages: [choice] },
      batch,
      map,
      context,
      null,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.blockIds).toEqual(map.blocks.map((block) => block.id));
    expect(items[0]?.knowledge).toBe('unknown');
  });
  it('rejects invented block IDs, invented query IDs, non-finite confidence and incomplete context', () => {
    const { map, batch, choice } = setup();
    for (const change of [
      { coreBlockId: 'invented' },
      { contextBlockIds: ['invented'] },
      { queryIndex: 91 },
      { confidence: NaN },
      { contextSufficient: false },
    ]) {
      expect(
        validatePassageOutput(
          { passages: [{ ...choice, ...change }] },
          batch,
          map,
          context,
          null,
        ),
      ).toEqual([]);
    }
  });
  it('does not serialize local notes, connector evidence or feedback to the AI', () => {
    const { batch } = setup();
    const profile = {
      signals: [],
      knowledgeSignals: [],
      obsidianEvidence: { secret: 'PRIVATE-NOTE' },
      claimMemoryEvidence: { secret: 'PRIVATE-FEEDBACK' },
    } as unknown as RelevantProfileContext;
    const prompt = buildPassagePrompt(batch, context, profile);
    expect(prompt).toContain(useful);
    expect(prompt).not.toContain('PRIVATE-');
  });
  it('covers the middle of long articles and reports a bounded partial review explicitly', () => {
    const map = createArticleMap(
      Array.from({ length: 70 }, (_, index) => ({
        kind: 'paragraph' as const,
        section: `section${index}`,
        text: `${index} ${'A complete paragraph that must not be silently clipped. '.repeat(40)}`,
      })),
    );
    const { batches, complete } = passageBatches(map);
    expect(batches).toHaveLength(4);
    expect(complete).toBe(false);
    expect(batches.flatMap((batch) => batch.coreIds)).toContain(
      map.blocks[0]!.id,
    );
    expect(batches.flatMap((batch) => batch.coreIds)).toContain(
      map.blocks.at(-1)!.id,
    );
    expect(
      batches.slice(1, -1).flatMap((batch) => batch.coreIds).length,
    ).toBeGreaterThan(0);
  });
});
