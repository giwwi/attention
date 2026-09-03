import { classifyClaimNovelty } from '../analyzer/evaluation';
import { stableTextFingerprint } from '../analyzer/material-features';
import { textTokens, tokenOverlap } from '../analyzer/text-match';
import type {
  KeyClaimAssessment,
  LocalEvidenceKind,
  LocalEvidenceSource,
  RelevantNotionEvidence,
  RelevantObsidianEvidence,
  RelevantReadwiseEvidence,
  UnifiedLocalEvidence,
  UnifiedLocalEvidenceItem,
} from '../shared/types';

interface EvidenceWeightRule {
  knownBase: number;
  knownMultiplier: number;
  knownCap: number;
  confidenceBase: number;
  confidenceMultiplier: number;
  confidenceCap: number;
}

/** One source of truth for how local connector evidence changes novelty. */
export const LOCAL_EVIDENCE_WEIGHT_RULES: Readonly<
  Record<LocalEvidenceKind, EvidenceWeightRule>
> = {
  'own-note': {
    knownBase: 0.5,
    knownMultiplier: 0.46,
    knownCap: 0.92,
    confidenceBase: 0.5,
    confidenceMultiplier: 0.36,
    confidenceCap: 0.88,
  },
  'annotated-highlight': {
    knownBase: 0.5,
    knownMultiplier: 0.4,
    knownCap: 0.88,
    confidenceBase: 0.48,
    confidenceMultiplier: 0.34,
    confidenceCap: 0.84,
  },
  highlight: {
    knownBase: 0.5,
    knownMultiplier: 0.32,
    knownCap: 0.86,
    confidenceBase: 0.48,
    confidenceMultiplier: 0.3,
    confidenceCap: 0.82,
  },
  imported: {
    knownBase: 0.5,
    knownMultiplier: 0.46,
    knownCap: 0.78,
    confidenceBase: 0.5,
    confidenceMultiplier: 0.36,
    confidenceCap: 0.74,
  },
  quote: {
    knownBase: 0.5,
    knownMultiplier: 0.44,
    knownCap: 0.74,
    confidenceBase: 0.48,
    confidenceMultiplier: 0.34,
    confidenceCap: 0.7,
  },
  'saved-source': {
    knownBase: 0.42,
    knownMultiplier: 0.16,
    knownCap: 0.58,
    confidenceBase: 0.4,
    confidenceMultiplier: 0.12,
    confidenceCap: 0.5,
  },
};

function normalizedTitle(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function localMaterialKey(input: {
  source: LocalEvidenceSource;
  documentId: string;
  title: string;
  kind: LocalEvidenceKind;
  urlFingerprint?: string | null;
}): string {
  if (input.urlFingerprint) return `url:${input.urlFingerprint}`;
  const title = normalizedTitle(input.title);
  if (input.kind !== 'own-note' && title.length >= 12) {
    return `title:${stableTextFingerprint(title)}`;
  }
  return `${input.source}:${input.documentId}`;
}

function itemIdentity(item: UnifiedLocalEvidenceItem): string {
  const excerpt = item.excerpt.toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
  return `${item.materialKey}:${stableTextFingerprint(excerpt)}`;
}

function deduplicateItems(
  items: UnifiedLocalEvidenceItem[],
): UnifiedLocalEvidenceItem[] {
  const deduplicated = new Map<string, UnifiedLocalEvidenceItem>();
  for (const item of items) {
    const key = itemIdentity(item);
    const existing = deduplicated.get(key);
    if (!existing) {
      deduplicated.set(key, item);
      continue;
    }
    const stronger =
      item.matchScore * item.attentionStrength >
      existing.matchScore * existing.attentionStrength
        ? item
        : existing;
    deduplicated.set(key, {
      ...stronger,
      sources: [...new Set([...existing.sources, ...item.sources])],
      exactSource: existing.exactSource || item.exactSource,
    });
  }
  return [...deduplicated.values()];
}

function readwiseItems(
  evidence: RelevantReadwiseEvidence | undefined,
): UnifiedLocalEvidenceItem[] {
  if (!evidence) return [];
  const items = evidence.matchingHighlights.map(
    (highlight): UnifiedLocalEvidenceItem => ({
      id: `readwise:${highlight.id}`,
      source: 'readwise',
      sources: ['readwise'],
      documentId: highlight.sourceId ?? highlight.sourceTitle,
      materialKey:
        highlight.materialKey ??
        localMaterialKey({
          source: 'readwise',
          documentId: highlight.sourceId ?? highlight.sourceTitle,
          title: highlight.sourceTitle,
          kind: highlight.notePresent ? 'annotated-highlight' : 'highlight',
        }),
      title: highlight.sourceTitle,
      heading: null,
      excerpt: highlight.excerpt,
      kind: highlight.notePresent ? 'annotated-highlight' : 'highlight',
      attentionStrength: highlight.attentionStrength,
      matchScore: highlight.matchScore,
      exactSource: highlight.exactSource ?? evidence.exactSourceMatched,
      updatedAt: evidence.evidenceUpdatedAt,
    }),
  );
  if (evidence.exactSourceMatched && items.length === 0) {
    for (const source of evidence.exactSources ?? []) {
      items.push({
        id: `readwise-source:${source.id}`,
        source: 'readwise',
        sources: ['readwise'],
        documentId: source.id,
        materialKey: source.materialKey,
        title: source.title,
        heading: null,
        excerpt: source.title,
        kind: 'saved-source',
        attentionStrength: 0.48,
        matchScore: 0.7,
        exactSource: true,
        updatedAt: evidence.evidenceUpdatedAt,
      });
    }
  }
  return items;
}

function obsidianItems(
  evidence: RelevantObsidianEvidence | undefined,
): UnifiedLocalEvidenceItem[] {
  return (evidence?.matchingFragments ?? []).map(
    (fragment): UnifiedLocalEvidenceItem => ({
      id: `obsidian:${fragment.id}`,
      source: 'obsidian',
      sources: ['obsidian'],
      documentId: fragment.notePath ?? fragment.noteTitle,
      materialKey:
        fragment.materialKey ??
        localMaterialKey({
          source: 'obsidian',
          documentId: fragment.notePath ?? fragment.noteTitle,
          title: fragment.noteTitle,
          kind: fragment.kind,
        }),
      title: fragment.noteTitle,
      heading: fragment.heading,
      excerpt: fragment.excerpt,
      kind: fragment.kind,
      attentionStrength: fragment.attentionStrength,
      matchScore: fragment.matchScore,
      exactSource: fragment.exactSource ?? false,
      updatedAt: evidence?.evidenceUpdatedAt ?? new Date(0).toISOString(),
    }),
  );
}

function notionItems(
  evidence: RelevantNotionEvidence | undefined,
): UnifiedLocalEvidenceItem[] {
  const items = (evidence?.matchingFragments ?? []).map(
    (fragment): UnifiedLocalEvidenceItem => ({
      id: `notion:${fragment.id}`,
      source: 'notion',
      sources: ['notion'],
      documentId: fragment.pageId ?? fragment.pageTitle,
      materialKey:
        fragment.materialKey ??
        localMaterialKey({
          source: 'notion',
          documentId: fragment.pageId ?? fragment.pageTitle,
          title: fragment.pageTitle,
          kind: fragment.kind,
        }),
      title: fragment.pageTitle,
      heading: fragment.heading,
      excerpt: fragment.excerpt,
      kind: fragment.kind,
      attentionStrength: fragment.attentionStrength,
      matchScore: fragment.matchScore,
      exactSource:
        fragment.exactSource ?? evidence?.exactSourceMatched ?? false,
      updatedAt: evidence?.evidenceUpdatedAt ?? new Date(0).toISOString(),
    }),
  );
  if (evidence?.exactSourceMatched && items.length === 0) {
    for (const page of evidence.exactPages ?? []) {
      items.push({
        id: `notion-page:${page.id}`,
        source: 'notion',
        sources: ['notion'],
        documentId: page.id,
        materialKey: page.materialKey,
        title: page.title,
        heading: null,
        excerpt: page.title,
        kind: 'saved-source',
        attentionStrength: 0.48,
        matchScore: 0.68,
        exactSource: true,
        updatedAt: evidence.evidenceUpdatedAt,
      });
    }
  }
  return items;
}

export function mergeUnifiedLocalEvidence(input: {
  readwise?: RelevantReadwiseEvidence;
  obsidian?: RelevantObsidianEvidence;
  notion?: RelevantNotionEvidence;
}): UnifiedLocalEvidence | null {
  const items = deduplicateItems([
    ...readwiseItems(input.readwise),
    ...obsidianItems(input.obsidian),
    ...notionItems(input.notion),
  ]).sort(
    (left, right) =>
      right.matchScore * right.attentionStrength -
      left.matchScore * left.attentionStrength,
  );
  if (items.length === 0) return null;
  return {
    items: items.slice(0, 18),
    materialCount: new Set(items.map((item) => item.materialKey)).size,
    evidenceUpdatedAt: items
      .map((item) => item.updatedAt)
      .sort()
      .at(-1) as string,
  };
}

function relationScore(left: string, right: string): number {
  const leftTokens = textTokens(left);
  const rightTokens = textTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const overlap = tokenOverlap(leftTokens, rightTokens);
  if (overlap < 2) return 0;
  const smaller = Math.max(1, Math.min(leftTokens.size, rightTokens.size));
  const union = Math.max(1, leftTokens.size + rightTokens.size - overlap);
  return Math.min(1, (overlap / smaller) * 0.78 + (overlap / union) * 0.22);
}

function evidenceReason(item: UnifiedLocalEvidenceItem): string {
  const sourceNames = item.sources
    .map((source) =>
      source === 'readwise'
        ? 'Readwise'
        : source === 'obsidian'
          ? 'Obsidian'
          : 'Notion',
    )
    .join(' и ');
  if (item.kind === 'own-note') {
    if (item.sources.length === 1 && item.sources[0] === 'notion') {
      return `Похожая мысль сформулирована в вашей заметке Notion «${item.title}».`;
    }
    return `Похожая мысль сформулирована в вашей заметке «${item.title}» (${sourceNames}).`;
  }
  if (item.kind === 'annotated-highlight') {
    return `Похожая идея ранее была выделена и прокомментирована в ${sourceNames}: «${item.title}».`;
  }
  if (item.kind === 'highlight') {
    return `Похожая идея ранее была выделена в ${sourceNames}: «${item.title}».`;
  }
  if (item.kind === 'quote') {
    return `Похожая мысль есть в сохранённой цитате «${item.title}» (${sourceNames}).`;
  }
  if (item.kind === 'imported') {
    if (item.sources.length === 1 && item.sources[0] === 'obsidian') {
      return `Похожая мысль есть в импортированной заметке «${item.title}».`;
    }
    if (item.sources.length === 1 && item.sources[0] === 'notion') {
      return `Похожая мысль есть в сохранённом материале Notion «${item.title}».`;
    }
    return `Похожая мысль есть в сохранённом материале «${item.title}» (${sourceNames}).`;
  }
  return `Этот материал уже сохранён в ${sourceNames}, но сохранение само по себе не подтверждает знание тезиса.`;
}

/**
 * Applies connector evidence once. Duplicate copies of one material across
 * Readwise, Obsidian and Notion are grouped before selecting the strongest
 * match, so they never multiply the familiarity prior.
 */
export function applyUnifiedLocalEvidenceToClaim(
  claim: KeyClaimAssessment,
  evidence: UnifiedLocalEvidence | undefined,
): KeyClaimAssessment {
  if (!evidence) return claim;
  const bestByMaterial = new Map<
    string,
    { item: UnifiedLocalEvidenceItem; relation: number }
  >();
  for (const item of evidence.items) {
    const relation = relationScore(
      claim.sourceExcerpt ?? claim.claim,
      item.excerpt,
    );
    if (relation < (item.kind === 'saved-source' ? 0.12 : 0.18)) continue;
    const existing = bestByMaterial.get(item.materialKey);
    if (
      !existing ||
      relation * item.attentionStrength >
        existing.relation * existing.item.attentionStrength
    ) {
      bestByMaterial.set(item.materialKey, { item, relation });
    }
  }
  const strongest = [...bestByMaterial.values()].sort(
    (left, right) =>
      right.relation * right.item.attentionStrength -
      left.relation * left.item.attentionStrength,
  )[0];
  if (!strongest) return claim;

  const rule = LOCAL_EVIDENCE_WEIGHT_RULES[strongest.item.kind];
  const evidenceStrength =
    strongest.relation * strongest.item.attentionStrength;
  const candidateKnown = Math.min(
    rule.knownCap,
    rule.knownBase + evidenceStrength * rule.knownMultiplier,
  );
  if (candidateKnown <= claim.knownProbability + 0.04) return claim;
  const confidence = Math.max(
    claim.confidence,
    Math.min(
      rule.confidenceCap,
      rule.confidenceBase + evidenceStrength * rule.confidenceMultiplier,
    ),
  );
  return {
    ...claim,
    knownProbability: Number(candidateKnown.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    novelty: classifyClaimNovelty(candidateKnown, confidence),
    reason: evidenceReason(strongest.item),
  };
}
