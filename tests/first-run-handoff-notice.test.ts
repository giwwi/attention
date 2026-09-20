import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  firstRunNoticePublisher,
  loadFirstRunHandoffNotice,
} from '../src/onboarding/handoff/first-run-notice';
import {
  createProfileHandoffState,
  PROFILE_IMPORT_HANDOFF_MAX_AGE_MS,
} from '../src/onboarding/handoff/state';

const KEY = 'attentionFirstRunHandoffNotice';
let stored: Record<string, unknown>;
let contexts: {
  documentId: string;
  tabId: number;
  contextType: string;
  documentUrl: string;
}[];
const state = () => ({
  ...createProfileHandoffState('chatgpt'),
  method: 'clipboard-and-web' as const,
  promptCopied: true,
});

beforeEach(() => {
  stored = {};
  contexts = [
    {
      documentId: 'setup-one',
      tabId: 7,
      contextType: 'TAB',
      documentUrl: 'chrome-extension://attention/popup.html?profileSetup=1',
    },
  ];
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (path: string) => `chrome-extension://attention/${path}`,
      getContexts: async (filter: {
        tabIds?: number[];
        documentIds?: string[];
      }) =>
        contexts.filter(
          (context) =>
            (!filter.tabIds || filter.tabIds.includes(context.tabId)) &&
            (!filter.documentIds ||
              filter.documentIds.includes(context.documentId)),
        ),
    },
    storage: {
      session: {
        get: async (key: string) => ({ [key]: stored[key] }),
        set: async (items: Record<string, unknown>) => {
          Object.assign(stored, structuredClone(items));
        },
        remove: async (key: string) => {
          delete stored[key];
        },
      },
    },
  });
  let tail = Promise.resolve<unknown>(undefined);
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_key: string, callback: () => Promise<unknown>) => {
        const next = tail.then(callback);
        tail = next.catch(() => undefined);
        return next;
      },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('first-run public prompt notice', () => {
  it('stores only public flags in session memory, not draft fields or profile text', async () => {
    const publisher = await firstRunNoticePublisher(7);
    await publisher.save(
      {
        ...state(),
        generation: 'private-generation',
        sourceTabId: 9,
        vaultEpoch: 'private-epoch',
      },
      'ru',
    );
    expect(stored[KEY]).toEqual({
      ownerDocumentId: 'setup-one',
      startedAt: expect.any(String),
      profileImportProvider: 'chatgpt',
      profileImportStage: 'waiting-for-response',
      method: 'clipboard-and-web',
      promptCopied: true,
      language: 'ru',
    });
    expect(await loadFirstRunHandoffNotice()).toEqual(stored[KEY]);
  });
  it.each(['closed', 'reloaded'])(
    'invalidates the handoff when setup is %s',
    async (action) => {
      const publisher = await firstRunNoticePublisher(7);
      await publisher.save(state(), 'en');
      contexts =
        action === 'closed'
          ? []
          : [{ ...contexts[0]!, documentId: 'reloaded-document' }];
      expect(await loadFirstRunHandoffNotice()).toBeNull();
    },
  );
  it('does not revive an expired or future handoff', async () => {
    const publisher = await firstRunNoticePublisher(7);
    for (const offset of [-PROFILE_IMPORT_HANDOFF_MAX_AGE_MS - 1000, 60_000]) {
      await publisher.save(
        { ...state(), startedAt: new Date(Date.now() + offset).toISOString() },
        'en',
      );
      expect(await loadFirstRunHandoffNotice()).toBeNull();
    }
  });
  it('clears its own notice when switching away from ChatGPT', async () => {
    const publisher = await firstRunNoticePublisher(7);
    await publisher.save(state(), 'en');
    await publisher.save(createProfileHandoffState('claude'), 'en');
    expect(await loadFirstRunHandoffNotice()).toBeNull();
  });
  it('cannot remove a newer notice belonging to a different setup tab', async () => {
    const first = await firstRunNoticePublisher(7);
    contexts.push({ ...contexts[0]!, tabId: 8, documentId: 'setup-two' });
    const second = await firstRunNoticePublisher(8);
    await first.save(state(), 'en');
    await Promise.all([second.save(state(), 'de'), first.clear()]);
    expect(await loadFirstRunHandoffNotice()).toMatchObject({
      ownerDocumentId: 'setup-two',
      language: 'de',
    });
    await second.clear();
    expect(await loadFirstRunHandoffNotice()).toBeNull();
  });
  it('cannot create a notice from an ordinary website tab', async () => {
    contexts[0]!.documentUrl = 'https://chatgpt.com/';
    const publisher = await firstRunNoticePublisher(7);
    await publisher.save(state(), 'en');
    expect(stored).toEqual({});
  });
});
