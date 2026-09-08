import type {
  MaterialEvaluation,
  PageCapture,
  PersonalizationSignal,
} from '../shared/types';
import { readingPlanText } from '../i18n/reading-plan';
import { DEFAULT_UI_LANGUAGE, type UiLanguage } from '../i18n/ui';

export interface ReadingPlanSection {
  heading: string;
  reason: string;
}

export interface ReadingPlan {
  title: string;
  note: string | null;
  estimatedMinutes: number;
  sections: ReadingPlanSection[];
}

function estimateSectionMinutes(
  material: PageCapture,
  sectionCount: number,
): number {
  if (sectionCount === 0 || material.readingTimeMinutes === 0) return 0;
  const representedSections = Math.max(sectionCount, material.headings.length);
  const proportionalMinutes = Math.max(
    1,
    Math.round(
      material.readingTimeMinutes * (sectionCount / representedSections),
    ),
  );
  return Math.min(material.readingTimeMinutes, proportionalMinutes);
}

function strongestPositiveSignal(
  signals: PersonalizationSignal[],
): PersonalizationSignal | undefined {
  return signals
    .filter((signal) => signal.effect === 'positive')
    .sort(
      (left, right) =>
        right.confidence * right.matchScore - left.confidence * left.matchScore,
    )[0];
}

function sectionReason(
  index: number,
  evaluation: MaterialEvaluation,
  language: UiLanguage,
): string {
  const signal = strongestPositiveSignal(evaluation.profileSignals ?? []);
  if (index === 0 && evaluation.insights?.likelyNewClaims.length) {
    return readingPlanText(language, 'newReason');
  }
  if (signal?.kind === 'goal') {
    return readingPlanText(language, 'goalReason', { goal: signal.label });
  }
  if (evaluation.components.actionability >= 65) {
    return readingPlanText(language, 'practicalReason');
  }
  return readingPlanText(language, 'contextReason');
}

export function buildReadingPlan(
  material: PageCapture,
  evaluation: MaterialEvaluation,
  language: UiLanguage = DEFAULT_UI_LANGUAGE,
): ReadingPlan | null {
  const availableHeadings = new Set(material.headings);
  const headings = evaluation.recommendedSections
    .filter((heading) => availableHeadings.has(heading))
    .filter((heading, index, values) => values.indexOf(heading) === index)
    .slice(0, 3);
  if (headings.length === 0) return null;

  const estimatedMinutes = estimateSectionMinutes(material, headings.length);
  const title = readingPlanText(
    language,
    headings.length === 1 ? 'titleSingle' : 'titlePlural',
    {
      total: material.readingTimeMinutes,
      count: headings.length,
      minutes: estimatedMinutes,
    },
  );
  const firstHeading = material.headings[0];
  const note =
    firstHeading && !headings.includes(firstHeading)
      ? readingPlanText(language, 'note', { heading: firstHeading })
      : null;

  return {
    title,
    note,
    estimatedMinutes,
    sections: headings.map((heading, index) => ({
      heading,
      reason: sectionReason(index, evaluation, language),
    })),
  };
}
