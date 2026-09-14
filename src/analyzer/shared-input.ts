import { articleMap } from '../reading/blocks';
import type { ArticleMap } from '../reading/types';
import {
  preparePassages,
  type PassageBatch,
} from '../reading/prepared-passages';
import type { PageCapture } from '../shared/types';
import { AI_ANALYSIS_LIMITS } from './config';

export interface SharedAnalysisInput {
  map: ArticleMap;
  batch: PassageBatch;
  complete: boolean;
  content: string;
}

/** One bounded source set for BOTH the verdict and passage selection. Never clip a paragraph. */
export function sharedAnalysisInput(
  material: PageCapture,
): SharedAnalysisInput {
  const map = articleMap(material);
  const prepared = preparePassages(map);
  const byCore = new Map(
    prepared.map((passage) => [passage.coreBlockId, passage]),
  );
  const byId = new Map(map.blocks.map((block) => [block.id, block]));
  const selected = new Set<string>();
  let characters = 0;
  const sections = new Map<string, number[]>();
  map.blocks.forEach((block, index) => {
    const group = sections.get(block.section) ?? [];
    group.push(index);
    sections.set(block.section, group);
  });
  // Distribute the budget across sections and their beginnings/middles/endings.
  const groups = [...sections.values()].map((indices) => [
    ...new Set([
      indices[0]!,
      indices[Math.floor(indices.length / 2)]!,
      indices.at(-1)!,
      ...indices,
    ]),
  ]);
  for (
    let round = 0;
    round < Math.max(0, ...groups.map((group) => group.length));
    round++
  ) {
    for (const group of groups) {
      const index = group[round];
      if (index === undefined) continue;
      const core = map.blocks[index]!;
      if (selected.has(core.id)) continue;
      const window = (byCore.get(core.id)?.blockIds ?? []).map((id) =>
        byId.get(id)!,
      );
      const addition = window.filter((block) => !selected.has(block.id));
      const size = addition.reduce(
        (total, block) => total + block.text.length + 2,
        0,
      );
      if (
        !window.length ||
        characters + size > AI_ANALYSIS_LIMITS.contentCharacters
      )
        continue;
      for (const block of addition) selected.add(block.id);
      characters += size;
    }
  }
  const blocks = map.blocks.filter((block) => selected.has(block.id));
  return {
    map,
    batch: {
      blocks,
      passages: prepared.filter((passage) =>
        passage.blockIds.every((id) => selected.has(id)),
      ),
    },
    complete: map.complete && blocks.length === map.blocks.length,
    content: blocks.map((block) => block.text).join('\n\n'),
  };
}
