import { CONCEPT_ALIASES } from './concept-aliases';
import { textTokens } from './text-match';
import { GERMAN_GOAL_FILLERS, GERMAN_PRACTICAL_MARKERS } from './german-text';
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
      !GERMAN_GOAL_FILLERS.has(term) &&
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
  topic: number;
}

/** Shared with passage selection. A topic match is not proof of practical help. */
export function readingTermMatch(
  query: Set<string>,
  target: Set<string>,
): number {
  const matches = [...query].filter((term) => target.has(term));
  const lexical = matches.filter((term) => !term.startsWith('concept:'));
  const lexicalCount = [...query].filter(
    (term) => !term.startsWith('concept:'),
  ).length;
  const concepts = [...query].filter((term) => term.startsWith('concept:'));
  const conceptMatches = matches.length - lexical.length;
  const conceptCoverage = conceptMatches / Math.max(1, concepts.length);
  const coverage =
    lexical.length > 0 && lexical.length >= Math.min(2, lexicalCount)
      ? matches.length / query.size
      : conceptMatches >= 2 && conceptCoverage >= 0.5
        ? conceptCoverage * 0.6
        : 0;
  return coverage >= 0.25 ? coverage : 0;
}

/** Tokenize the article once even when the reading profile contains many goals. */
export function createGoalEvidenceAssessor(
  material: PageCapture,
): (goal: string) => GoalEvidence {
  const metadataTerms = goalTerms(
    [material.title, material.excerpt, ...material.headings].join(' '),
  );
  const language = resolveHeuristicLanguage(
    material.language,
    material.content,
  );
  const blocks = articleMap(material)
    .blocks.filter((block) => block.text.length >= 60)
    .map((block) => ({
      terms: goalTerms(block.text),
      actionable:
        ['list', 'table', 'code'].includes(block.kind) ||
        GERMAN_PRACTICAL_MARKERS.test(block.text) ||
        matchesLanguageMarker(block.text, 'recommendation', language) ||
        /\b(compare|measure|configure|set|run|test|example|because|however|steps?)\b|сравн|измер|настрой|например|потому|однако|шаг/iu.test(
          block.text,
        ),
    }));
  return (goal) => {
    const query = goalTerms(goal);
    const metadata = goalCoverage(query, metadataTerms);
    let body = 0;
    let practical = 0;
    let topic = 0;
    for (const block of blocks) {
      topic = Math.max(topic, readingTermMatch(query, block.terms));
      const matched = [...query].filter((term) => block.terms.has(term));
      // Topic aliases can find passages but cannot alone prove a multi-part task is addressed.
      const specific = matched.filter(
        (term) => !term.startsWith('concept:'),
      ).length;
      const coverage = goalCoverage(query, block.terms);
      const supported =
        matched.length >= Math.min(2, query.size) &&
        (specific > 0 || query.size === 1) &&
        coverage >= 0.25;
      if (!supported) continue;
      body = Math.max(body, coverage);
      if (block.actionable) practical = Math.max(practical, coverage);
    }
    return { metadata, body, practical, topic };
  };
}

export function assessGoalEvidence(
  material: PageCapture,
  goal: string,
): GoalEvidence {
  return createGoalEvidenceAssessor(material)(goal);
}
