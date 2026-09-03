export const AI_ANALYZER_SETTINGS_KEY = 'aiAnalyzerSettings';
export const AI_GATEWAY_DEFAULT_MODEL_ID = 'google/gemini-2.5-flash-lite';
export const AI_GATEWAY_SUGGESTED_MODELS = [
  AI_GATEWAY_DEFAULT_MODEL_ID,
] as const;

const AI_GATEWAY_MODEL_PATTERN =
  /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

export interface AiAnalyzerSettings {
  provider: 'vercel-ai-gateway';
  model: string;
  apiKey: string;
  updatedAt: string;
}

interface LegacyAiAnalyzerSettings {
  provider: 'vercel-ai-gateway';
  apiKey: string;
  updatedAt: string;
}

export function isAiGatewayModelId(value: unknown): value is string {
  return (
    typeof value === 'string' && AI_GATEWAY_MODEL_PATTERN.test(value.trim())
  );
}

export function normalizeAiGatewayModelId(value: string): string {
  const normalized = value.trim();
  if (!isAiGatewayModelId(normalized)) {
    throw new Error('Укажите модель в формате provider/model.');
  }
  return normalized;
}

export function isAiAnalyzerSettings(
  value: unknown,
): value is AiAnalyzerSettings {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.provider === 'vercel-ai-gateway' &&
    isAiGatewayModelId(candidate.model) &&
    typeof candidate.apiKey === 'string' &&
    candidate.apiKey.trim().length >= 12 &&
    typeof candidate.updatedAt === 'string'
  );
}

function isLegacyAiAnalyzerSettings(
  value: unknown,
): value is LegacyAiAnalyzerSettings {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.provider === 'vercel-ai-gateway' &&
    candidate.model === undefined &&
    typeof candidate.apiKey === 'string' &&
    candidate.apiKey.trim().length >= 12 &&
    typeof candidate.updatedAt === 'string'
  );
}

export async function loadAiAnalyzerSettings(): Promise<AiAnalyzerSettings | null> {
  const stored = await chrome.storage.local.get(AI_ANALYZER_SETTINGS_KEY);
  const value: unknown = stored[AI_ANALYZER_SETTINGS_KEY];
  if (isAiAnalyzerSettings(value)) return value;
  if (!isLegacyAiAnalyzerSettings(value)) return null;

  const migrated: AiAnalyzerSettings = {
    ...value,
    model: AI_GATEWAY_DEFAULT_MODEL_ID,
  };
  await chrome.storage.local.set({
    [AI_ANALYZER_SETTINGS_KEY]: migrated,
  });
  return migrated;
}

export async function saveAiAnalyzerSettings(
  apiKey: string,
  model = AI_GATEWAY_DEFAULT_MODEL_ID,
): Promise<AiAnalyzerSettings> {
  const existing = await loadAiAnalyzerSettings();
  const normalizedKey = apiKey.trim() || existing?.apiKey || '';
  if (normalizedKey.length < 12) {
    throw new Error('Введите действующий ключ AI Gateway.');
  }
  const settings: AiAnalyzerSettings = {
    provider: 'vercel-ai-gateway',
    model: normalizeAiGatewayModelId(model),
    apiKey: normalizedKey,
    updatedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [AI_ANALYZER_SETTINGS_KEY]: settings });
  return settings;
}

export async function clearAiAnalyzerSettings(): Promise<void> {
  await chrome.storage.local.remove(AI_ANALYZER_SETTINGS_KEY);
}
