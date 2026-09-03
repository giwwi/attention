import {
  ATTENTION_OUTCOME_PROMPT_SHOWN_TYPE,
  ATTENTION_OUTCOME_SUBMIT_TYPE,
  ATTENTION_SESSION_AUTO_START_TYPE,
  ATTENTION_SESSION_PROGRESS_TYPE,
  HOVER_PREVIEW_EVENT_TYPE,
  HOVER_PREVIEW_REQUEST_TYPE,
  SAVE_MATERIAL_REQUEST_TYPE,
  type AttentionOutcomePromptShownMessage,
  type AttentionOutcomeSubmitMessage,
  type AttentionSessionAutoStartMessage,
  type AttentionSessionProgressMessage,
  type HoverPreviewEventMessage,
  type HoverPreviewRequest,
  type PageCapture,
  type SaveMaterialRequest,
  type ScrollDepth,
} from '../shared/types';

export function isPageCapture(value: unknown): value is PageCapture {
  if (!value || typeof value !== 'object') return false;
  const capture = value as Record<string, unknown>;
  return (
    typeof capture.title === 'string' &&
    typeof capture.url === 'string' &&
    typeof capture.content === 'string' &&
    typeof capture.excerpt === 'string' &&
    typeof capture.wordCount === 'number' &&
    typeof capture.readingTimeMinutes === 'number' &&
    Array.isArray(capture.headings) &&
    typeof capture.isArticle === 'boolean' &&
    ['readability', 'semantic', 'visible-text'].includes(
      String(capture.extractionMethod),
    )
  );
}

export function isProgressMessage(
  value: unknown,
): value is AttentionSessionProgressMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    message.type === ATTENTION_SESSION_PROGRESS_TYPE &&
    typeof message.sessionId === 'string' &&
    typeof message.url === 'string' &&
    typeof message.visibleSeconds === 'number' &&
    Number.isFinite(message.visibleSeconds) &&
    [0, 25, 50, 75, 100].includes(
      Number(message.maxScrollDepth as ScrollDepth),
    ) &&
    typeof message.ended === 'boolean' &&
    typeof message.recordedAt === 'string'
  );
}

export function isAutoStartMessage(
  value: unknown,
): value is AttentionSessionAutoStartMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    message.type === ATTENTION_SESSION_AUTO_START_TYPE &&
    isPageCapture(message.capture)
  );
}

export function isOutcomePromptShownMessage(
  value: unknown,
): value is AttentionOutcomePromptShownMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    message.type === ATTENTION_OUTCOME_PROMPT_SHOWN_TYPE &&
    typeof message.sessionId === 'string' &&
    typeof message.url === 'string'
  );
}

export function isOutcomeSubmitMessage(
  value: unknown,
): value is AttentionOutcomeSubmitMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    message.type === ATTENTION_OUTCOME_SUBMIT_TYPE &&
    typeof message.sessionId === 'string' &&
    typeof message.url === 'string' &&
    ['yes', 'partial', 'no'].includes(String(message.outcome))
  );
}

export function isHoverPreviewRequest(
  value: unknown,
): value is HoverPreviewRequest {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    message.type === HOVER_PREVIEW_REQUEST_TYPE &&
    typeof message.url === 'string' &&
    typeof message.title === 'string' &&
    typeof message.snippet === 'string' &&
    (message.capture === undefined || isPageCapture(message.capture)) &&
    (message.analysisMode === undefined ||
      message.analysisMode === 'local' ||
      message.analysisMode === 'ai') &&
    (message.analysisMode !== 'ai' || isPageCapture(message.capture))
  );
}

export function isSaveMaterialRequest(
  value: unknown,
): value is SaveMaterialRequest {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    message.type === SAVE_MATERIAL_REQUEST_TYPE &&
    isPageCapture(message.capture)
  );
}

export function isHoverPreviewEvent(
  value: unknown,
): value is HoverPreviewEventMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    message.type === HOVER_PREVIEW_EVENT_TYPE &&
    (message.event === 'shown' || message.event === 'opened') &&
    ['work', 'learn', 'explore', 'relax'].includes(String(message.scenario)) &&
    typeof message.url === 'string' &&
    typeof message.title === 'string' &&
    ['read', 'maybe', 'skip'].includes(String(message.verdict)) &&
    ['open', 'maybe', 'save', 'skip'].includes(
      String(message.recommendedAction),
    ) &&
    (message.source === 'full-analysis' ||
      message.source === 'title-preview') &&
    Array.isArray(message.signalIds) &&
    message.signalIds.every((id) => typeof id === 'string') &&
    typeof message.occurredAt === 'string'
  );
}
