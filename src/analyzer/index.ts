import type { Analyzer } from './analyzer';
import { AiGatewayAnalyzer } from './ai-gateway-analyzer';
import { FallbackAnalyzer } from './fallback-analyzer';
import { LocalAnalyzer } from './local-analyzer';
import type { AiAnalyzerSettings } from './settings';
import type { AiAnalysisDiagnostic } from '../diagnostics/ai-analysis-types';

export function createAnalyzer(
  settings: AiAnalyzerSettings | null = null,
  onPrimaryFailure?: (error: unknown) => Promise<void> | void,
  onDiagnostic?: (report: AiAnalysisDiagnostic) => Promise<void>,
): Analyzer {
  const local = new LocalAnalyzer();
  if (!settings) return local;
  return new FallbackAnalyzer(
    new AiGatewayAnalyzer(settings.apiKey, settings.model, onDiagnostic),
    local,
    onPrimaryFailure,
  );
}

export type { Analyzer } from './analyzer';
