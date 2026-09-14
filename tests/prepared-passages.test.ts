import { describe, expect, it } from 'vitest';
import { captureDocument } from '../src/content/capture';
import { findNovelPassageMatches } from '../src/content/novel-passages';
import {
  createArticleMap,
  exactPassageWindow,
  passageWindow,
} from '../src/reading/blocks';
import { preparePassages } from '../src/reading/prepared-passages';
import {
  passageBatches,
  validatePassageOutput,
  buildPassagePrompt,
} from '../src/reading/ai-passages';
import { mergePassages } from '../src/reading/local-passages';
import { sharedAnalysisInput } from '../src/analyzer/shared-input';
import { compactReason } from '../src/content/compact-reason';
import type { PassageValidationTrace } from '../src/diagnostics/ai-analysis-types';

const context = {
  scenario: 'work' as const,
  intent: 'compare evaluation methods',
  availableMinutes: 15 as const,
};
const choice = (passageId: string) => ({
  passageId,
  queryIndex: 0,
  relevance: 0.9,
  confidence: 0.95,
  contextSufficient: true,
  contribution: 'A comparison with its qualifications.',
  knowledgeEvidenceIds: [],
  possiblyNew: false,
});
function article() {
  const topics = [
    'Latency caching throughput deployment production',
    'Sampling bias controls treatment assignment inference',
    'Translation idioms dialect language culture fluency',
    'Reliability uptime outages resilience failover availability',
    'Security threats isolation permissions passwords authentication',
    'Accessibility navigation keyboard contrast reader semantics',
  ];
  document.title = 'Comparing evaluation methods';
  document.body.innerHTML = `<article><h1>Comparing evaluation methods</h1>${topics
    .map(
      (topic, section) =>
        `<h2>Section ${section}</h2><p>${topic}. Compare evaluation methods using the original observations.</p>` +
        Array.from(
          { length: 4 },
          (_, index) =>
            `<p>However, ${topic.toLowerCase()} has qualification ${index}: the comparison requires representative observations before applying the result.</p>`,
        ).join(''),
    )
    .join('')}</article>`;
  return captureDocument(document, 'https://example.test/reading');
}

describe('prepared AI passages', () => {
  it('carries six long contextual windows through validation and exact DOM matching', () => {
    const capture = article();
    const input = sharedAnalysisInput(capture);
    const offered = input.batch.passages.filter(
      (p) => p.blockIds.length === 5 && p.coreBlockId === p.blockIds[0],
    );
    expect(offered).toHaveLength(6);
    // The previous response contract reassembled these IDs and rejected the distant caveat.
    expect(
      passageWindow(input.map, offered[0]!.coreBlockId, offered[0]!.blockIds),
    ).toEqual([]);
    const trace: PassageValidationTrace[] = [];
    const accepted = validatePassageOutput(
      { passages: offered.map((p) => choice(p.id)) },
      input.batch,
      input.map,
      context,
      null,
      trace,
    );
    expect(accepted).toHaveLength(6);
    expect(trace.every((t) => t.accepted && t.reasons.length === 0)).toBe(true);
    expect(accepted.map((p) => p.blockIds)).toEqual(
      offered.map((p) => p.blockIds),
    );
    const selected = mergePassages(input.map, accepted, 3, 'preserve');
    expect(selected).toHaveLength(3);
    const matches = findNovelPassageMatches(document, capture, [], 3, {
      version: 1,
      source: 'ai',
      status: 'ready',
      coverage: 'complete',
      fingerprint: input.map.fingerprint,
      items: selected,
    });
    expect(matches).toHaveLength(3);
    matches.forEach((match, index) => {
      expect(match.ranges).toHaveLength(5);
      expect(match.excerpt).toBe(
        input.map.blocks
          .filter((b) => selected[index]!.blockIds.includes(b.id))
          .map((b) => b.text)
          .join('\n\n'),
      );
    });
  });

  it('offers only whole, reproducible windows even when the input budget is partial', () => {
    const capture = article();
    capture.readingMap = createArticleMap(
      Array.from({ length: 150 }, (_, index) => ({
        section: `Section ${Math.floor(index / 5)}`,
        kind: 'paragraph' as const,
        text: `Comparison ${index}. ${'Each procedure measures a different property using independent evidence. '.repeat(10)}`,
      })),
    );
    const input = sharedAnalysisInput(capture);
    expect(input.complete).toBe(false);
    expect(input.content.length).toBeLessThanOrEqual(24000);
    expect(input.batch.passages.length).toBeGreaterThan(0);
    const sent = new Set(input.batch.blocks.map((b) => b.id));
    for (const p of input.batch.passages) {
      expect(p.blockIds.every((id) => sent.has(id))).toBe(true);
      const items = validatePassageOutput(
        { passages: [choice(p.id)] },
        input.batch,
        input.map,
        context,
        null,
      );
      expect(items[0]?.blockIds).toEqual(p.blockIds);
    }
    for (const batch of passageBatches(input.map).batches) {
      expect(
        batch.blocks.reduce((n, b) => n + b.text.length + 2, 0),
      ).toBeLessThanOrEqual(16000);
      const payload = JSON.parse(
        buildPassagePrompt(batch, context, null).split('\n').at(-1)!,
      );
      expect(payload.passages).toEqual(batch.passages);
      expect(payload).not.toHaveProperty('coreIds');
    }
  });

  it('cannot select unoffered IDs or override a prepared window', () => {
    const input = sharedAnalysisInput(article());
    for (const bad of [
      choice('invented'),
      {
        ...choice(input.batch.passages[0]!.id),
        contextBlockIds: [input.map.blocks.at(-1)!.id],
      },
    ]) {
      const trace: PassageValidationTrace[] = [];
      expect(
        validatePassageOutput(
          { passages: [bad] },
          input.batch,
          input.map,
          context,
          null,
          trace,
        ),
      ).toEqual([]);
      expect(trace[0]?.reasons).toEqual(
        'contextBlockIds' in bad
          ? ['unsupported-passage-format']
          : ['passage-not-offered'],
      );
    }
  });

  it('never expands overlapping AI selections after the model has assessed them', () => {
    const map = createArticleMap(
      Array.from({ length: 4 }, (_, i) => ({
        section: 'One',
        kind: 'paragraph' as const,
        text: `Observation ${i} explains a separate model evaluation procedure.`,
      })),
    );
    const prepared = preparePassages(map);
    const input = { blocks: map.blocks, passages: prepared };
    const accepted = validatePassageOutput(
      { passages: prepared.slice(0, 2).map((p) => choice(p.id)) },
      input,
      map,
      context,
      null,
    );
    expect(accepted).toHaveLength(2);
    const selected = mergePassages(map, accepted, 3, 'preserve');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.blockIds).toEqual(prepared[0]!.blockIds);
  });

  it('adds context to a short sentence without crossing a heading', () => {
    const map = createArticleMap([
      {
        section: 'One',
        kind: 'paragraph',
        text: 'Compare the model evaluation results.',
      },
      {
        section: 'One',
        kind: 'paragraph',
        text: 'The comparison uses held-out examples from actual customer requests.',
      },
      {
        section: 'Two',
        kind: 'paragraph',
        text: 'A separate topic begins in the next section.',
      },
    ]);
    expect(preparePassages(map)[0]!.blockIds).toEqual(
      map.blocks.slice(0, 2).map((b) => b.id),
    );
    expect(
      exactPassageWindow(
        map,
        map.blocks[0]!.id,
        map.blocks.map((b) => b.id),
      ),
    ).toEqual([]);
  });

  it('rejects a damaged prepared window or context not present in the request', () => {
    const input = sharedAnalysisInput(article());
    const p = input.batch.passages[0]!;
    for (const ids of [
      [p.blockIds[0]!, p.blockIds[2]!],
      [...p.blockIds].reverse(),
      [p.blockIds[0]!],
    ]) {
      const trace: PassageValidationTrace[] = [];
      const batch = { ...input.batch, passages: [{ ...p, blockIds: ids }] };
      expect(
        validatePassageOutput(
          { passages: [choice(p.id)] },
          batch,
          input.map,
          context,
          null,
          trace,
        ),
      ).toEqual([]);
      expect(trace[0]?.reasons).toContain('prepared-context-invalid');
    }
    const trace: PassageValidationTrace[] = [];
    const batch = {
      ...input.batch,
      blocks: input.batch.blocks.filter((b) => b.id !== p.blockIds[2]),
    };
    expect(
      validatePassageOutput(
        { passages: [choice(p.id)] },
        batch,
        input.map,
        context,
        null,
        trace,
      ),
    ).toEqual([]);
    expect(trace[0]?.reasons).toEqual(['context-not-sent']);
  });

  it('does not clip an overlong qualification or unresolved reference to make a candidate', () => {
    const map = createArticleMap([
      {
        section: 'One',
        kind: 'paragraph',
        text: 'This depends on an explanation that was not included.',
      },
      {
        section: 'Two',
        kind: 'paragraph',
        text: 'Compare the model evaluation results.',
      },
      {
        section: 'Two',
        kind: 'paragraph',
        text: `However, ${'the qualification must stay complete. '.repeat(200)}`,
      },
    ]);
    expect(preparePassages(map)).toEqual([]);
  });
});

describe('concise card explanation', () => {
  it('keeps short explanations intact and makes an explicit bounded preview for long ones', () => {
    expect(compactReason('Разбор поможет сравнить методы оценки.')).toBe(
      'Разбор поможет сравнить методы оценки.',
    );
    const text =
      'Разбор методов поможет сравнить подходы к оценке моделей. ' +
      'Существенное ограничение исследования требует подробного объяснения. '.repeat(
        8,
      );
    expect(compactReason(text).length).toBeLessThanOrEqual(320);
    expect(compactReason(text)).toMatch(/…$/u);
  });
});
