import type { PersonalProfile } from '../profile/schema';
import type {
  AnalysisContext,
  PageCapture,
  RelevantProfileContext,
} from '../shared/types';
import type { ReadingPassage, ReadingPassages } from '../reading/types';
import { articleMap, isListIntroduction } from '../reading/blocks';
import { blockAlreadyKnown, mergePassages } from '../reading/local-passages';
import { scenarioSignalWeight } from '../scenario/signal-weights';

export interface SemanticQuery {
  text: string;
  basis: ReadingPassage['basis'];
  priority?: number;
}
export interface SemanticChunk {
  blockId: string;
  text: string;
}
export interface SemanticInput {
  queries: SemanticQuery[];
  exclusions: string[];
  chunks: SemanticChunk[];
  partial: boolean;
}
export interface SemanticScores {
  positive: number[][];
  negative: number[][];
}

/** Do not prefilter by literal article words: this is precisely what embeddings replace. */
export function semanticQueries(
  profile: PersonalProfile,
  context: AnalysisContext,
): SemanticQuery[] {
  const queries: SemanticQuery[] = [
    ...(context.intent.trim()
      ? [{ text: context.intent, basis: 'goal' as const, priority: 1 }]
      : []),
    ...profile.goals
      .filter((g) => g.status === 'active' && g.confidence >= 0.5)
      .sort(
        (a, b) =>
          ({ high: 3, medium: 2, low: 1 })[b.priority] -
          { high: 3, medium: 2, low: 1 }[a.priority],
      )
      .slice(0, 5)
      .map((g) => ({
        text: g.goal,
        basis: 'goal' as const,
        priority: scenarioSignalWeight(context.scenario, 'goal') * g.confidence,
      })),
    ...profile.learningAreas
      .filter((g) => g.confidence >= 0.5)
      .slice(0, 5)
      .map((g) => ({
        text: `${g.topic}. ${g.focus ?? ''}`,
        basis: 'learning' as const,
        priority:
          scenarioSignalWeight(context.scenario, 'learningArea') * g.confidence,
      })),
    ...profile.interests
      .filter((g) => g.confidence >= 0.5)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 5)
      .map((g) => ({
        text: g.topic,
        basis: 'interest' as const,
        priority:
          scenarioSignalWeight(context.scenario, 'interest') * g.confidence,
      })),
    ...profile.leisureProfile.preferences
      .filter(
        (g) =>
          g.confidence >= 0.5 &&
          g.kind !== 'dislike' &&
          ['high', 'medium'].includes(g.preference),
      )
      .slice(0, 5)
      .map((g) => ({
        text: g.category,
        basis: 'interest' as const,
        priority:
          scenarioSignalWeight(context.scenario, 'leisurePreference') *
          g.confidence,
      })),
  ];
  const seen = new Set<string>();
  return queries.filter((q) => {
    q.text = q.text.trim().slice(0, 1200);
    const key = q.text.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function prepareSemanticInput(
  material: PageCapture,
  profile: PersonalProfile,
  context: AnalysisContext,
  evidence: RelevantProfileContext | null,
): SemanticInput {
  const map = articleMap(material);
  const chunks: SemanticChunk[] = [];
  for (const block of map.blocks) {
    if (
      block.text.length < 60 ||
      isListIntroduction(map, block) ||
      blockAlreadyKnown(block, evidence)
    )
      continue;
    // Split long paragraphs instead of silently considering only their opening.
    for (let offset = 0; offset < block.text.length; offset += 1200) {
      const text = block.text.slice(offset, offset + 1500);
      if (text.length < 60) break;
      chunks.push({
        blockId: block.id,
        text: `${block.section.slice(0, 120)}\n${text}`.trim(),
      });
    }
  }
  const maximum = 160;
  const selected =
    chunks.length <= maximum
      ? chunks
      : Array.from(
          { length: maximum },
          (_, i) =>
            chunks[Math.round((i * (chunks.length - 1)) / (maximum - 1))]!,
        );
  return {
    queries: semanticQueries(profile, context),
    exclusions: [
      ...profile.lowValueTopics
        .filter((x) => x.confidence >= 0.7)
        .slice(0, 8)
        .map((x) => x.topic.slice(0, 500)),
      ...(context.scenario === 'relax' || context.scenario === 'explore'
        ? profile.leisureProfile.preferences
            .filter((x) => x.kind === 'dislike' && x.confidence >= 0.7)
            .slice(0, 5)
            .map((x) => x.category.slice(0, 500))
        : []),
    ],
    chunks: selected,
    partial: !map.complete || chunks.length > maximum,
  };
}

/** E5 similarities are ranking signals, never probabilities of usefulness or novelty. */
export function selectSemanticPassages(
  material: PageCapture,
  input: SemanticInput,
  scores: SemanticScores,
): ReadingPassages {
  const map = articleMap(material);
  const candidates: ReadingPassage[] = [];
  input.chunks.forEach((chunk, index) => {
    const row = scores.positive[index];
    if (
      !row ||
      row.length !== input.queries.length ||
      row.some((x) => !Number.isFinite(x))
    )
      return;
    const ranked = row.map(
      (score, i) => score - 0.04 * (1 - (input.queries[i]?.priority ?? 1)),
    );
    const score = Math.max(...ranked);
    const queryIndex = ranked.indexOf(score);
    const query = input.queries[queryIndex];
    const excluded = Math.max(0, ...(scores.negative[index] ?? []));
    if (!query || score < 0.8 || excluded >= row[queryIndex]! - 0.01) return;
    candidates.push({
      coreBlockId: chunk.blockId,
      blockIds: [chunk.blockId],
      basis: query.basis,
      focus: query.text,
      knowledge: 'unknown',
      score,
    });
  });
  const best = Math.max(0, ...candidates.map((c) => c.score));
  const items = mergePassages(
    map,
    candidates.filter((c) => c.score >= best - 0.035),
  );
  return {
    version: 1,
    fingerprint: map.fingerprint,
    source: 'local',
    method: 'semantic',
    coverage: input.partial ? 'partial' : 'complete',
    status: !input.queries.length
      ? 'no-context'
      : items.length
        ? 'ready'
        : 'no-match',
    items,
  };
}
