import type {
  AnalysisContext,
  MaterialEvaluation,
  PageCapture,
  RelevantProfileContext,
} from '../shared/types';

export interface Analyzer {
  readonly id: string;
  analyze(
    material: PageCapture,
    context: AnalysisContext,
    profileContext?: RelevantProfileContext | null,
  ): Promise<MaterialEvaluation>;
}
