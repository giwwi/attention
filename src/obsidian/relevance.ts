import { textTokens, tokenOverlap } from '../analyzer/text-match';
import type {
  KeyClaimAssessment,
  PageCapture,
  RelevantObsidianEvidence,
  RelevantObsidianFragment,
} from '../shared/types';
import type { ObsidianFragment, ObsidianIndex } from './types';
import type { MaterialFeatures } from '../analyzer/material-features';
import {
  buildLocalSearchIndex,
  searchLocalIndex,
} from '../evidence/local-search-index';
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
  return Math.min(1, (overlap / smaller) * 0.76 + (overlap / union) * 0.24);
}

function recencyWeight(modifiedAt: number, now: number): number {
  const ageYears = Math.max(0, now - modifiedAt) / (365.25 * 86_400_000);
  return Math.max(0.72, Math.exp(-ageYears / 10));
}

function relevantFragment(
  fragment: ObsidianFragment,
  matchScore: number,
  now: number,
  sourceUrlFingerprint: string | null,
  exactSource: boolean,
): RelevantObsidianFragment {
  return {
    id: fragment.id,
    notePath: fragment.notePath,
    noteTitle: fragment.noteTitle,
    heading: fragment.heading,
    excerpt: fragment.text,
    kind: fragment.kind,
    attentionStrength: Number(
      (
        fragment.attentionStrength * recencyWeight(fragment.modifiedAt, now)
      ).toFixed(2),
    ),
    matchScore: Number(matchScore.toFixed(2)),
    materialKey: localMaterialKey({
      source: 'obsidian',
      documentId: fragment.notePath,
      title: fragment.noteTitle,
      kind: fragment.kind,
      urlFingerprint: sourceUrlFingerprint,
    }),
    exactSource,
  };
}

export function selectRelevantObsidianEvidence(
  index: ObsidianIndex | null,
  material: PageCapture,
  now = Date.now(),
  features?: MaterialFeatures,
): RelevantObsidianEvidence | null {
  if (!index) return null;
  const targetTokens =
    features?.matchingTokens ??
    textTokens(
      [
        material.title,
        material.excerpt,
        ...material.headings,
        material.content.slice(0, 14_000),
      ].join(' '),
    );
  const searchIndex =
    index.searchIndex ??
    buildLocalSearchIndex(
      index.notes.flatMap((note) =>
        note.fragments.map((fragment) => ({
          id: fragment.id,
          text: [
            note.title,
            fragment.heading ?? '',
            fragment.text,
            ...fragment.tags,
            ...fragment.links,
          ].join(' '),
        })),
      ),
      index.generatedAt,
    );
  const candidateIds = searchLocalIndex(searchIndex, targetTokens);
  const currentFingerprint = features?.urlFingerprint ?? null;
  const noteByPath = new Map(index.notes.map((note) => [note.path, note]));
  const exactNotePaths = new Set(
    currentFingerprint
      ? index.notes
          .filter((note) => note.sourceUrlFingerprint === currentFingerprint)
          .map((note) => note.path)
      : [],
  );
  const matches = index.notes
    .flatMap((note) => note.fragments)
    .filter(
      (fragment) =>
        candidateIds.has(fragment.id) || exactNotePaths.has(fragment.notePath),
    )
    .map((fragment) => {
      const relation = relationScore(fragment.text, targetTokens);
      const exactSource = exactNotePaths.has(fragment.notePath);
      return {
        fragment,
        relation: exactSource ? Math.max(0.68, relation) : relation,
        exactSource,
      };
    })
    .filter((item) => item.exactSource || item.relation >= 0.18)
    .sort(
      (left, right) =>
        right.relation * right.fragment.attentionStrength -
        left.relation * left.fragment.attentionStrength,
    )
    .slice(0, 8)
    .map((item) =>
      relevantFragment(
        item.fragment,
        item.relation,
        now,
        noteByPath.get(item.fragment.notePath)?.sourceUrlFingerprint ?? null,
        item.exactSource,
      ),
    );
  if (matches.length === 0) return null;
  const noteCount = new Set(matches.map((fragment) => fragment.noteTitle)).size;
  const strongest = matches.reduce(
    (maximum, fragment) =>
      Math.max(maximum, fragment.matchScore * fragment.attentionStrength),
    0,
  );
  return {
    matchingNoteCount: noteCount,
    matchingFragmentCount: matches.length,
    familiarityConfidence: Math.min(0.92, strongest),
    matchingFragments: matches,
    evidenceUpdatedAt: index.generatedAt,
  };
}

/**
 * Own writing is strong evidence of familiarity, but imported notes and quotes
 * are deliberately capped lower. No Vault text leaves the extension.
 */
export function applyObsidianEvidenceToClaim(
  claim: KeyClaimAssessment,
  evidence: RelevantObsidianEvidence | undefined,
): KeyClaimAssessment {
  return applyUnifiedLocalEvidenceToClaim(
    claim,
    mergeUnifiedLocalEvidence({ obsidian: evidence }) ?? undefined,
  );
}
