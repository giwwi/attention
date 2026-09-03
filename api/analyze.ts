import { AiGatewayAnalyzer } from '../src/analyzer/ai-gateway-analyzer';
import {
  isAnalyzeRequestBody,
  type AnalyzeResponseBody,
} from '../src/analyzer/api-contract';
import type { AnalysisContext, PageCapture } from '../src/shared/types';
import { verifyPublicSessionAuthorization } from './session-auth';

function environment(name: string): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.process?.env?.[name];
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}

function pageCapture(
  title: string,
  url: string,
  articleText: string,
): PageCapture {
  const wordCount = articleText.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  return {
    title: title.trim(),
    url,
    content: articleText,
    excerpt: articleText.replace(/\s+/g, ' ').trim().slice(0, 320),
    byline: null,
    siteName: new URL(url).hostname.replace(/^www\./, ''),
    publishedTime: null,
    language: null,
    wordCount,
    readingTimeMinutes: Math.max(1, Math.ceil(wordCount / 220)),
    headings: [],
    isArticle: true,
    extractionMethod: 'visible-text',
    capturedAt: new Date().toISOString(),
  };
}

async function handleAnalyze(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return json(null, 204);
  if (request.method !== 'POST')
    return json({ error: 'Method not allowed' }, 405);

  const sessionSecret = environment('ATTENTION_SESSION_SECRET');
  const sessionAudience =
    environment('ATTENTION_SESSION_AUDIENCE') ?? 'attention-analyze';
  const gatewayKey = environment('AI_GATEWAY_API_KEY');
  if (!sessionSecret || !gatewayKey) {
    return json({ error: 'Analyzer is not configured' }, 503);
  }
  const session = await verifyPublicSessionAuthorization(
    request.headers.get('authorization'),
    sessionSecret,
    sessionAudience,
  );
  if (!session) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!isAnalyzeRequestBody(body)) {
    return json({ error: 'Invalid analyze request' }, 400);
  }

  const material = pageCapture(body.title, body.url, body.articleText);
  const context: AnalysisContext = {
    intent: body.intent?.trim().slice(0, 180) ?? '',
    availableMinutes: body.availableMinutes ?? 15,
    scenario: body.scenario ?? 'work',
    relaxIntent: body.relaxIntent ?? null,
    desiredEffort: body.desiredEffort ?? null,
    leisureFormats: body.leisureFormats ?? [],
  };
  let evaluation;
  try {
    evaluation = await new AiGatewayAnalyzer(gatewayKey).analyze(
      material,
      context,
      body.profileContext,
    );
  } catch {
    // Never expose provider, prompt, key, or upstream response details.
    return json({ error: 'Analyzer temporarily unavailable' }, 502);
  }
  const response: AnalyzeResponseBody = {
    ...evaluation.components,
    utility: evaluation.utilityScore,
    reason: evaluation.reason,
    recommendation: evaluation.recommendedAction,
    estimatedUsefulMinutes: evaluation.estimatedUsefulMinutes,
    analyzerVersion: evaluation.analyzerId,
    scenario: evaluation.scenario,
    scenarioSignals: evaluation.scenarioSignals,
    insights: evaluation.insights,
  };
  return json(response);
}

export default {
  fetch: handleAnalyze,
};

export { handleAnalyze };
