import {
  exactPassageWindow,
  passageWindow,
  isListIntroduction,
} from './blocks';
import type { ArticleBlock, ArticleMap } from './types';

export interface PreparedPassage {
  id: string;
  coreBlockId: string;
  blockIds: string[];
}
export interface PassageBatch {
  blocks: ArticleBlock[];
  passages: PreparedPassage[];
}

/** Build before the request. The model chooses an ID, never assembles source ranges. */
export function preparePassages(map: ArticleMap): PreparedPassage[] {
  const passages: PreparedPassage[] = [];
  for (const [index, core] of map.blocks.entries()) {
    if (isListIntroduction(map, core)) continue;
    let window = passageWindow(map, core.id);
    if (!window.length) continue;
    // A short standalone sentence often needs its explanation. Prefer the next
    // paragraph; mandatory introductions and caveats are already included above.
    if (
      core.kind !== 'list-item' &&
      window.length === 1 &&
      core.text.length < 400
    ) {
      for (const neighbor of [map.blocks[index + 1], map.blocks[index - 1]]) {
        if (
          !neighbor ||
          neighbor.kind === 'list-item' ||
          neighbor.section !== core.section
        )
          continue;
        const expanded = passageWindow(map, core.id, [neighbor.id]);
        if (
          exactPassageWindow(
            map,
            core.id,
            expanded.map((block) => block.id),
          ).length
        ) {
          window = expanded;
          break;
        }
      }
    }
    const blockIds = window.map((block) => block.id);
    if (!exactPassageWindow(map, core.id, blockIds).length) continue;
    passages.push({ id: `p-${core.id}`, coreBlockId: core.id, blockIds });
  }
  return passages;
}

export function passageBatch(
  map: ArticleMap,
  passages: PreparedPassage[],
): PassageBatch {
  const ids = new Set(passages.flatMap((passage) => passage.blockIds));
  return { passages, blocks: map.blocks.filter((block) => ids.has(block.id)) };
}
