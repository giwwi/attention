import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureDocument } from '../src/content/capture';
import { collectReadingBlocks } from '../src/content/reading-blocks';
import {
  findNovelPassageMatches,
  NovelPassageController,
} from '../src/content/novel-passages';
import {
  exactPassageWindow,
  isArticleMap,
  passageWindow,
} from '../src/reading/blocks';
import { preparePassages } from '../src/reading/prepared-passages';
import {
  mergePassages,
  selectLocalPassages,
} from '../src/reading/local-passages';
import { validatePassageOutput } from '../src/reading/ai-passages';
import {
  selectSemanticPassages,
  type SemanticInput,
} from '../src/semantic/selection';
import {
  fullCardDecision,
  personalValueReason,
  previewVerdict,
} from '../src/content/hover-preview';
import type { HoverPreview } from '../src/shared/types';

const focus = 'political economy of open models';
const context = {
  scenario: 'work' as const,
  intent: focus,
  availableMinutes: 15 as const,
};
function article() {
  document.title = 'Open models reading list';
  document.body.innerHTML = `<article><h1>${document.title}</h1><h2>Foundation</h2>
  <p>Research sources on the political economy of open models:</p>
  <ul><li id="economy">Political economy of open models: compare licensing incentives and investment — <a href="https://example.com/economy">Economics study</a>.
  <ul><li id="data">Political economy of open models: ownership and access to training data — <a href="https://example.com/data">Data commons</a>.</li>
  <li id="irrelevant">Gardening advice explains how to protect tomato seedlings and prepare soil for a summer harvest.</li></ul></li>
  <li id="policy">Political economy of open models: industrial policy and research funding — <a href="https://example.com/policy">Policy study</a>.</li>
  ${Array.from({ length: 18 }, (_, index) => `<li>Resource ${index} describes unrelated observations about astronomy, telescope optics and planetary motion.</li>`).join('')}</ul>
  <p>Interconnects AI is a reader-supported publication. Consider becoming a subscriber.</p>
  <div class="subscription-widget"><p>Subscribe to our newsletter for model research updates.</p><form><input type="email"></form></div>
  <p>Leave a comment</p><h2>Other subjects</h2><p>Subscription businesses collect recurring payments; this economic analysis is ordinary article content.</p>
  </article>`;
  return captureDocument(document, 'https://example.com/reading-list');
}
function blockFor(capture: ReturnType<typeof article>, id: string) {
  const { elements } = collectReadingBlocks(document.querySelector('article')!);
  return capture.readingMap!.blocks.find(
    (block) => elements.get(block.id)?.id === id,
  )!;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('resource-list selection', () => {
  it('retains a qualification after the list without attaching intervening entries', () => {
    article();
    const note = document.createElement('p');
    note.textContent =
      'However, these sources discuss research policy, not verified estimates of economic returns.';
    document.querySelector('article > ul')!.after(note);
    const capture = captureDocument(
      document,
      'https://example.com/reading-list',
    );
    const core = blockFor(capture, 'data');
    const window = passageWindow(capture.readingMap!, core.id);
    expect(window.at(-1)?.text).toBe(note.textContent);
    expect(window.map((block) => block.text).join(' ')).not.toContain('tomato');
    expect(isArticleMap(capture.readingMap)).toBe(true);
    expect(
      exactPassageWindow(
        capture.readingMap!,
        core.id,
        window.map((block) => block.id),
      ),
    ).toEqual(window);
  });
  it('splits nested entries, filters promotions and preserves source links and parent context', () => {
    const capture = article();
    const map = capture.readingMap!;
    expect(isArticleMap(map)).toBe(true);
    const core = blockFor(capture, 'data');
    expect(core.kind).toBe('list-item');
    const window = passageWindow(map, core.id);
    expect(window.map((block) => block.text).join(' ')).toContain(
      'licensing incentives',
    );
    expect(window.at(-1)?.text).toContain('Data commons');
    expect(window.map((block) => block.text).join(' ')).not.toContain('tomato');
    expect(map.blocks.map((block) => block.text).join(' ')).not.toContain(
      'Consider becoming',
    );
    expect(map.blocks.map((block) => block.text).join(' ')).not.toContain(
      'Leave a comment',
    );
    expect(map.blocks.at(-1)?.text).toContain('Subscription businesses');
    expect(
      exactPassageWindow(
        map,
        core.id,
        window.map((block) => block.id),
      ),
    ).toEqual(window);
    const matches = findNovelPassageMatches(document, capture, [], 3, {
      version: 1,
      source: 'ai',
      coverage: 'complete',
      status: 'ready',
      fingerprint: map.fingerprint,
      items: [
        {
          coreBlockId: core.id,
          blockIds: window.map((b) => b.id),
          basis: 'goal',
          knowledge: 'unknown',
          score: 0.9,
        },
      ],
    });
    expect(matches).toHaveLength(1);
    expect(
      matches[0]!.ranges!.map((range) => range.toString()).join(' '),
    ).not.toContain('tomato');
    expect(matches[0]!.element.id).toBe('data');
    expect(document.querySelector('#data a')?.getAttribute('href')).toBe(
      'https://example.com/data',
    );
  });

  it('keeps distinct resource entries that share an introduction in both local and AI selection', () => {
    const capture = article();
    const map = capture.readingMap!;
    const cores = ['data', 'policy'].map((id) => blockFor(capture, id));
    const prepared = preparePassages(map).filter((p) =>
      cores.some((core) => core.id === p.coreBlockId),
    );
    expect(prepared).toHaveLength(2);
    const accepted = validatePassageOutput(
      {
        passages: prepared.map((p) => ({
          passageId: p.id,
          queryIndex: 0,
          relevance: 0.95,
          confidence: 0.95,
          contextSufficient: true,
          contribution: 'A source about political economy.',
          knowledgeEvidenceIds: [],
          possiblyNew: false,
        })),
      },
      { blocks: map.blocks, passages: prepared },
      map,
      context,
      null,
    );
    const items = mergePassages(map, accepted, 3, 'preserve');
    expect(items).toHaveLength(2);
    const matches = findNovelPassageMatches(document, capture, [], 3, {
      version: 1,
      source: 'ai',
      coverage: 'complete',
      status: 'ready',
      fingerprint: map.fingerprint,
      items,
    });
    expect(matches).toHaveLength(2);
    expect(matches.every((match) => match.excerpt.length < 700)).toBe(true);
    const local = selectLocalPassages(capture, context, null);
    expect(local.items.length).toBeGreaterThan(0);
    expect(
      local.items.every(
        (p) =>
          map.blocks.find((b) => b.id === p.coreBlockId)?.kind === 'list-item',
      ),
    ).toBe(true);
    expect(local.items.every((p) => p.blockIds.length <= 3)).toBe(true);
    const input: SemanticInput = {
      queries: [{ text: focus, basis: 'interest', priority: 1 }],
      exclusions: [],
      partial: false,
      chunks: cores.map((b) => ({ blockId: b.id, text: b.text })),
    };
    const semantic = selectSemanticPassages(capture, input, {
      positive: [[0.88], [0.87]],
      negative: [[], []],
    });
    expect(semantic.items).toHaveLength(2);
    expect(semantic.items[0]?.focus).toBe(focus);
    expect(semantic.items.every((item) => item.knowledge === 'unknown')).toBe(
      true,
    );
    // Forged windows cannot attach an unrelated resource, even when nearby.
    expect(
      exactPassageWindow(map, cores[0]!.id, [
        ...prepared[0]!.blockIds,
        blockFor(capture, 'irrelevant').id,
      ]),
    ).toEqual([]);
  });

  it.each([true, false])(
    'highlights only the chosen entry/context and survives reopen (native: %s)',
    (native) => {
      const capture = article();
      const map = capture.readingMap!;
      Element.prototype.scrollIntoView = vi.fn();
      const registry = new Map<string, Set<Range>>();
      vi.stubGlobal('CSS', { highlights: native ? registry : undefined });
      vi.stubGlobal(
        'Highlight',
        class extends Set<Range> {
          constructor(...ranges: Range[]) {
            super(ranges);
          }
        },
      );
      const core = blockFor(capture, 'data');
      const selection = {
        version: 1 as const,
        source: 'local' as const,
        coverage: 'complete' as const,
        status: 'ready' as const,
        fingerprint: map.fingerprint,
        items: [
          {
            coreBlockId: core.id,
            blockIds: passageWindow(map, core.id).map((b) => b.id),
            basis: 'interest' as const,
            knowledge: 'unknown' as const,
            score: 0.9,
          },
        ],
      };
      const controller = new NovelPassageController();
      for (let attempt = 0; attempt < 2; attempt++) {
        const matches = findNovelPassageMatches(
          document,
          capture,
          [],
          3,
          selection,
        );
        expect(
          controller.show(matches, capture, {
            language: 'en',
            readwiseConnected: false,
          }),
        ).toBe(true);
        const painted = native
          ? [...(registry.get('attention-potential-new') ?? [])]
              .map((r) => r.toString())
              .join(' ')
          : [...document.querySelectorAll('.attention-potential-new-fallback')]
              .map((e) => e.textContent)
              .join(' ');
        expect(painted).toContain('Data commons');
        expect(painted).not.toContain('tomato');
        expect(painted).not.toContain('industrial policy');
        expect(
          collectReadingBlocks(document.querySelector('article')!).map
            .fingerprint,
        ).toBe(map.fingerprint);
        controller.clear();
        expect(document.querySelector('#data a')?.textContent).toBe(
          'Data commons',
        );
      }
    },
  );
});

it('uses semantic evidence for a selective recommendation without inventing novelty or an AI verification', () => {
  const preview = {
    recommendedAction: 'skip',
    source: 'full-analysis',
    utilityScore: 25,
    scenario: 'work',
    components: { relevance: 25, novelty: 30, quality: 50, actionability: 10 },
    insights: {
      taskEvidence: 'no-match',
      readingPassages: {
        source: 'local',
        method: 'semantic',
        status: 'ready',
        items: [{ focus, basis: 'interest', knowledge: 'unknown' }],
      },
    },
  } as unknown as HoverPreview;
  expect(fullCardDecision(preview)).toBe('skim');
  expect(previewVerdict(preview)).toBe('maybe');
  expect(personalValueReason(preview)).toContain(focus);
  expect(personalValueReason(preview)).not.toContain('outside');
  expect(preview.utilityScore).toBe(25);
  preview.insights!.readingPassages!.items = [];
  expect(fullCardDecision(preview)).toBe('skip');
});
