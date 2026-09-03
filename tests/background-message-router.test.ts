import { describe, expect, it, vi } from 'vitest';
import {
  ATTENTION_OUTCOME_PROMPT_SHOWN_TYPE,
  ATTENTION_OUTCOME_SUBMIT_TYPE,
  ATTENTION_SESSION_AUTO_START_TYPE,
  ATTENTION_SESSION_PROGRESS_TYPE,
  HOVER_PREVIEW_EVENT_TYPE,
  SAVE_MATERIAL_REQUEST_TYPE,
  UI_LANGUAGE_GET_TYPE,
  type PageCapture,
} from '../src/shared/types';
import {
  createBackgroundMessageRouter,
  type BackgroundMessageRouterDependencies,
} from '../src/background/message-router';
import { BROWSER_HISTORY_IMPORT_TYPE } from '../src/history/messages';
import { READWISE_CONNECT_TYPE } from '../src/readwise/messages';
import { NOVEL_PASSAGE_FEEDBACK_TYPE } from '../src/novelty/messages';

const capture: PageCapture = {
  title: 'Useful article',
  url: 'https://example.com/article',
  content: 'Article text '.repeat(100),
  excerpt: 'Article text',
  byline: 'Author',
  siteName: 'Example',
  publishedTime: null,
  language: 'en',
  wordCount: 200,
  readingTimeMinutes: 1,
  headings: ['Introduction'],
  isArticle: true,
  extractionMethod: 'readability',
  capturedAt: '2026-08-27T08:00:00.000Z',
};

const sender = { tab: { url: capture.url } } as chrome.runtime.MessageSender;

function createDependencies(
  overrides: Partial<BackgroundMessageRouterDependencies> = {},
): BackgroundMessageRouterDependencies {
  return {
    storageReady: Promise.resolve(),
    loadInterfaceLanguage: vi.fn().mockResolvedValue('ru'),
    autoStartSession: vi.fn().mockResolvedValue({
      ok: true,
      session: {
        sessionId: 'session-1',
        url: capture.url,
        decision: 'read',
        estimatedReadingSeconds: 60,
        sampledForOutcome: false,
        promptShownCount: 0,
      },
    }),
    markOutcomePromptShown: vi.fn().mockResolvedValue(undefined),
    saveQuickOutcome: vi.fn().mockResolvedValue({ ok: true }),
    hoverPreviewResponse: vi.fn().mockResolvedValue({
      ok: true,
      preview: {
        scenario: 'work',
        utilityScore: 70,
        recommendedAction: 'open',
        reason: 'Relevant',
        expectedValue: 'One useful idea',
        risk: '',
        confidence: 'medium',
        source: 'full-analysis',
        signalIds: [],
        calibrationSampleSize: 0,
      },
    }),
    saveMaterialFromCard: vi.fn().mockResolvedValue({
      ok: true,
      savedCount: 1,
    }),
    recordHoverPreviewEvent: vi.fn().mockResolvedValue(undefined),
    applyAttentionProgress: vi.fn().mockResolvedValue(undefined),
    senderMatchesPage: vi.fn().mockReturnValue(true),
    senderIsTrustedExtensionPage: vi.fn().mockReturnValue(true),
    importBrowserHistory: vi.fn().mockResolvedValue({
      ok: true,
      processedUrlCount: 12,
      totalVisitCount: 20,
      excludedUrlCount: 3,
      permissionRevoked: true,
    }),
    handleReadwiseRequest: vi.fn().mockResolvedValue({
      ok: true,
      sourceCount: 2,
      highlightCount: 4,
      noteCount: 1,
    }),
    handleNovelPassageMessage: vi.fn().mockResolvedValue({ ok: true }),
    handleNotionRequest: vi.fn().mockResolvedValue({
      ok: true,
      settings: {
        connected: false,
        workspaceName: null,
        workspaceId: null,
        sourceMode: 'mixed',
        lastSyncedAt: null,
        pageCount: 0,
        fragmentCount: 0,
        excludedPageCount: 0,
      },
    }),
    ...overrides,
  };
}

describe('background message router', () => {
  it('keeps the language request response contract asynchronous', async () => {
    const dependencies = createDependencies();
    const route = createBackgroundMessageRouter(dependencies);
    const sendResponse = vi.fn();

    expect(route({ type: UI_LANGUAGE_GET_TYPE }, sender, sendResponse)).toBe(
      true,
    );
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, language: 'ru' });
    });
  });

  it('imports browser history only from a trusted extension page', async () => {
    const dependencies = createDependencies();
    const route = createBackgroundMessageRouter(dependencies);
    const sendResponse = vi.fn();

    expect(
      route(
        { type: BROWSER_HISTORY_IMPORT_TYPE, lookbackDays: 30 },
        sender,
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => {
      expect(dependencies.importBrowserHistory).toHaveBeenCalledWith({
        type: BROWSER_HISTORY_IMPORT_TYPE,
        lookbackDays: 30,
      });
    });
  });

  it('rejects browser history requests from page content scripts', () => {
    const importBrowserHistory = vi.fn();
    const route = createBackgroundMessageRouter(
      createDependencies({
        importBrowserHistory,
        senderIsTrustedExtensionPage: vi.fn().mockReturnValue(false),
      }),
    );
    const sendResponse = vi.fn();

    expect(
      route(
        { type: BROWSER_HISTORY_IMPORT_TYPE, lookbackDays: 30 },
        sender,
        sendResponse,
      ),
    ).toBeUndefined();
    expect(importBrowserHistory).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: 'unauthorized',
    });
  });

  it('routes Readwise sync only from a trusted extension page', async () => {
    const handleReadwiseRequest = vi.fn().mockResolvedValue({
      ok: true,
      sourceCount: 3,
      highlightCount: 8,
      noteCount: 2,
    });
    const route = createBackgroundMessageRouter(
      createDependencies({ handleReadwiseRequest }),
    );
    const sendResponse = vi.fn();
    const message = {
      type: READWISE_CONNECT_TYPE,
      token: 'readwise-test-token',
    } as const;

    expect(route(message, sender, sendResponse)).toBe(true);
    await vi.waitFor(() => {
      expect(handleReadwiseRequest).toHaveBeenCalledWith(message);
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, highlightCount: 8 }),
      );
    });

    const untrustedHandler = vi.fn();
    const untrustedRoute = createBackgroundMessageRouter(
      createDependencies({
        handleReadwiseRequest: untrustedHandler,
        senderIsTrustedExtensionPage: vi.fn().mockReturnValue(false),
      }),
    );
    const untrustedResponse = vi.fn();
    expect(untrustedRoute(message, sender, untrustedResponse)).toBeUndefined();
    expect(untrustedHandler).not.toHaveBeenCalled();
    expect(untrustedResponse).toHaveBeenCalledWith({
      ok: false,
      error: 'unauthorized',
    });
  });

  it('accepts passage feedback only from the page it describes', async () => {
    const handleNovelPassageMessage = vi.fn().mockResolvedValue({ ok: true });
    const route = createBackgroundMessageRouter(
      createDependencies({ handleNovelPassageMessage }),
    );
    const sendResponse = vi.fn();
    const message = {
      type: NOVEL_PASSAGE_FEEDBACK_TYPE,
      url: capture.url,
      title: capture.title,
      claim: 'A sufficiently long claim for the feedback contract.',
      excerpt:
        'The exact source passage selected by the user is stored locally.',
      value: 'new',
    } as const;

    expect(route(message, sender, sendResponse)).toBe(true);
    await vi.waitFor(() => {
      expect(handleNovelPassageMessage).toHaveBeenCalledWith(message);
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    const rejectedHandler = vi.fn();
    const rejectedRoute = createBackgroundMessageRouter(
      createDependencies({
        handleNovelPassageMessage: rejectedHandler,
        senderMatchesPage: vi.fn().mockReturnValue(false),
      }),
    );
    const rejectedResponse = vi.fn();
    expect(rejectedRoute(message, sender, rejectedResponse)).toBeUndefined();
    expect(rejectedHandler).not.toHaveBeenCalled();
    expect(rejectedResponse).toHaveBeenCalledWith({
      ok: false,
      error: 'unauthorized',
    });
  });

  it('rejects page-bound requests from a different sender', () => {
    const autoStartSession = vi.fn();
    const dependencies = createDependencies({
      autoStartSession,
      senderMatchesPage: vi.fn().mockReturnValue(false),
    });
    const route = createBackgroundMessageRouter(dependencies);
    const sendResponse = vi.fn();

    expect(
      route(
        { type: ATTENTION_SESSION_AUTO_START_TYPE, capture },
        sender,
        sendResponse,
      ),
    ).toBeUndefined();
    expect(autoStartSession).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(undefined);
  });

  it('serializes reading progress updates in arrival order', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstUpdate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const applyAttentionProgress = vi
      .fn()
      .mockImplementationOnce(() => firstUpdate)
      .mockResolvedValue(undefined);
    const route = createBackgroundMessageRouter(
      createDependencies({ applyAttentionProgress }),
    );
    const first = {
      type: ATTENTION_SESSION_PROGRESS_TYPE,
      sessionId: 'session-1',
      url: capture.url,
      visibleSeconds: 10,
      maxScrollDepth: 25,
      ended: false,
      recordedAt: '2026-08-27T08:01:00.000Z',
    } as const;
    const second = {
      ...first,
      visibleSeconds: 20,
      maxScrollDepth: 50,
      recordedAt: '2026-08-27T08:02:00.000Z',
    } as const;

    route(first, sender, vi.fn());
    route(second, sender, vi.fn());

    await vi.waitFor(() =>
      expect(applyAttentionProgress).toHaveBeenCalledTimes(1),
    );
    releaseFirst?.();
    await vi.waitFor(() =>
      expect(applyAttentionProgress).toHaveBeenCalledTimes(2),
    );
    expect(
      applyAttentionProgress.mock.calls.map(([message]) => message),
    ).toEqual([first, second]);
  });

  it('serializes save requests without changing their responses', async () => {
    let releaseFirst:
      ((value: { ok: true; savedCount: number }) => void) | undefined;
    const firstSave = new Promise<{ ok: true; savedCount: number }>(
      (resolve) => {
        releaseFirst = resolve;
      },
    );
    const saveMaterialFromCard = vi
      .fn()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue({ ok: true, savedCount: 2 });
    const route = createBackgroundMessageRouter(
      createDependencies({ saveMaterialFromCard }),
    );
    const firstResponse = vi.fn();
    const secondResponse = vi.fn();
    const message = { type: SAVE_MATERIAL_REQUEST_TYPE, capture } as const;

    expect(route(message, sender, firstResponse)).toBe(true);
    expect(route(message, sender, secondResponse)).toBe(true);
    await vi.waitFor(() =>
      expect(saveMaterialFromCard).toHaveBeenCalledTimes(1),
    );

    releaseFirst?.({ ok: true, savedCount: 1 });
    await vi.waitFor(() =>
      expect(saveMaterialFromCard).toHaveBeenCalledTimes(2),
    );
    await vi.waitFor(() => {
      expect(firstResponse).toHaveBeenCalledWith({ ok: true, savedCount: 1 });
      expect(secondResponse).toHaveBeenCalledWith({ ok: true, savedCount: 2 });
    });
  });

  it('routes outcome and hover events to their dedicated handlers', async () => {
    const markOutcomePromptShown = vi.fn().mockResolvedValue(undefined);
    const saveQuickOutcome = vi.fn().mockResolvedValue({ ok: true });
    const recordHoverPreviewEvent = vi.fn().mockResolvedValue(undefined);
    const route = createBackgroundMessageRouter(
      createDependencies({
        markOutcomePromptShown,
        saveQuickOutcome,
        recordHoverPreviewEvent,
      }),
    );
    const outcomeResponse = vi.fn();

    route(
      {
        type: ATTENTION_OUTCOME_PROMPT_SHOWN_TYPE,
        sessionId: 'session-1',
        url: capture.url,
      },
      sender,
      vi.fn(),
    );
    expect(
      route(
        {
          type: ATTENTION_OUTCOME_SUBMIT_TYPE,
          sessionId: 'session-1',
          url: capture.url,
          outcome: 'yes',
        },
        sender,
        outcomeResponse,
      ),
    ).toBe(true);
    route(
      {
        type: HOVER_PREVIEW_EVENT_TYPE,
        event: 'shown',
        scenario: 'work',
        url: capture.url,
        title: capture.title,
        verdict: 'read',
        recommendedAction: 'open',
        source: 'full-analysis',
        signalIds: [],
        occurredAt: '2026-08-27T08:03:00.000Z',
      },
      sender,
      vi.fn(),
    );

    await vi.waitFor(() => {
      expect(markOutcomePromptShown).toHaveBeenCalledWith('session-1');
      expect(saveQuickOutcome).toHaveBeenCalledTimes(1);
      expect(outcomeResponse).toHaveBeenCalledWith({ ok: true });
      expect(recordHoverPreviewEvent).toHaveBeenCalledTimes(1);
    });
  });
});
