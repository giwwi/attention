import type { Analyzer } from './analyzer';
import { AiGatewayAnalyzer } from './ai-gateway-analyzer';
import { FallbackAnalyzer } from './fallback-analyzer';
import { LocalAnalyzer } from './local-analyzer';
import type { AiAnalyzerSettings } from './settings';

export function createAnalyzer(
  settings: AiAnalyzerSettings | null = null,
  onPrimaryFailure?: (error: unknown) => Promise<void> | void,
): Analyzer {
  const local = new LocalAnalyzer();
  if (!settings) return local;
  return new FallbackAnalyzer(
    new AiGatewayAnalyzer(settings.apiKey, settings.model),
    local,
    onPrimaryFailure,
  );
}

export type { Analyzer } from './analyzer';
