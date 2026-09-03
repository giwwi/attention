export const NOVEL_PASSAGE_FEEDBACK_TYPE =
  'ATTENTION_NOVELTY/PASSAGE_FEEDBACK' as const;
export const READWISE_SAVE_HIGHLIGHT_TYPE =
  'ATTENTION_READWISE/SAVE_HIGHLIGHT' as const;

export type NovelPassageFeedbackValue = 'known' | 'new';

export interface NovelPassageFeedbackMessage {
  type: typeof NOVEL_PASSAGE_FEEDBACK_TYPE;
  url: string;
  title: string;
  claim: string;
  excerpt: string;
  value: NovelPassageFeedbackValue;
}

export interface ReadwiseSaveHighlightMessage {
  type: typeof READWISE_SAVE_HIGHLIGHT_TYPE;
  url: string;
  title: string;
  author: string | null;
  excerpt: string;
}

export interface NovelPassageActionResponse {
  ok: boolean;
  error?: string;
}

export type NovelPassageMessage =
  NovelPassageFeedbackMessage | ReadwiseSaveHighlightMessage;

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= minimum &&
    value.length <= maximum
  );
}

export function isNovelPassageMessage(
  value: unknown,
): value is NovelPassageMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (
    !boundedString(message.url, 8, 2_048) ||
    !boundedString(message.title, 1, 400) ||
    !boundedString(message.excerpt, 20, 1_200)
  ) {
    return false;
  }
  if (message.type === NOVEL_PASSAGE_FEEDBACK_TYPE) {
    return (
      boundedString(message.claim, 10, 500) &&
      (message.value === 'known' || message.value === 'new')
    );
  }
  if (message.type === READWISE_SAVE_HIGHLIGHT_TYPE) {
    return message.author === null || boundedString(message.author, 1, 240);
  }
  return false;
}
