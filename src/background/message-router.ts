import type {
  AttentionOutcomeSubmitResponse,
  AttentionSessionAutoStartResponse,
  HoverPreviewEventMessage,
  HoverPreviewResponse,
  SaveMaterialResponse,
  UiLanguageResponse,
} from '../shared/types';
import { UI_LANGUAGE_GET_TYPE } from '../shared/types';
import type { UiLanguage } from '../i18n/ui';
import type {
  AttentionOutcomePromptShownMessage,
  AttentionOutcomeSubmitMessage,
  AttentionSessionAutoStartMessage,
  AttentionSessionProgressMessage,
  HoverPreviewRequest,
  SaveMaterialRequest,
} from '../shared/types';
import {
  isAutoStartMessage,
  isHoverPreviewEvent,
  isHoverPreviewRequest,
  isOutcomePromptShownMessage,
  isOutcomeSubmitMessage,
  isProgressMessage,
  isSaveMaterialRequest,
} from './message-guards';
import {
  isBrowserHistoryImportRequest,
  type BrowserHistoryImportRequest,
  type BrowserHistoryImportResponse,
} from '../history/messages';
import {
  isReadwiseRequest,
  type ReadwiseRequest,
  type ReadwiseSyncResponse,
} from '../readwise/messages';
import {
  isNotionRequest,
  type NotionRequest,
  type NotionResponse,
} from '../notion/messages';
import {
  isNovelPassageMessage,
  type NovelPassageActionResponse,
  type NovelPassageMessage,
} from '../novelty/messages';

type SendResponse = (response?: unknown) => void;

export interface BackgroundMessageRouterDependencies {
  storageReady: Promise<void>;
  loadInterfaceLanguage: () => Promise<UiLanguage>;
  autoStartSession: (
    message: AttentionSessionAutoStartMessage,
  ) => Promise<AttentionSessionAutoStartResponse | undefined>;
  markOutcomePromptShown: (sessionId: string) => Promise<unknown>;
  saveQuickOutcome: (
    message: AttentionOutcomeSubmitMessage,
  ) => Promise<AttentionOutcomeSubmitResponse>;
  hoverPreviewResponse: (
    request: HoverPreviewRequest,
  ) => Promise<HoverPreviewResponse>;
  saveMaterialFromCard: (
    request: SaveMaterialRequest,
  ) => Promise<SaveMaterialResponse>;
  recordHoverPreviewEvent: (
    message: HoverPreviewEventMessage,
  ) => Promise<unknown>;
  applyAttentionProgress: (
    message: AttentionSessionProgressMessage,
  ) => Promise<unknown>;
  senderMatchesPage: (
    sender: chrome.runtime.MessageSender,
    pageUrl: string,
  ) => boolean;
  senderIsTrustedExtensionPage: (
    sender: chrome.runtime.MessageSender,
  ) => boolean;
  importBrowserHistory: (
    message: BrowserHistoryImportRequest,
  ) => Promise<BrowserHistoryImportResponse>;
  handleReadwiseRequest: (
    message: ReadwiseRequest,
  ) => Promise<ReadwiseSyncResponse>;
  handleNotionRequest: (message: NotionRequest) => Promise<NotionResponse>;
  handleNovelPassageMessage: (
    message: NovelPassageMessage,
  ) => Promise<NovelPassageActionResponse>;
  reportError?: (input: {
    operation: string;
    code: string;
    error: unknown;
  }) => Promise<void> | void;
}

export function createBackgroundMessageRouter(
  dependencies: BackgroundMessageRouterDependencies,
): (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
) => true | void {
  let progressQueue: Promise<void> = Promise.resolve();
  let memoryQueue: Promise<void> = Promise.resolve();
  let outcomeQueue: Promise<void> = Promise.resolve();
  let savedMaterialsQueue: Promise<SaveMaterialResponse> = Promise.resolve({
    ok: true,
  });
  let novelPassageQueue: Promise<NovelPassageActionResponse> = Promise.resolve({
    ok: true,
  });

  function report(operation: string, code: string, error: unknown): void {
    void Promise.resolve(
      dependencies.reportError?.({ operation, code, error }),
    ).catch(() => undefined);
  }

  function handleLanguage(sendResponse: SendResponse): true {
    void dependencies
      .loadInterfaceLanguage()
      .then((language) => {
        const response: UiLanguageResponse = { ok: true, language };
        sendResponse(response);
      })
      .catch((error) => {
        report('load-language', 'LANGUAGE_LOAD_FAILED', error);
        sendResponse(undefined);
      });
    return true;
  }

  function handleHistoryImport(
    message: BrowserHistoryImportRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: SendResponse,
  ): true | void {
    if (!dependencies.senderIsTrustedExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'unauthorized' });
      return;
    }
    void dependencies
      .importBrowserHistory(message)
      .then(sendResponse)
      .catch((error) => {
        report('import-browser-history', 'HISTORY_IMPORT_FAILED', error);
        sendResponse({ ok: false, error: 'history_import_failed' });
      });
    return true;
  }

  function handleReadwise(
    message: ReadwiseRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: SendResponse,
  ): true | void {
    if (!dependencies.senderIsTrustedExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'unauthorized' });
      return;
    }
    void dependencies
      .handleReadwiseRequest(message)
      .then(sendResponse)
      .catch((error) => {
        report('sync-readwise', 'READWISE_SYNC_FAILED', error);
        sendResponse({ ok: false, error: 'sync_failed' });
      });
    return true;
  }

  function handleNotion(
    message: NotionRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: SendResponse,
  ): true | void {
    if (!dependencies.senderIsTrustedExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'unauthorized' });
      return;
    }
    void dependencies
      .handleNotionRequest(message)
      .then(sendResponse)
      .catch((error) => {
        report('sync-notion', 'NOTION_REQUEST_FAILED', error);
        sendResponse({ ok: false, error: 'request_failed' });
      });
    return true;
  }

  function handleNovelPassage(
    message: NovelPassageMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: SendResponse,
  ): true | void {
    if (!dependencies.senderMatchesPage(sender, message.url)) {
      sendResponse({ ok: false, error: 'unauthorized' });
      return;
    }
    novelPassageQueue = novelPassageQueue
      .catch((error) => {
        report('novel-passage-queue', 'NOVEL_PASSAGE_QUEUE_FAILED', error);
        return { ok: false, error: 'queue_failed' };
      })
      .then(() => dependencies.handleNovelPassageMessage(message));
    void novelPassageQueue.then(sendResponse).catch((error) => {
      report('novel-passage-action', 'NOVEL_PASSAGE_ACTION_FAILED', error);
      sendResponse({ ok: false, error: 'request_failed' });
    });
    return true;
  }

  function handleAutoStart(
    message: AttentionSessionAutoStartMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: SendResponse,
  ): true | void {
    if (!dependencies.senderMatchesPage(sender, message.capture.url)) {
      sendResponse(undefined);
      return;
    }
    void dependencies
      .autoStartSession(message)
      .then(sendResponse)
      .catch((error) => {
        report('auto-start-session', 'AUTO_START_FAILED', error);
        sendResponse(undefined);
      });
    return true;
  }

  function handleOutcomePromptShown(
    message: AttentionOutcomePromptShownMessage,
    sender: chrome.runtime.MessageSender,
  ): void {
    if (!dependencies.senderMatchesPage(sender, message.url)) return;
    outcomeQueue = outcomeQueue
      .then(async () => {
        await dependencies.storageReady;
        await dependencies.markOutcomePromptShown(message.sessionId);
      })
      .catch((error) => {
        report('mark-outcome-prompt', 'OUTCOME_PROMPT_MARK_FAILED', error);
      });
  }

  function handleOutcomeSubmit(
    message: AttentionOutcomeSubmitMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: SendResponse,
  ): true | void {
    if (!dependencies.senderMatchesPage(sender, message.url)) {
      sendResponse({ ok: false });
      return;
    }
    void outcomeQueue
      .then(() => dependencies.saveQuickOutcome(message))
      .then(sendResponse)
      .catch((error) => {
        report('save-outcome', 'OUTCOME_SAVE_FAILED', error);
        sendResponse({ ok: false });
      });
    return true;
  }

  function handleHoverPreview(
    message: HoverPreviewRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: SendResponse,
  ): true | void {
    if (
      message.capture &&
      !dependencies.senderMatchesPage(sender, message.capture.url)
    ) {
      sendResponse(undefined);
      return;
    }
    void dependencies
      .hoverPreviewResponse(message)
      .then(sendResponse)
      .catch((error) => {
        report('hover-preview', 'HOVER_PREVIEW_FAILED', error);
        sendResponse(undefined);
      });
    return true;
  }

  function handleSaveMaterial(
    message: SaveMaterialRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: SendResponse,
  ): true | void {
    if (!dependencies.senderMatchesPage(sender, message.capture.url)) {
      sendResponse({ ok: false });
      return;
    }
    savedMaterialsQueue = savedMaterialsQueue
      .catch((error) => {
        report('save-material-queue', 'SAVE_QUEUE_FAILED', error);
        return { ok: false };
      })
      .then(() => dependencies.saveMaterialFromCard(message));
    void savedMaterialsQueue.then(sendResponse).catch((error) => {
      report('save-material', 'SAVE_MATERIAL_FAILED', error);
      sendResponse({ ok: false });
    });
    return true;
  }

  function handleHoverEvent(message: HoverPreviewEventMessage): void {
    memoryQueue = memoryQueue
      .then(async () => {
        await dependencies.storageReady;
        await dependencies.recordHoverPreviewEvent(message);
      })
      .catch((error) => {
        report('record-hover-event', 'HOVER_EVENT_SAVE_FAILED', error);
      });
  }

  function handleProgress(
    message: AttentionSessionProgressMessage,
    sender: chrome.runtime.MessageSender,
  ): void {
    if (!dependencies.senderMatchesPage(sender, message.url)) return;
    progressQueue = progressQueue
      .then(async () => {
        await dependencies.storageReady;
        await dependencies.applyAttentionProgress(message);
      })
      .catch((error) => {
        report('save-reading-progress', 'READING_PROGRESS_SAVE_FAILED', error);
      });
  }

  return (message, sender, sendResponse): true | void => {
    if (
      message &&
      typeof message === 'object' &&
      (message as Record<string, unknown>).type === UI_LANGUAGE_GET_TYPE
    ) {
      return handleLanguage(sendResponse);
    }
    if (isBrowserHistoryImportRequest(message)) {
      return handleHistoryImport(message, sender, sendResponse);
    }
    if (isReadwiseRequest(message)) {
      return handleReadwise(message, sender, sendResponse);
    }
    if (isNotionRequest(message)) {
      return handleNotion(message, sender, sendResponse);
    }
    if (isNovelPassageMessage(message)) {
      return handleNovelPassage(message, sender, sendResponse);
    }
    if (isAutoStartMessage(message)) {
      return handleAutoStart(message, sender, sendResponse);
    }
    if (isOutcomePromptShownMessage(message)) {
      handleOutcomePromptShown(message, sender);
      return;
    }
    if (isOutcomeSubmitMessage(message)) {
      return handleOutcomeSubmit(message, sender, sendResponse);
    }
    if (isHoverPreviewRequest(message)) {
      return handleHoverPreview(message, sender, sendResponse);
    }
    if (isSaveMaterialRequest(message)) {
      return handleSaveMaterial(message, sender, sendResponse);
    }
    if (isHoverPreviewEvent(message)) {
      handleHoverEvent(message);
      return;
    }
    if (isProgressMessage(message)) handleProgress(message, sender);
  };
}
