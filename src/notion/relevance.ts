import { textTokens, tokenOverlap } from '../analyzer/text-match';
import {
  buildMaterialFeatures,
  type MaterialFeatures,
} from '../analyzer/material-features';
import type {
  KeyClaimAssessment,
  PageCapture,
  RelevantNotionEvidence,
  RelevantNotionFragment,
} from '../shared/types';
import type { NotionFragment, NotionIndex } from './types';
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

function relevantFragment(
  fragment: NotionFragment,
  matchScore: number,
  sourceUrlFingerprint: string | null,
  exactSource: boolean,
): RelevantNotionFragment {
  return {
    id: fragment.id,
    pageId: fragment.pageId,
    pageTitle: fragment.pageTitle,
    heading: fragment.heading,
    excerpt: fragment.text,
    kind: fragment.kind,
    attentionStrength: fragment.attentionStrength,
    matchScore: Number(matchScore.toFixed(2)),
    materialKey: localMaterialKey({
      source: 'notion',
      documentId: fragment.pageId,
      title: fragment.pageTitle,
      kind: fragment.kind,
      urlFingerprint: sourceUrlFingerprint,
    }),
    exactSource,
  };
}

export async function selectRelevantNotionEvidence(
  index: NotionIndex | null,
  material: PageCapture,
  suppliedFeatures?: MaterialFeatures,
): Promise<RelevantNotionEvidence | null> {
  if (!index) return null;
  const features = suppliedFeatures ?? (await buildMaterialFeatures(material));
  const fingerprint = features.urlFingerprint;
  const exactPages = fingerprint
    ? index.pages.filter((page) => page.sourceUrlFingerprint === fingerprint)
    : [];
  const exactIds = new Set(exactPages.map((page) => page.id));
  const pageById = new Map(index.pages.map((page) => [page.id, page]));
  const targetTokens = features.matchingTokens;
  const searchIndex =
    index.searchIndex ??
    buildLocalSearchIndex(
      index.pages.flatMap((page) =>
        page.fragments.map((fragment) => ({
          id: fragment.id,
          text: [page.title, fragment.heading ?? '', fragment.text].join(' '),
        })),
      ),
      index.generatedAt,
    );
  const candidateIds = searchLocalIndex(searchIndex, targetTokens);
  const matches = index.pages
    .flatMap((page) => page.fragments)
    .filter(
      (fragment) =>
        candidateIds.has(fragment.id) || exactIds.has(fragment.pageId),
    )
    .map((fragment) => {
      const relation = relationScore(fragment.text, targetTokens);
      const exactSource = exactIds.has(fragment.pageId);
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
        pageById.get(item.fragment.pageId)?.sourceUrlFingerprint ?? null,
        item.exactSource,
      ),
    );
  if (matches.length === 0 && exactPages.length === 0) return null;
  const strongest = matches.reduce(
    (maximum, fragment) =>
      Math.max(maximum, fragment.matchScore * fragment.attentionStrength),
    0,
  );
  return {
    exactSourceMatched: exactPages.length > 0,
    matchingPageCount: new Set(matches.map((fragment) => fragment.pageTitle))
      .size,
    matchingFragmentCount: matches.length,
    familiarityConfidence: Math.min(
      0.92,
      Math.max(exactPages.length ? 0.48 : 0, strongest),
    ),
    matchingFragments: matches,
    exactPages: exactPages.map((page) => ({
      id: page.id,
      title: page.title,
      materialKey: localMaterialKey({
        source: 'notion',
        documentId: page.id,
        title: page.title,
        kind: 'saved-source',
        urlFingerprint: page.sourceUrlFingerprint,
      }),
    })),
    evidenceUpdatedAt: index.generatedAt,
  };
}

export function applyNotionEvidenceToClaim(
  claim: KeyClaimAssessment,
  evidence: RelevantNotionEvidence | undefined,
): KeyClaimAssessment {
  return applyUnifiedLocalEvidenceToClaim(
    claim,
    mergeUnifiedLocalEvidence({ notion: evidence }) ?? undefined,
  );
}
