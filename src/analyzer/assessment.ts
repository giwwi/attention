import type {
  KeyClaimAssessment,
  MaterialEvaluationInsights,
  PageCapture,
  QualityBreakdown,
  RelevantKnowledgeSignal,
  RelevantProfileContext,
} from '../shared/types';
import type { ExtractedClaim } from './claims';
import {
  countLanguageMarkers,
  resolveHeuristicLanguage,
} from './language-heuristics';
import {
  assessLocalReliability,
  calibrateLocalConfidence,
} from './reliability';
import { analyzeStructuralFeatures } from './structural-features';
import { textMatchScore, textTokens, tokenOverlap } from './text-match';
import { normalizeScore } from './utility';
import { QUALITY_WEIGHTS } from './config';
import { classifyClaimNovelty } from './evaluation';
import { applyClaimMemoryToClaim } from '../novelty/claim-memory';
import { applyUnifiedLocalEvidenceToClaim } from '../evidence/unified-evidence';

export { QUALITY_WEIGHTS } from './config';

const evidencePrior = {
  demonstrated: 0.92,
  explicitly_stated: 0.78,
  inferred: 0.55,
} as const;

function clampProbability(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function empiricalClaim(claim: string): boolean {
  return /\b(?:19|20)\d{2}\b|\b\d+(?:[.,]\d+)?%|\b(study|data|survey|experiment|sample|исследован|данн|опрос|эксперимент|выборк)\b/iu.test(
    claim,
  );
}

function strongestMatch(
  claim: string,
  signals: RelevantKnowledgeSignal[],
  kind: RelevantKnowledgeSignal['kind'],
): (RelevantKnowledgeSignal & { relation: number }) | null {
  let strongest: (RelevantKnowledgeSignal & { relation: number }) | null = null;
  for (const signal of signals) {
    if (signal.kind !== kind) continue;
    const knowledgeTokens = textTokens(`${signal.topic} ${signal.statement}`);
    const claimTokens = textTokens(claim);
    const overlap = tokenOverlap(knowledgeTokens, claimTokens);
    const smaller = Math.max(
      1,
      Math.min(knowledgeTokens.size, claimTokens.size),
    );
    const union = Math.max(
      1,
      knowledgeTokens.size + claimTokens.size - overlap,
    );
    const relation = Math.min(
      1,
      (overlap / smaller) * 0.65 + (overlap / union) * 0.35,
    );
    if (relation === 0) continue;
    if (!strongest || relation > strongest.relation) {
      strongest = { ...signal, relation };
    }
  }
  return strongest;
}

function assessClaim(
  item: ExtractedClaim,
  profileContext: RelevantProfileContext | null,
): KeyClaimAssessment {
  const knowledgeSignals = profileContext?.knowledgeSignals ?? [];
  const known = strongestMatch(item.claim, knowledgeSignals, 'known');
  const learning = strongestMatch(item.claim, knowledgeSignals, 'learning');
  const uncertainty = strongestMatch(item.claim, knowledgeSignals, 'uncertain');
  const relatedLearning = knowledgeSignals
    .filter((signal) => signal.kind === 'learning')
    .sort((left, right) => right.matchScore - left.matchScore)[0];
  const expertise = (profileContext?.signals ?? [])
    .filter((signal) => signal.kind === 'expertise')
    .map((signal) => ({
      signal,
      relation: textMatchScore(signal.label, item.claim),
    }))
    .sort((left, right) => right.relation - left.relation)[0];
  const isEmpirical =
    item.type === 'fact' ||
    item.type === 'evidence' ||
    empiricalClaim(item.claim);

  let knownProbability = 0.42;
  let confidence = 0.36;
  let reason = 'В профиле недостаточно конкретных сведений об этом тезисе.';

  if (known?.evidenceType && known.relation >= 0.24) {
    knownProbability =
      evidencePrior[known.evidenceType] *
      known.confidence *
      (0.55 + known.relation * 0.45);
    confidence = Math.max(0.55, known.confidence * known.relation);
    reason = `Тезис пересекается с конкретным знанием, отмеченным как «${known.statement}».`;
  } else if (learning && learning.relation >= 0.2) {
    knownProbability = 0.18 + (1 - learning.confidence) * 0.12;
    confidence = Math.max(0.5, learning.confidence * learning.relation);
    reason = `Тезис относится к области, которую пользователь сейчас изучает: «${learning.topic}».`;
  } else if (relatedLearning && isEmpirical) {
    knownProbability = 0.22;
    confidence = Math.max(0.48, relatedLearning.confidence * 0.58);
    reason = `Это конкретный результат в изучаемой области «${relatedLearning.topic}»; интерес к области не означает знание результата.`;
  } else if (uncertainty && uncertainty.relation >= 0.2) {
    knownProbability = 0.42;
    confidence = 0.32;
    reason = `Профиль прямо отмечает неопределённость знаний в области «${uncertainty.topic}».`;
  } else if (expertise && expertise.relation > 0) {
    knownProbability = isEmpirical ? 0.28 : 0.48;
    confidence = Math.min(0.52, expertise.signal.confidence * 0.55);
    reason = isEmpirical
      ? 'Область знакома пользователю, но конкретный факт нельзя считать известным только из уровня экспертизы.'
      : 'Широкая экспертиза повышает вероятность знакомства с основой, но не подтверждает знание этого тезиса.';
  }

  const history = profileContext?.historyEvidence;
  if (history && !known && !learning && !uncertainty) {
    const weakPrior = history.exactPageEncountered
      ? history.encounteredProbability * 0.12
      : history.topicFamiliarity * 0.05;
    knownProbability += (1 - knownProbability) * weakPrior;
    confidence = Math.max(
      confidence,
      Math.min(0.44, history.interestConfidence),
    );
    if (history.exactPageEncountered) {
      reason =
        'Эта страница раньше встречалась в истории, но это не доказывает, что материал был прочитан или запомнен.';
    } else if (history.matchingTopics.length > 0) {
      reason =
        'Похожие темы встречались в недавней истории; это лишь слабый сигнал знакомства, а не подтверждение знания тезиса.';
    }
  }

  knownProbability = clampProbability(knownProbability);
  confidence = clampProbability(confidence);
  return applyClaimMemoryToClaim(
    applyUnifiedLocalEvidenceToClaim(
      {
        ...item,
        novelty: classifyClaimNovelty(knownProbability, confidence),
        knownProbability: Number(knownProbability.toFixed(2)),
        reason,
        confidence: Number(confidence.toFixed(2)),
      },
      profileContext?.unifiedLocalEvidence,
    ),
    profileContext?.claimMemoryEvidence,
  );
}

export function calculateNoveltyScore(claims: KeyClaimAssessment[]): number {
  if (claims.length === 0) return 50;
  let weightedNovelty = 0;
  let totalWeight = 0;
  for (const claim of claims) {
    const importanceWeight = claim.importance === 'primary' ? 2 : 1;
    const novelty = 1 - claim.knownProbability;
    const calibratedNovelty =
      novelty * claim.confidence + 0.5 * (1 - claim.confidence);
    weightedNovelty += calibratedNovelty * importanceWeight;
    totalWeight += importanceWeight;
  }
  return normalizeScore((weightedNovelty / totalWeight) * 100);
}

export function calculateQualityScore(breakdown: QualityBreakdown): number {
  return normalizeScore(
    breakdown.evidence * QUALITY_WEIGHTS.evidence +
      breakdown.reasoning * QUALITY_WEIGHTS.reasoning +
      breakdown.specificity * QUALITY_WEIGHTS.specificity +
      breakdown.calibration * QUALITY_WEIGHTS.calibration,
  );
}

export function assessLocalQuality(
  material: PageCapture,
  extractedClaims: ExtractedClaim[] = [],
): {
  breakdown: QualityBreakdown;
  summary: string;
  strengths: string[];
  limitations: string[];
  confidence: number;
} {
  const content = material.content;
  const language = resolveHeuristicLanguage(material.language, content);
  const evidenceMarkers = countLanguageMarkers(content, 'evidence', language);
  const reasoningMarkers = countLanguageMarkers(content, 'reasoning', language);
  const calibrationMarkers = countLanguageMarkers(
    content,
    'calibration',
    language,
  );
  const structure = analyzeStructuralFeatures(material, extractedClaims);
  const evidence = normalizeScore(
    30 +
      Math.min(28, evidenceMarkers * 3) +
      Math.min(24, structure.sourceLinkCount * 6) +
      Math.min(12, structure.evidenceClaimCount * 3) +
      Math.min(6, structure.quoteCount * 2) +
      (material.wordCount > 900 ? 4 : 0),
  );
  const reasoning = normalizeScore(
    34 +
      Math.min(30, reasoningMarkers * 3) +
      Math.min(12, structure.reasoningClaimCount * 3) +
      Math.min(9, structure.claimTypeCount * 3) +
      (structure.headingCount > 1 ? 6 : 0),
  );
  const specificity = normalizeScore(
    34 +
      Math.min(34, structure.numericalMarkerCount * 2) +
      Math.min(8, structure.sourceLinkCount * 2) +
      Math.min(8, structure.tableCount * 4 + structure.listItemCount) +
      (material.excerpt ? 5 : 0),
  );
  const calibration = normalizeScore(30 + Math.min(48, calibrationMarkers * 4));
  const breakdown = { evidence, reasoning, specificity, calibration };
  const score = calculateQualityScore(breakdown);
  const strengths: string[] = [];
  const limitations: string[] = [];
  if (evidence >= 65)
    strengths.push(
      'В тексте есть заметные признаки опоры на данные или источники.',
    );
  if (reasoning >= 65)
    strengths.push(
      'Связь между аргументами и выводами изложена последовательно.',
    );
  if (specificity >= 65)
    strengths.push(
      'Утверждения достаточно конкретны и потенциально проверяемы.',
    );
  if (calibration >= 65)
    strengths.push(
      'Автор обозначает ограничения или альтернативные объяснения.',
    );
  if (evidence < 55)
    limitations.push(
      'Поддержка основных утверждений данными или источниками выглядит ограниченной.',
    );
  if (calibration < 50)
    limitations.push(
      'В тексте мало явных оговорок об ограничениях и неопределённости.',
    );
  if (limitations.length === 0) {
    limitations.push(
      'Локальный анализ не проверяет истинность и качество первичных источников.',
    );
  }
  return {
    breakdown,
    summary:
      score >= 70
        ? 'Материал выглядит хорошо обоснованным по структуре представленного текста.'
        : score >= 50
          ? 'Обоснование выглядит смешанным: у материала есть сильные стороны, но выводы поддержаны неравномерно.'
          : 'Представленное обоснование выглядит слабым или недостаточно проверяемым.',
    strengths: strengths.slice(0, 2),
    limitations: limitations.slice(0, 2),
    confidence:
      material.extractionMethod === 'readability'
        ? 0.74
        : material.extractionMethod === 'semantic'
          ? 0.6
          : 0.44,
  };
}

export function buildLocalInsights(
  material: PageCapture,
  extractedClaims: ExtractedClaim[],
  profileContext: RelevantProfileContext | null,
): MaterialEvaluationInsights {
  const keyClaims = extractedClaims.map((claim) =>
    assessClaim(claim, profileContext),
  );
  const likelyNewClaims = keyClaims
    .filter((claim) => claim.novelty === 'likely-new')
    .slice(0, 3)
    .map((claim) => claim.claim);
  const familiarClaims = keyClaims
    .filter(
      (claim) =>
        claim.novelty === 'known' || claim.novelty === 'partially-known',
    )
    .slice(0, 2)
    .map((claim) => claim.claim);
  const noveltyConfidence =
    keyClaims.length === 0
      ? 0.25
      : keyClaims.reduce((sum, claim) => sum + claim.confidence, 0) /
        keyClaims.length;
  const noveltyScore = calculateNoveltyScore(keyClaims);
  const language = resolveHeuristicLanguage(
    material.language,
    material.content,
  );
  const reliability = assessLocalReliability(material, language);
  const quality = assessLocalQuality(material, extractedClaims);
  return {
    keyClaims,
    likelyNewClaims,
    familiarClaims,
    noveltySummary:
      noveltyScore >= 70
        ? 'Большая часть центральных тезисов, вероятно, будет новой.'
        : noveltyScore >= 50
          ? 'Материал сочетает знакомый контекст и потенциально новые тезисы.'
          : 'Основные идеи, вероятно, в значительной степени знакомы.',
    noveltyConfidence: calibrateLocalConfidence(noveltyConfidence, reliability),
    qualityBreakdown: quality.breakdown,
    qualitySummary: quality.summary,
    qualityStrengths: quality.strengths,
    qualityLimitations: quality.limitations,
    qualityConfidence: calibrateLocalConfidence(
      quality.confidence,
      reliability,
    ),
    reliability,
  };
}
