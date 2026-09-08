import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARD_ANALYSIS_CONTEXT_KEY,
  createCardContextMessageHandler,
  loadCardContext,
} from '../src/background/card-context';
import {
  ATTENTION_CONTEXT_GET_TYPE,
  ATTENTION_CONTEXT_UPDATE_TYPE,
  type ContextResponse,
} from '../src/shared/card-messages';
import type { AnalysisContext } from '../src/shared/types';
import { SCENARIO_STATE_KEY } from '../src/scenario/scenario';
import { deleteAllAttentionData } from '../src/privacy/data-erasure';
import { DATA_GENERATION_KEY } from '../src/privacy/data-operations';
import { DataTestStorage, installDataLocks } from './helpers/data-locks';

let local: DataTestStorage;
let session: DataTestStorage;
beforeEach(() => {
  installDataLocks();
  local = new DataTestStorage();
  session = new DataTestStorage();
  vi.stubGlobal('chrome', { storage: { local, session } });
});
afterEach(() => vi.unstubAllGlobals());

const url = 'https://example.com/article';
const sender = {
  frameId: 0,
  url,
  tab: { id: 7, url },
} as chrome.runtime.MessageSender;
const work: AnalysisContext = {
  scenario: 'work',
  intent: 'Compare practical options',
  availableMinutes: 15,
  relaxIntent: null,
  desiredEffort: null,
  leisureFormats: [],
};
const relax: AnalysisContext = {
  scenario: 'relax',
  intent: 'Find an enjoyable essay',
  availableMinutes: 5,
  relaxIntent: 'interesting',
  desiredEffort: 'low',
  leisureFormats: ['essays'],
};

function createHandler(storageReady = Promise.resolve()) {
  return createCardContextMessageHandler({ storageReady, storage: local.area });
}

describe('article card context boundary', () => {
  it('returns only bounded context fields from one settings snapshot', async () => {
    local.data = {
      [CARD_ANALYSIS_CONTEXT_KEY]: {
        ...work,
        personalProfile: { secret: 'private profile should never leave' },
        apiKey: 'hidden-key',
      },
      [SCENARIO_STATE_KEY]: { ...relax, scenarioSource: 'manual' },
      personalProfile: { secret: 'private profile should never leave' },
    };
    const response = vi.fn();
    expect(
      createHandler()(
        { type: ATTENTION_CONTEXT_GET_TYPE, url },
        sender,
        response,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledOnce());
    expect(response).toHaveBeenCalledWith({
      ok: true,
      context: { ...relax, intent: work.intent, availableMinutes: 15 },
    });
    expect(JSON.stringify(response.mock.calls)).not.toContain(
      'private profile',
    );
    expect(JSON.stringify(response.mock.calls)).not.toContain('hidden-key');
    // Reading the normalized DTO never migrates or rewrites private storage.
    expect(local.data[CARD_ANALYSIS_CONTEXT_KEY]).toHaveProperty('apiKey');
  });

  it('updates scenario metadata and analysis context together', async () => {
    const set = vi.spyOn(local, 'set');
    const response = vi.fn();
    createHandler()(
      { type: ATTENTION_CONTEXT_UPDATE_TYPE, url, context: relax },
      sender,
      response,
    );
    await vi.waitFor(() =>
      expect(response).toHaveBeenCalledWith({ ok: true, context: relax }),
    );
    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({
      [CARD_ANALYSIS_CONTEXT_KEY]: relax,
      [SCENARIO_STATE_KEY]: expect.objectContaining({
        scenario: 'relax',
        scenarioSource: 'manual',
        scenarioUpdatedAt: expect.any(String),
        relaxIntent: 'interesting',
        desiredEffort: 'low',
        leisureFormats: ['essays'],
      }),
    });
    expect(await loadCardContext(local.area)).toEqual(relax);
  });

  it.each([
    { ...sender, frameId: 1 },
    { ...sender, frameId: undefined },
    { ...sender, tab: undefined },
    { ...sender, tab: { id: 7, url: 'https://example.com/other' } },
    { ...sender, tab: { id: 7, url: 'https://elsewhere.example/article' } },
  ])(
    'rejects reads and writes from a non-matching top document: %j',
    (untrusted) => {
      const handler = createHandler();
      const response = vi.fn();
      handler(
        { type: ATTENTION_CONTEXT_GET_TYPE, url },
        untrusted as chrome.runtime.MessageSender,
        response,
      );
      handler(
        { type: ATTENTION_CONTEXT_UPDATE_TYPE, url, context: relax },
        untrusted as chrome.runtime.MessageSender,
        response,
      );
      expect(response.mock.calls).toEqual([
        [{ ok: false, reason: 'unavailable' }],
        [{ ok: false, reason: 'unavailable' }],
      ]);
      expect(local.data).toEqual({});
    },
  );

  it.each([
    { availableMinutes: 10 },
    { availableMinutes: '15' },
    { scenario: 'unknown' },
    { intent: 'x'.repeat(181) },
    { relaxIntent: 'unknown' },
    { desiredEffort: 'unknown' },
    { leisureFormats: Array.from({ length: 7 }, () => 'essay') },
    { leisureFormats: ['x'.repeat(81)] },
    { leisureFormats: [42] },
    { personalProfile: { secret: 'must not be accepted' } },
  ])('rejects invalid context without writing it: %j', (invalid) => {
    const response = vi.fn();
    createHandler()(
      {
        type: ATTENTION_CONTEXT_UPDATE_TYPE,
        url,
        context: { ...work, ...invalid },
      },
      sender,
      response,
    );
    expect(response).toHaveBeenCalledWith({
      ok: false,
      reason: 'invalid_context',
    });
    expect(local.data).toEqual({});
  });

  it('serializes rapid updates and the following GET in arrival order', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalSet = local.set.bind(local);
    const set = vi
      .spyOn(local, 'set')
      .mockImplementationOnce(async (values) => {
        await pending;
        await originalSet(values);
      });
    const handler = createHandler();
    const first = vi.fn();
    const second = vi.fn();
    const read = vi.fn();
    handler(
      { type: ATTENTION_CONTEXT_UPDATE_TYPE, url, context: work },
      sender,
      first,
    );
    await vi.waitFor(() => expect(set).toHaveBeenCalledOnce());
    handler(
      { type: ATTENTION_CONTEXT_UPDATE_TYPE, url, context: relax },
      sender,
      second,
    );
    handler({ type: ATTENTION_CONTEXT_GET_TYPE, url }, sender, read);
    expect(second).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() =>
      expect(read).toHaveBeenCalledWith({ ok: true, context: relax }),
    );
    expect(first).toHaveBeenCalledWith({ ok: true, context: work });
    expect(second).toHaveBeenCalledWith({ ok: true, context: relax });
    expect(
      set.mock.calls.map(([values]) => values[CARD_ANALYSIS_CONTEXT_KEY]),
    ).toEqual([work, relax]);
    expect(await loadCardContext(local.area)).toEqual(relax);
  });

  it('cancels accepted reads and updates across erasure, then accepts a fresh user action', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = createHandler(pending);
    const first = vi.fn();
    const second = vi.fn();
    const read = vi.fn();
    handler(
      { type: ATTENTION_CONTEXT_UPDATE_TYPE, url, context: work },
      sender,
      first,
    );
    handler(
      { type: ATTENTION_CONTEXT_UPDATE_TYPE, url, context: relax },
      sender,
      second,
    );
    handler({ type: ATTENTION_CONTEXT_GET_TYPE, url }, sender, read);
    await deleteAllAttentionData(
      local.area,
      session.area,
      async () => undefined,
    );
    release();
    await vi.waitFor(() =>
      expect(read).toHaveBeenCalledWith({ ok: false, reason: 'cancelled' }),
    );
    expect(first).toHaveBeenCalledWith({ ok: false, reason: 'cancelled' });
    expect(second).toHaveBeenCalledWith({ ok: false, reason: 'cancelled' });
    expect(Object.keys(local.data)).toEqual([DATA_GENERATION_KEY]);
    const fresh = new Promise<ContextResponse>((resolve) => {
      handler(
        { type: ATTENTION_CONTEXT_UPDATE_TYPE, url, context: relax },
        sender,
        resolve,
      );
    });
    expect(await fresh).toEqual({ ok: true, context: relax });
  });
});
