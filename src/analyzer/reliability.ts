import type { AssessmentReliability, PageCapture } from '../shared/types';
import type { HeuristicLanguageResolution } from './language-heuristics';

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function assessLocalReliability(
  material: PageCapture,
  language: HeuristicLanguageResolution,
): AssessmentReliability {
  let extractionConfidence =
    material.extractionMethod === 'readability'
      ? 0.82
      : material.extractionMethod === 'semantic'
        ? 0.62
        : 0.38;
  if (material.isArticle) extractionConfidence += 0.06;
  if (material.wordCount >= 350) extractionConfidence += 0.05;
  if (material.wordCount < 120) extractionConfidence -= 0.16;
  if ((material.structure?.paragraphCount ?? 0) >= 4)
    extractionConfidence += 0.04;
  if ((material.structure?.headingCount ?? material.headings.length) >= 2)
    extractionConfidence += 0.03;
  if (!material.isArticle) extractionConfidence -= 0.18;
  extractionConfidence = clamp(extractionConfidence);

  const languageConfidence = language.supported
    ? language.source === 'metadata'
      ? 0.94
      : 0.86
    : 0.48;
  let overallConfidence = clamp(
    extractionConfidence * 0.7 + languageConfidence * 0.3,
  );
  if (!language.supported)
    overallConfidence = Math.min(overallConfidence, 0.48);
  if (extractionConfidence < 0.55)
    overallConfidence = Math.min(overallConfidence, 0.45);
  const level =
    overallConfidence >= 0.72
      ? 'high'
      : overallConfidence >= 0.5
        ? 'medium'
        : 'low';
  return {
    heuristicLanguage: language.heuristicLanguage,
    languageSupported: language.supported,
    extractionConfidence: Number(extractionConfidence.toFixed(2)),
    overallConfidence: Number(overallConfidence.toFixed(2)),
    level,
    weakExtraction: extractionConfidence < 0.55,
  };
}

export function calibrateLocalConfidence(
  confidence: number,
  reliability: AssessmentReliability,
): number {
  let result = Math.min(confidence, reliability.overallConfidence);
  if (!reliability.languageSupported) result = Math.min(result, 0.48);
  if (reliability.weakExtraction) result = Math.min(result, 0.42);
  return Number(clamp(result).toFixed(2));
}
