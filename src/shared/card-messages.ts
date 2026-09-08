import type { AnalysisContext } from './types';

export const ATTENTION_CARD_OPEN_TYPE = 'ATTENTION_CARD/OPEN';
export const ATTENTION_CONTEXT_GET_TYPE = 'ATTENTION_CONTEXT/GET';
export const ATTENTION_CONTEXT_UPDATE_TYPE = 'ATTENTION_CONTEXT/UPDATE';
export const CARD_CONTEXT_INTENT_LIMIT = 180;
export const CARD_CONTEXT_FORMAT_LIMIT = 80;

export interface CardOpenMessage {
  type: typeof ATTENTION_CARD_OPEN_TYPE;
}

export interface CardOpenResponse {
  ok: boolean;
  reason?: 'not_article' | 'unavailable' | 'profile_required';
}

export interface ContextGetMessage {
  type: typeof ATTENTION_CONTEXT_GET_TYPE;
  url: string;
}

export interface ContextUpdateMessage {
  type: typeof ATTENTION_CONTEXT_UPDATE_TYPE;
  url: string;
  context: AnalysisContext;
}

export type ContextMessage = ContextGetMessage | ContextUpdateMessage;

export interface ContextResponse {
  ok: boolean;
  context?: AnalysisContext;
  reason?: 'invalid_context' | 'unavailable' | 'cancelled';
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function isCardOpenMessage(value: unknown): value is CardOpenMessage {
  return object(value) && value.type === ATTENTION_CARD_OPEN_TYPE;
}

function pageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function isAnalysisContextDto(value: unknown): value is AnalysisContext {
  if (!object(value)) return false;
  const fields = new Set([
    'intent',
    'availableMinutes',
    'scenario',
    'relaxIntent',
    'desiredEffort',
    'leisureFormats',
  ]);
  return (
    Object.keys(value).every((key) => fields.has(key)) &&
    typeof value.intent === 'string' &&
    value.intent.length <= CARD_CONTEXT_INTENT_LIMIT &&
    typeof value.availableMinutes === 'number' &&
    [5, 15, 30].includes(value.availableMinutes) &&
    typeof value.scenario === 'string' &&
    ['work', 'learn', 'explore', 'relax'].includes(value.scenario) &&
    (value.relaxIntent == null ||
      (typeof value.relaxIntent === 'string' &&
        [
          'chill',
          'funny',
          'interesting',
          'exciting',
          'familiar',
          'surprise',
        ].includes(value.relaxIntent))) &&
    (value.desiredEffort == null ||
      (typeof value.desiredEffort === 'string' &&
        ['low', 'medium', 'high'].includes(value.desiredEffort))) &&
    (value.leisureFormats === undefined ||
      (Array.isArray(value.leisureFormats) &&
        value.leisureFormats.length <= 6 &&
        value.leisureFormats.every(
          (format) =>
            typeof format === 'string' &&
            format.length <= CARD_CONTEXT_FORMAT_LIMIT,
        )))
  );
}

export function isContextGetMessage(
  value: unknown,
): value is ContextGetMessage {
  return (
    object(value) &&
    value.type === ATTENTION_CONTEXT_GET_TYPE &&
    pageUrl(value.url)
  );
}

export function isContextUpdateMessage(
  value: unknown,
): value is ContextUpdateMessage {
  return (
    object(value) &&
    value.type === ATTENTION_CONTEXT_UPDATE_TYPE &&
    pageUrl(value.url) &&
    isAnalysisContextDto(value.context)
  );
}
