import { classifyClaimNovelty } from '../analyzer/evaluation';
import type { MaterialFeatures } from '../analyzer/material-features';
import { textTokens, tokenOverlap } from '../analyzer/text-match';
import type {
  KeyClaimAssessment,
  RelevantClaimMemoryEvidence,
  RelevantClaimMemoryMatch,
} from '../shared/types';
import {
  canonicalNovelPassageUrl,
  type NovelPassageFeedbackRecord,
} from './feedback';

function normalized(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

function relationScore(left: string, right: string): number {
  if (normalized(left) === normalized(right)) return 1;
  const leftTokens = textTokens(left);
  const rightTokens = textTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const overlap = tokenOverlap(leftTokens, rightTokens);
  if (overlap < 2) return 0;
  const smaller = Math.max(1, Math.min(leftTokens.size, rightTokens.size));
  const union = Math.max(1, leftTokens.size + rightTokens.size - overlap);
  return Math.min(1, (overlap / smaller) * 0.82 + (overlap / union) * 0.18);
}

function articleRelation(
  record: NovelPassageFeedbackRecord,
  features: MaterialFeatures,
): number {
  const recordTokens = textTokens(`${record.claim} ${record.excerpt}`);
  if (recordTokens.size === 0 || features.matchingTokens.size === 0) return 0;
  const overlap = tokenOverlap(recordTokens, features.matchingTokens);
  if (overlap < 2) return 0;
  return Math.min(1, overlap / Math.max(1, recordTokens.size));
}

/** Selects only local user feedback plausibly related to the current article. */
export function selectRelevantClaimMemoryEvidence(
  records: NovelPassageFeedbackRecord[],
  features: MaterialFeatures,
): RelevantClaimMemoryEvidence | null {
  if (records.length === 0) return null;
  const currentUrl = features.canonicalPage?.canonicalUrl ?? null;
  const matches: RelevantClaimMemoryMatch[] = records
    .map((record) => {
      const exactPage =
        currentUrl !== null &&
        canonicalNovelPassageUrl(record.url) ===
          canonicalNovelPassageUrl(currentUrl);
      const matchScore = exactPage
        ? Math.max(0.72, articleRelation(record, features))
        : articleRelation(record, features);
      return {
        id: record.id,
        url: record.url,
        claim: record.claim,
        excerpt: record.excerpt,
        value: record.value,
        matchScore: Number(matchScore.toFixed(2)),
        exactPage,
        createdAt: record.createdAt,
      } satisfies RelevantClaimMemoryMatch;
    })
    .filter((record) => record.exactPage || record.matchScore >= 0.24)
    .sort(
      (left, right) =>
        Number(right.exactPage) - Number(left.exactPage) ||
        right.matchScore - left.matchScore ||
        right.createdAt.localeCompare(left.createdAt),
    )
    .slice(0, 12);
  if (matches.length === 0) return null;
  return {
    matches,
    evidenceUpdatedAt: records
      .map((record) => record.createdAt)
      .sort()
      .at(-1) as string,
  };
}

/**
 * Direct user feedback outranks inferred sources. "Already knew" is strong
 * knowledge evidence. "New" becomes encounter memory after the user saw it,
 * but is capped lower because exposure does not prove long-term retention.
 */
export function applyClaimMemoryToClaim(
  claim: KeyClaimAssessment,
  evidence: RelevantClaimMemoryEvidence | undefined,
): KeyClaimAssessment {
  if (!evidence) return claim;
  const strongest = evidence.matches
    .map((match) => ({
      match,
      relation: Math.max(
        relationScore(claim.claim, match.claim),
        relationScore(claim.sourceExcerpt ?? claim.claim, match.excerpt),
      ),
    }))
    .filter((item) => item.relation >= 0.3)
    .sort(
      (left, right) =>
        right.relation * (right.match.value === 'known' ? 1 : 0.82) -
          left.relation * (left.match.value === 'known' ? 1 : 0.82) ||
        right.match.createdAt.localeCompare(left.match.createdAt),
    )[0];
  if (!strongest) return claim;

  const directKnown = strongest.match.value === 'known';
  const candidateKnown = directKnown
    ? Math.min(0.98, 0.76 + strongest.relation * 0.22)
    : Math.min(0.82, 0.56 + strongest.relation * 0.26);
  if (candidateKnown <= claim.knownProbability + 0.02) return claim;

  const confidence = Math.max(
    claim.confidence,
    directKnown
      ? Math.min(0.96, 0.76 + strongest.relation * 0.2)
      : Math.min(0.82, 0.62 + strongest.relation * 0.2),
  );
  return {
    ...claim,
    knownProbability: Number(candidateKnown.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    novelty: classifyClaimNovelty(candidateKnown, confidence),
    reason: directKnown
      ? 'Вы раньше прямо отметили похожий тезис как уже известный.'
      : 'Вы раньше отметили похожий тезис как новый; после этого он уже встречался вам.',
  };
}
