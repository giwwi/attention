import type {
  AnalysisContext,
  MaterialEvaluation,
  PageCapture,
  RelevantProfileContext,
} from '../shared/types';
import type { Analyzer } from './analyzer';

export class FallbackAnalyzer implements Analyzer {
  readonly id: string;

  constructor(
    private readonly primary: Analyzer,
    private readonly fallback: Analyzer,
    private readonly onPrimaryFailure?: (
      error: unknown,
    ) => Promise<void> | void,
  ) {
    this.id = primary.id;
  }

  async analyze(
    material: PageCapture,
    context: AnalysisContext,
    profileContext: RelevantProfileContext | null = null,
  ): Promise<MaterialEvaluation> {
    try {
      return await this.primary.analyze(material, context, profileContext);
    } catch (error) {
      await Promise.resolve(this.onPrimaryFailure?.(error)).catch(
        () => undefined,
      );
      return this.fallback.analyze(material, context, profileContext);
    }
  }
}
