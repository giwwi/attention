import { CONCEPT_ALIASES } from './concept-aliases';
import { textTokens } from './text-match';
import { articleMap } from '../reading/blocks';
import {
  matchesLanguageMarker,
  resolveHeuristicLanguage,
} from './language-heuristics';
import type { PageCapture } from '../shared/types';

const generic = new Set(
  'want need find learn understand know useful practical article material topic about into that which their have will more using use current goal our your how can хочу найти узнать понять изучить нужно статья материал тема полезный текущая цель'.split(
    ' ',
  ),
);
const aliases = Object.entries(CONCEPT_ALIASES)
  .flatMap(([concept, names]) =>
    names.map((name) => ({ name, concept: `concept:${concept}` })),
  )
  .sort((a, b) => b.name.length - a.name.length);
const aliasConcept = new Map<string, string>(
  aliases.map(({ name, concept }) => [name, concept]),
);
const aliasPattern = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${aliases.map(({ name }) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}])`,
  'gu',
);

/** A concept and its spelling get ONE vote. Broad concepts have less weight than task terms. */
export function goalTerms(value: string): Set<string> {
  const result = new Set<string>();
  const remaining = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(aliasPattern, (name) => {
      result.add(aliasConcept.get(name)!);
      return ' ';
    });
  for (const term of textTokens(remaining)) {
    if (
      !term.startsWith('concept:') &&
      !generic.has(term) &&
      !/^\d+$/u.test(term)
    )
      result.add(term);
  }
  return result;
}

const termWeight = (term: string) => (term.startsWith('concept:') ? 0.25 : 1);

export function goalCoverage(query: Set<string>, target: Set<string>): number {
  let total = 0;
  let matched = 0;
  for (const term of query) {
    total += termWeight(term);
    if (target.has(term)) matched += termWeight(term);
  }
  return total ? matched / total : 0;
}

export interface GoalEvidence {
  metadata: number;
  body: number;
  practical: number;
}

export function assessGoalEvidence(
  material: PageCapture,
  goal: string,
): GoalEvidence {
  const query = goalTerms(goal);
  const metadata = goalCoverage(
    query,
    goalTerms(
      [material.title, material.excerpt, ...material.headings].join(' '),
    ),
  );
  let body = 0;
  let practical = 0;
  const language = resolveHeuristicLanguage(
    material.language,
    material.content,
  );
  for (const block of articleMap(material).blocks) {
    if (block.text.length < 60) continue;
    const terms = goalTerms(block.text);
    const matched = [...query].filter((term) => terms.has(term));
    // One broad topic cannot establish a solution to a multi-part task.
    const specific = matched.filter(
      (term) => !term.startsWith('concept:'),
    ).length;
    const coverage = goalCoverage(query, terms);
    const supported =
      matched.length >= Math.min(2, query.size) &&
      (specific > 0 || query.size === 1) &&
      coverage >= 0.25;
    if (!supported) continue;
    body = Math.max(body, coverage);
    const actionable =
      ['list', 'table', 'code'].includes(block.kind) ||
      matchesLanguageMarker(block.text, 'recommendation', language) ||
      /\b(compare|measure|configure|set|run|test|example|because|however|steps?)\b|сравн|измер|настрой|например|потому|однако|шаг/iu.test(
        block.text,
      );
    if (actionable) practical = Math.max(practical, coverage);
  }
  return { metadata, body, practical };
}
