import { privateStorage } from '../vault/storage';
import {
  ATTENTION_CONTEXT_GET_TYPE,
  ATTENTION_CONTEXT_UPDATE_TYPE,
  CARD_CONTEXT_FORMAT_LIMIT,
  CARD_CONTEXT_INTENT_LIMIT,
  isContextGetMessage,
  isContextUpdateMessage,
  type ContextResponse,
} from '../shared/card-messages';
import type { AnalysisContext } from '../shared/types';
import {
  changeScenario,
  normalizeAnalysisContext,
  normalizeScenarioState,
  SCENARIO_STATE_KEY,
} from '../scenario/scenario';
import {
  beginDataOperation,
  commitDataOperation,
  DataOperationCancelledError,
} from '../privacy/data-operations';
import { messageSenderMatchesPage } from './message-sender';

export const CARD_ANALYSIS_CONTEXT_KEY = 'analysisContext';

/** Explicit fields only: the card must never receive a stored profile object. */
export function cardContextDto(value: unknown): AnalysisContext {
  const normalized = normalizeAnalysisContext(value);
  return {
    intent: normalized.intent.slice(0, CARD_CONTEXT_INTENT_LIMIT),
    availableMinutes: normalized.availableMinutes,
    scenario: normalized.scenario,
    relaxIntent: normalized.relaxIntent ?? null,
    desiredEffort: normalized.desiredEffort ?? null,
    leisureFormats: (normalized.leisureFormats ?? [])
      .slice(0, 6)
      .map((format) => format.trim().slice(0, CARD_CONTEXT_FORMAT_LIMIT))
      .filter(Boolean),
  };
}

export async function loadCardContext(
  storage: chrome.storage.StorageArea = privateStorage,
): Promise<AnalysisContext> {
  // Read one snapshot so scenario and analysis settings cannot come from two
  // different updates while another extension context changes its preferences.
  const stored = await storage.get([
    CARD_ANALYSIS_CONTEXT_KEY,
    SCENARIO_STATE_KEY,
  ]);
  const base = cardContextDto(stored[CARD_ANALYSIS_CONTEXT_KEY]);
  const state = normalizeScenarioState(stored[SCENARIO_STATE_KEY]);
  return cardContextDto({
    ...base,
    scenario: state.scenario,
    relaxIntent: state.relaxIntent,
    desiredEffort: state.desiredEffort,
    leisureFormats: state.leisureFormats,
  });
}

async function saveCardContext(
  context: AnalysisContext,
  storage: chrome.storage.StorageArea,
): Promise<AnalysisContext> {
  const normalized = cardContextDto(context);
  const stored = await storage.get(SCENARIO_STATE_KEY);
  const current = normalizeScenarioState(stored[SCENARIO_STATE_KEY]);
  const state = normalizeScenarioState({
    ...changeScenario(current, normalized.scenario, 'manual'),
    relaxIntent: normalized.relaxIntent,
    desiredEffort: normalized.desiredEffort,
    leisureFormats: normalized.leisureFormats,
  });
  // One write triggers the existing input-invalidated broadcast for both keys.
  await storage.set({
    [SCENARIO_STATE_KEY]: state,
    [CARD_ANALYSIS_CONTEXT_KEY]: normalized,
  });
  return normalized;
}

export interface CardContextHandlerOptions {
  storageReady: Promise<void>;
  storage?: chrome.storage.StorageArea;
  senderMatchesPage?: typeof messageSenderMatchesPage;
}

/** The context boundary is independent of article/profile analysis handlers. */
export function createCardContextMessageHandler({
  storageReady,
  storage = privateStorage,
  senderMatchesPage = messageSenderMatchesPage,
}: CardContextHandlerOptions): (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ContextResponse) => void,
) => true | void {
  let queue: Promise<unknown> = Promise.resolve();
  return (message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return;
    const type = (message as Record<string, unknown>).type;
    if (
      type !== ATTENTION_CONTEXT_GET_TYPE &&
      type !== ATTENTION_CONTEXT_UPDATE_TYPE
    )
      return;
    if (!isContextGetMessage(message) && !isContextUpdateMessage(message)) {
      sendResponse({ ok: false, reason: 'invalid_context' });
      return;
    }
    if (sender.frameId !== 0 || !senderMatchesPage(sender, message.url)) {
      sendResponse({ ok: false, reason: 'unavailable' });
      return;
    }
    // Capture the generation on receipt, before storage initialization or an
    // older context request can delay this request past a Delete all action.
    const operation = beginDataOperation(storage);
    void operation.catch(() => undefined);
    const next = queue.then(async (): Promise<ContextResponse> => {
      await storageReady;
      const context = await commitDataOperation(
        await operation,
        () =>
          message.type === ATTENTION_CONTEXT_UPDATE_TYPE
            ? saveCardContext(message.context, storage)
            : loadCardContext(storage),
        storage,
      );
      return { ok: true, context };
    });
    queue = next.catch(() => undefined);
    void next.then(sendResponse).catch((error: unknown) => {
      sendResponse({
        ok: false,
        reason:
          error instanceof DataOperationCancelledError
            ? 'cancelled'
            : 'unavailable',
      });
    });
    return true;
  };
}
