import { conceptTokens } from './concept-aliases';

const STOP_WORDS = new Set([
  'and',
  'an',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'this',
  'with',
  'как',
  'для',
  'или',
  'что',
  'это',
  'этого',
  'мне',
  'про',
  'при',
  'уже',
]);

const SHORT_MEANINGFUL_TOKENS = new Set([
  'ai',
  'ml',
  'ui',
  'ux',
  'vr',
  'no',
  'не',
  'ни',
  'g',
  'kg',
  'mg',
  'm',
  'cm',
  'mm',
  'km',
  's',
  'ms',
  'h',
  'г',
  'кг',
  'мг',
  'м',
  'см',
  'мм',
  'км',
]);

function normalizeToken(word: string): string {
  if (!/[а-яё]/u.test(word) || word.length < 6) return word;
  return word.replace(
    /(иями|ями|ами|его|ого|ему|ому|иях|ах|ях|ия|ие|ий|ый|ая|яя|ое|ее|ов|ев|ам|ям|ом|ем|ы|и|а|я|у|ю|е|о)$/u,
    '',
  );
}

export function textTokens(value: string): Set<string> {
  // Preserve quantities before splitting words: 1, 10, 1.5, -5 and 5% must
  // not collapse to the same bag of words. Claim matching additionally checks
  // their ordered values, units and polarity before treating overlap as known.
  const words =
    value
      .normalize('NFKC')
      .match(/[+−-]?\p{N}+(?:[.,]\p{N}+)*|[\p{L}\p{N}]+|[%‰$€£¥₹₽<>≤≥]/gu) ??
    [];
  const tokens = new Set(
    words
      .filter(
        (word) =>
          word.length >= 3 ||
          /\p{N}|[%‰$€£¥₹₽<>≤≥]/u.test(word) ||
          SHORT_MEANINGFUL_TOKENS.has(word.toLocaleLowerCase()) ||
          (word.toLocaleUpperCase() === word &&
            word.toLocaleLowerCase() !== word),
      )
      .map((word) => word.toLocaleLowerCase())
      .filter((word) => !STOP_WORDS.has(word))
      .map(normalizeToken)
      .filter(Boolean),
  );
  if (tokens.has('artificial') && tokens.has('intelligence')) tokens.add('ai');
  if (tokens.has('machine') && tokens.has('learning')) tokens.add('ml');
  if (
    tokens.has('llm') ||
    tokens.has('llms') ||
    (tokens.has('language') && tokens.has('model')) ||
    (tokens.has('language') && tokens.has('models'))
  ) {
    tokens.add('ai');
  }
  for (const concept of conceptTokens(value, tokens)) tokens.add(concept);
  return tokens;
}

export function tokenOverlap(left: Set<string>, right: Set<string>): number {
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap;
}

export function textMatchScore(query: string, target: string): number {
  const queryTokens = textTokens(query);
  if (queryTokens.size === 0) return 0;
  const targetTokens = textTokens(target);
  const queryLexicalTokens = new Set(
    [...queryTokens].filter((token) => !token.startsWith('concept:')),
  );
  const targetLexicalTokens = new Set(
    [...targetTokens].filter((token) => !token.startsWith('concept:')),
  );
  const lexicalOverlap = tokenOverlap(queryLexicalTokens, targetLexicalTokens);

  // Preserve the existing same-language score. Canonical concepts are a
  // fallback for cross-language matching, not a second vote for a word that
  // already matched lexically (for example, "AI" on both sides).
  if (lexicalOverlap > 0) {
    return Math.min(1, lexicalOverlap / Math.min(queryLexicalTokens.size, 3));
  }

  const queryConceptTokens = new Set(
    [...queryTokens].filter((token) => token.startsWith('concept:')),
  );
  if (queryConceptTokens.size === 0) return 0;
  const targetConceptTokens = new Set(
    [...targetTokens].filter((token) => token.startsWith('concept:')),
  );
  const conceptOverlap = tokenOverlap(queryConceptTokens, targetConceptTokens);
  return Math.min(1, conceptOverlap / Math.min(queryConceptTokens.size, 3));
}
