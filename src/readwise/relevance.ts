import { textTokens, tokenOverlap } from '../analyzer/text-match';
import {
  buildMaterialFeatures,
  type MaterialFeatures,
} from '../analyzer/material-features';
import type {
  KeyClaimAssessment,
  PageCapture,
  RelevantReadwiseEvidence,
  RelevantReadwiseHighlight,
} from '../shared/types';
import type { ReadwiseEvidence, ReadwiseHighlightEvidence } from './evidence';
import { searchLocalIndex } from '../evidence/local-search-index';
import {
  applyUnifiedLocalEvidenceToClaim,
  localMaterialKey,
  mergeUnifiedLocalEvidence,
} from '../evidence/unified-evidence';

function relationScore(left: string, rightTokens: Set<string>): number {
  const leftTokens = textTokens(left);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const overlap = tokenOverlap(leftTokens, rightTokens);
  if (overlap < 2) return 0;
  const smaller = Math.max(1, Math.min(leftTokens.size, rightTokens.size));
  const union = Math.max(1, leftTokens.size + rightTokens.size - overlap);
  return Math.min(1, (overlap / smaller) * 0.72 + (overlap / union) * 0.28);
}

function relevantHighlight(
  highlight: ReadwiseHighlightEvidence,
  relation: number,
  sourceUrlFingerprint: string | null,
  exactSource: boolean,
): RelevantReadwiseHighlight {
  return {
    id: highlight.id,
    sourceId: highlight.sourceId,
    sourceTitle: highlight.sourceTitle,
    excerpt: highlight.text,
    notePresent: Boolean(highlight.note),
    tags: highlight.tags,
    attentionStrength: highlight.attentionStrength,
    matchScore: Number(relation.toFixed(2)),
    materialKey: localMaterialKey({
      source: 'readwise',
      documentId: highlight.sourceId,
      title: highlight.sourceTitle,
      kind: highlight.note ? 'annotated-highlight' : 'highlight',
      urlFingerprint: sourceUrlFingerprint,
    }),
    exactSource,
  };
}

export async function selectRelevantReadwiseEvidence(
  evidence: ReadwiseEvidence | null,
  material: PageCapture,
  suppliedFeatures?: MaterialFeatures,
): Promise<RelevantReadwiseEvidence | null> {
  if (!evidence) return null;
  const features = suppliedFeatures ?? (await buildMaterialFeatures(material));
  const fingerprint = features.urlFingerprint;
  const exactSources = fingerprint
    ? evidence.sources.filter((source) => source.urlFingerprint === fingerprint)
    : [];
  const exactSourceIds = new Set(exactSources.map((source) => source.id));
  const sourceById = new Map(
    evidence.sources.map((source) => [source.id, source]),
  );
  const targetTokens = features.matchingTokens;
  const candidateIds = searchLocalIndex(evidence.searchIndex, targetTokens);
  const matches = evidence.highlights
    .filter(
      (highlight) =>
        candidateIds.has(highlight.id) ||
        exactSourceIds.has(highlight.sourceId),
    )
    .map((highlight) => {
      const relation = relationScore(highlight.text, targetTokens);
      const exactSource = exactSourceIds.has(highlight.sourceId);
      return {
        highlight,
        relation: exactSource ? Math.max(0.7, relation) : relation,
        exactSource,
      };
    })
    .filter((item) => item.exactSource || item.relation >= 0.2)
    .sort(
      (left, right) =>
        Number(right.exactSource) - Number(left.exactSource) ||
        right.relation * right.highlight.attentionStrength -
          left.relation * left.highlight.attentionStrength,
    )
    .slice(0, 8);
  const matchingSources = new Set(
    matches.map((item) => item.highlight.sourceId),
  );
  for (const source of exactSources) matchingSources.add(source.id);
  if (matches.length === 0 && exactSources.length === 0) return null;
  const strongest = matches.reduce(
    (maximum, item) =>
      Math.max(maximum, item.relation * item.highlight.attentionStrength),
    0,
  );
  return {
    exactSourceMatched: exactSources.length > 0,
    matchingSourceCount: matchingSources.size,
    matchingHighlightCount: matches.length,
    familiarityConfidence: Math.min(
      0.86,
      Math.max(exactSources.length ? 0.48 : 0, strongest),
    ),
    matchingHighlights: matches.map((item) =>
      relevantHighlight(
        item.highlight,
        item.relation,
        sourceById.get(item.highlight.sourceId)?.urlFingerprint ?? null,
        item.exactSource,
      ),
    ),
    exactSources: exactSources.map((source) => ({
      id: source.id,
      title: source.title,
      materialKey: localMaterialKey({
        source: 'readwise',
        documentId: source.id,
        title: source.title,
        kind: 'saved-source',
        urlFingerprint: source.urlFingerprint,
      }),
    })),
    evidenceUpdatedAt: evidence.generatedAt,
  };
}

/**
 * Readwise is stronger evidence of familiarity than a browser visit, but a
 * saved highlight is still not proof that the user understands or remembers a
 * claim. Notes make the prior stronger without turning it into confirmed
 * knowledge.
 */
export function applyReadwiseEvidenceToClaim(
  claim: KeyClaimAssessment,
  evidence: RelevantReadwiseEvidence | undefined,
): KeyClaimAssessment {
  return applyUnifiedLocalEvidenceToClaim(
    claim,
    mergeUnifiedLocalEvidence({ readwise: evidence }) ?? undefined,
  );
}
