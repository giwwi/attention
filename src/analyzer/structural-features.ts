import type { PageCapture } from '../shared/types';
import type { ExtractedClaim } from './claims';

export interface StructuralFeatures {
  sourceLinkCount: number;
  numericalMarkerCount: number;
  quoteCount: number;
  paragraphCount: number;
  headingCount: number;
  listItemCount: number;
  tableCount: number;
  evidenceClaimCount: number;
  reasoningClaimCount: number;
  claimTypeCount: number;
}

function occurrences(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

export function analyzeStructuralFeatures(
  material: PageCapture,
  claims: ExtractedClaim[],
): StructuralFeatures {
  const structure = material.structure;
  const claimTypes = new Set(claims.map((claim) => claim.type));
  const inlineQuotes = occurrences(material.content, /[«“„][^»”“]{20,}[»”]/gu);
  const inlineReferences = occurrences(
    material.content,
    /\b(?:doi:\s*10\.\d{4,9}\/|https?:\/\/|arxiv:\s*\d{4}\.\d{4,5})/giu,
  );
  const citationLinks = structure?.citationLinkCount ?? 0;
  const ordinaryArticleLinks = Math.max(
    0,
    (structure?.linkCount ?? 0) - citationLinks,
  );
  return {
    sourceLinkCount: Math.max(
      inlineReferences,
      citationLinks + Math.min(6, ordinaryArticleLinks) * 0.35,
    ),
    numericalMarkerCount: occurrences(
      material.content,
      /\b(?:19|20)\d{2}\b|\b\d+(?:[.,]\d+)?\s*%|\b\d+(?:[.,]\d+)?\b/gu,
    ),
    quoteCount: Math.max(structure?.quoteCount ?? 0, inlineQuotes),
    paragraphCount: structure?.paragraphCount ?? 0,
    headingCount: structure?.headingCount ?? material.headings.length,
    listItemCount: structure?.listItemCount ?? 0,
    tableCount: structure?.tableCount ?? 0,
    evidenceClaimCount: claims.filter(
      (claim) => claim.type === 'evidence' || claim.type === 'fact',
    ).length,
    reasoningClaimCount: claims.filter(
      (claim) => claim.type === 'mechanism' || claim.type === 'thesis',
    ).length,
    claimTypeCount: claimTypes.size,
  };
}
