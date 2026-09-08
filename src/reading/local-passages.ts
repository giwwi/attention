import { textTokens } from '../analyzer/text-match';
import { conceptTokens } from '../analyzer/concept-aliases';
import { applyClaimMemoryToClaim } from '../novelty/claim-memory';
import { applyUnifiedLocalEvidenceToClaim } from '../evidence/unified-evidence';
import { claimsFactuallyCompatible } from '../analyzer/claim-match';
import type {
  AnalysisContext,
  KeyClaimAssessment,
  PageCapture,
  RelevantProfileContext,
} from '../shared/types';
import { articleMap, passageWindow } from './blocks';
import type {
  ArticleBlock,
  ArticleMap,
  ReadingPassage,
  ReadingPassages,
} from './types';

const GENERIC = new Set(
  'want need find learn understand know useful practical article material topic system development technology about into that which their have will more using use current goal хочу найти узнать понять изучить нужно статья материал тема система развитие технология полезный текущая цель'.split(
    ' ',
  ),
);
const relevantTokens = (text: string) => {
  const tokens = textTokens(text);
  // Alias matching also needs unstemmed words (e.g. Russian "исследование").
  const surfaceWords = new Set(
    text
      .normalize('NFKC')
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [],
  );
  for (const concept of conceptTokens(text, surfaceWords)) tokens.add(concept);
  return new Set(
    [...tokens].filter((token) => !GENERIC.has(token) && !/^\d+$/u.test(token)),
  );
};

export function readingQueries(
  context: AnalysisContext,
  profile: RelevantProfileContext | null,
): { text: string; basis: ReadingPassage['basis']; weight: number }[] {
  const selected = profile?.readingProfile ?? profile;
  return [
    ...(context.intent.trim()
      ? [{ text: context.intent, basis: 'goal' as const, weight: 3 }]
      : []),
    ...(selected?.signals ?? [])
      .filter(
        (signal) =>
          signal.effect === 'positive' &&
          ['goal', 'learningArea', 'interest', 'leisurePreference'].includes(
            signal.kind,
          ),
      )
      .map((signal) => ({
        text: signal.label,
        basis: (signal.kind === 'goal'
          ? 'goal'
          : signal.kind === 'learningArea'
            ? 'learning'
            : 'interest') as ReadingPassage['basis'],
        weight:
          (signal.kind === 'goal'
            ? 2.5
            : signal.kind === 'learningArea'
              ? 2
              : 1) * signal.confidence,
      })),
    ...(selected?.knowledgeSignals ?? [])
      .filter((signal) => signal.kind === 'learning')
      .map((signal) => ({
        text: `${signal.topic} ${signal.statement}`,
        basis: 'learning' as const,
        weight: 2 * signal.confidence,
      })),
  ].filter((query) => relevantTokens(query.text).size > 0);
}

/** A whole block is familiar only with specific, compatible evidence. Missing evidence stays unknown. */
export function blockAlreadyKnown(
  block: ArticleBlock,
  profile: RelevantProfileContext | null,
): boolean {
  const normalize = (text: string) =>
    text.replace(/\s+/gu, ' ').trim().toLowerCase();
  const exactKnown = (
    (profile?.readingProfile ?? profile)?.knowledgeSignals ?? []
  ).some(
    (signal) =>
      signal.kind === 'known' &&
      signal.evidenceType !== 'inferred' &&
      signal.confidence >= 0.7 &&
      normalize(signal.statement).includes(normalize(block.text)) &&
      claimsFactuallyCompatible(block.text, signal.statement),
  );
  if (exactKnown) return true;
  const claim: KeyClaimAssessment = {
    claim: block.text,
    sourceExcerpt: block.text,
    type: 'thesis',
    importance: 'supporting',
    novelty: 'uncertain',
    knownProbability: 0.5,
    confidence: 0.3,
    reason: '',
  };
  const assessed = applyClaimMemoryToClaim(
    applyUnifiedLocalEvidenceToClaim(claim, profile?.unifiedLocalEvidence),
    profile?.claimMemoryEvidence,
  );
  return assessed.knownProbability >= 0.75 && assessed.confidence >= 0.65;
}

export function mergePassages(
  map: ArticleMap,
  candidates: ReadingPassage[],
  maximum = 3,
): ReadingPassage[] {
  const results: ReadingPassage[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const window = passageWindow(
      map,
      candidate.coreBlockId,
      candidate.blockIds,
    );
    if (window.length === 0) continue;
    const normalized = {
      ...candidate,
      blockIds: window.map((block) => block.id),
    };
    const overlapping = results.find((item) =>
      item.blockIds.some((id) => normalized.blockIds.includes(id)),
    );
    if (overlapping) {
      const union = map.blocks.filter(
        (block) =>
          overlapping.blockIds.includes(block.id) ||
          normalized.blockIds.includes(block.id),
      );
      const combined = passageWindow(
        map,
        overlapping.coreBlockId,
        union.map((block) => block.id),
      );
      if (combined.length)
        overlapping.blockIds = combined.map((block) => block.id);
      continue;
    }
    const tokens = relevantTokens(window.map((block) => block.text).join(' '));
    if (
      results.some((item) => {
        const prior = relevantTokens(
          map.blocks
            .filter((block) => item.blockIds.includes(block.id))
            .map((block) => block.text)
            .join(' '),
        );
        const shared = [...tokens].filter((token) => prior.has(token)).length;
        return shared / Math.max(1, tokens.size + prior.size - shared) > 0.7;
      })
    )
      continue;
    if (results.length < maximum) results.push(normalized);
  }
  return results;
}

export function selectLocalPassages(
  material: PageCapture,
  context: AnalysisContext,
  profile: RelevantProfileContext | null,
): ReadingPassages {
  const map = articleMap(material);
  const queries = readingQueries(context, profile).map((query) => ({
    ...query,
    tokens: relevantTokens(query.text),
  }));
  const base: ReadingPassages = {
    version: 1,
    fingerprint: map.fingerprint,
    source: 'local',
    coverage: map.complete ? 'complete' : 'partial',
    status: queries.length ? 'no-match' : 'no-context',
    items: [],
  };
  if (!queries.length || !material.isArticle) return base;
  const tokenSets = map.blocks.map((block) => relevantTokens(block.text));
  const frequency = new Map<string, number>();
  for (const tokens of tokenSets)
    for (const token of tokens)
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
  const candidates: ReadingPassage[] = [];
  map.blocks.forEach((block, index) => {
    if (block.text.length < 60 || blockAlreadyKnown(block, profile)) return;
    const tokens = tokenSets[index]!;
    let best: { score: number; basis: ReadingPassage['basis'] } | undefined;
    for (const query of queries) {
      const matches = [...query.tokens].filter((token) => tokens.has(token));
      const lexicalMatches = matches.filter(
        (token) => !token.startsWith('concept:'),
      );
      // Several specific terms must occur in the passage itself, not merely its heading.
      const lexicalMatch =
        lexicalMatches.length > 0 &&
        lexicalMatches.length >=
          Math.min(
            2,
            [...query.tokens].filter((token) => !token.startsWith('concept:'))
              .length,
          );
      // A small existing multilingual alias dictionary can bridge languages,
      // but a single broad topic (e.g. AI) is insufficient for this fallback.
      const concepts = [...query.tokens].filter((token) =>
        token.startsWith('concept:'),
      );
      const conceptMatches = matches.filter((token) =>
        token.startsWith('concept:'),
      );
      const conceptCoverage =
        conceptMatches.length / Math.max(1, concepts.length);
      const conceptMatch = conceptMatches.length >= 2 && conceptCoverage >= 0.5;
      if (!lexicalMatch && !conceptMatch) continue;
      const coverage = lexicalMatch
        ? matches.length / query.tokens.size
        : conceptCoverage * 0.6;
      if (coverage < 0.25) continue;
      const rarity =
        matches.reduce(
          (sum, token) =>
            sum +
            Math.log(1 + map.blocks.length / (1 + (frequency.get(token) ?? 0))),
          0,
        ) / Math.sqrt(query.tokens.size);
      const structural =
        block.kind === 'list' || block.kind === 'table'
          ? 0.35
          : /\b(?:because|however|unless|example|compare|steps|limitation)\b|потому|однако|например|сравн|огранич|исключ|шаг/iu.test(
                block.text,
              )
            ? 0.25
            : 0;
      const score = query.weight * (coverage + rarity + structural);
      if (!best || score > best.score) best = { score, basis: query.basis };
    }
    if (!best) return;
    const blocks = passageWindow(map, block.id);
    if (blocks.length)
      candidates.push({
        coreBlockId: block.id,
        blockIds: blocks.map((item) => item.id),
        basis: best.basis,
        score: best.score,
        knowledge: 'unknown',
      });
  });
  base.items = mergePassages(map, candidates);
  base.status = base.items.length ? 'ready' : 'no-match';
  return base;
}
