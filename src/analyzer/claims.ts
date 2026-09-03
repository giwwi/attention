import type { ClaimImportance, ClaimType } from '../shared/types';
import {
  matchesLanguageMarker,
  resolveHeuristicLanguage,
  type HeuristicLanguageResolution,
} from './language-heuristics';
import { textTokens, tokenOverlap } from './text-match';
import { CLAIM_EXTRACTION_LIMITS } from './config';

export interface ExtractedClaim {
  claim: string;
  type: ClaimType;
  importance: ClaimImportance;
}

const factPattern = /\b(?:19|20)\d{2}\b|\b\d+(?:[.,]\d+)?\b/u;

function cleanSentence(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[-–—•*]+\s*/, '')
    .trim();
}

function claimType(
  sentence: string,
  language: HeuristicLanguageResolution,
): ClaimType {
  if (matchesLanguageMarker(sentence, 'recommendation', language))
    return 'recommendation';
  if (matchesLanguageMarker(sentence, 'forecast', language)) return 'forecast';
  if (matchesLanguageMarker(sentence, 'evidence', language)) return 'evidence';
  if (matchesLanguageMarker(sentence, 'reasoning', language))
    return 'mechanism';
  if (factPattern.test(sentence)) return 'fact';
  return 'thesis';
}

function sentenceScore(
  sentence: string,
  index: number,
  titleTokens: Set<string>,
  language: HeuristicLanguageResolution,
): number {
  const tokens = textTokens(sentence);
  const titleOverlap = tokenOverlap(titleTokens, tokens);
  let score = Math.max(0, 4 - index / 10) + titleOverlap * 2.5;
  if (matchesLanguageMarker(sentence, 'evidence', language)) score += 2.2;
  if (matchesLanguageMarker(sentence, 'reasoning', language)) score += 1.8;
  if (
    matchesLanguageMarker(sentence, 'recommendation', language) ||
    matchesLanguageMarker(sentence, 'forecast', language)
  ) {
    score += 1.4;
  }
  if (sentence.length >= 90 && sentence.length <= 260) score += 1;
  return score;
}

function sentenceCandidates(
  content: string,
  language: HeuristicLanguageResolution,
): string[] {
  return content
    .split(/\n+/u)
    .flatMap((paragraph) => paragraph.split(/(?<=[.!?。！？])\s+/u))
    .map(cleanSentence)
    .filter((sentence) => {
      const wordCount = sentence.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
      return (
        sentence.length >= CLAIM_EXTRACTION_LIMITS.minimumClaimCharacters &&
        sentence.length <= CLAIM_EXTRACTION_LIMITS.maximumClaimCharacters &&
        wordCount >= 8 &&
        wordCount <= 75 &&
        !matchesLanguageMarker(sentence, 'navigation', language)
      );
    });
}

function sentenceSimilarity(left: string, right: string): number {
  const leftTokens = textTokens(left);
  const rightTokens = textTokens(right);
  const overlap = tokenOverlap(leftTokens, rightTokens);
  const union = Math.max(1, leftTokens.size + rightTokens.size - overlap);
  return overlap / union;
}

export function extractKeyClaims(
  content: string,
  title: string,
  language: string | null = null,
): ExtractedClaim[] {
  const languageResolution = resolveHeuristicLanguage(language, content);
  const titleTokens = textTokens(title);
  const ranked = sentenceCandidates(content, languageResolution)
    .map((sentence, index) => ({
      sentence,
      index,
      score: sentenceScore(sentence, index, titleTokens, languageResolution),
    }))
    .sort(
      (left, right) => right.score - left.score || left.index - right.index,
    );

  const selected: typeof ranked = [];
  for (const candidate of ranked) {
    if (
      selected.some(
        (item) => sentenceSimilarity(candidate.sentence, item.sentence) >= 0.72,
      )
    ) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= CLAIM_EXTRACTION_LIMITS.claims) break;
  }

  return selected.map((item, index) => ({
    claim: item.sentence,
    type: claimType(item.sentence, languageResolution),
    importance: index < 3 ? 'primary' : 'supporting',
  }));
}
