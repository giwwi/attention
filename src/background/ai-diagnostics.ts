import {
  AI_PASSAGE_DISPLAY_TYPE,
  isAiPassageDisplayMessage,
} from '../diagnostics/ai-analysis-messages';
import { recordAiPassageDisplay } from '../diagnostics/ai-analysis';
import {
  beginDataOperation,
  commitDataOperation,
} from '../privacy/data-operations';
import { messageSenderMatchesPage } from './message-sender';

export function handleAiPassageDisplay(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: unknown) => void,
): true | void {
  if (
    !message ||
    typeof message !== 'object' ||
    (message as { type?: unknown }).type !== AI_PASSAGE_DISPLAY_TYPE
  )
    return;
  if (
    sender.id !== chrome.runtime.id ||
    !isAiPassageDisplayMessage(message) ||
    !messageSenderMatchesPage(sender, message.url)
  ) {
    respond({ ok: false });
    return;
  }
  const operation = beginDataOperation();
  void operation
    .then((op) =>
      commitDataOperation(op, () =>
        recordAiPassageDisplay(
          message.analysisId,
          message.url,
          message.display,
        ),
      ),
    )
    .then((ok) => respond({ ok }))
    .catch(() => respond({ ok: false }));
  return true;
}
