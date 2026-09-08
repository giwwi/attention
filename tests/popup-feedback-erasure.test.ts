import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FeedbackController } from '../src/popup/controllers/feedback-controller';
import {
  getEligibleOutcomeSession,
  markOutcomePromptShown,
} from '../src/attention/storage';
import { recordActualUtility } from '../src/utility/storage';
import {
  beginDataOperation,
  DATA_GENERATION_KEY,
} from '../src/privacy/data-operations';
import type { AttentionSessionRecord } from '../src/shared/types';
import { DataTestStorage, installDataLocks } from './helpers/data-locks';

vi.mock('../src/attention/storage', () => ({
  getEligibleOutcomeSession: vi.fn(),
  markOutcomePromptShown: vi.fn(async () => {}),
  applyAttentionProgress: vi.fn(),
  recordMaterialOutcome: vi.fn(),
}));
vi.mock('../src/utility/storage', () => ({
  recordActualUtility: vi.fn(),
  getUtilityFeedbackStats: vi.fn(async () => ({ total: 0 })),
}));
vi.mock('../src/memory/material-memory', () => ({
  recordMaterialActualUtility: vi.fn(),
}));
let storage: DataTestStorage;
let feedback: FeedbackController;
const session = {
  id: 'private-session',
  url: 'https://example.com/private',
  title: 'Private article',
  expected: { predictedUtility: 70 },
} as AttentionSessionRecord;
beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.innerHTML = new DOMParser().parseFromString(
    readFileSync('tests/fixtures/popup-controller.html', 'utf8'),
    'text/html',
  ).documentElement.innerHTML;
  storage = new DataTestStorage();
  vi.stubGlobal('chrome', { storage: { local: storage.area } });
  installDataLocks();
  feedback = new FeedbackController({
    status: document.querySelector<HTMLParagraphElement>('#status')!,
    getLanguage: () => 'en',
  });
});
afterEach(() => vi.unstubAllGlobals());

it('rejects a slider rating on a pre-erasure session before the change event arrives', async () => {
  vi.mocked(getEligibleOutcomeSession).mockResolvedValue(session);
  await feedback.restorePrompt(session.url, await beginDataOperation());
  await storage.clear();
  await storage.set({ [DATA_GENERATION_KEY]: 'erased' });
  document.querySelector<HTMLButtonElement>('#save-actual-utility')!.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(recordActualUtility).not.toHaveBeenCalled();
  expect(storage.data).toEqual({ [DATA_GENERATION_KEY]: 'erased' });
});

it('does not restore a delayed session after popup invalidation', async () => {
  let resolve!: (value: AttentionSessionRecord) => void;
  vi.mocked(getEligibleOutcomeSession).mockReturnValue(
    new Promise((value) => {
      resolve = value;
    }),
  );
  const pending = feedback.restorePrompt(
    session.url,
    await beginDataOperation(),
  );
  feedback.resetForCapture();
  resolve(session);
  await pending;
  expect(document.querySelector<HTMLElement>('#outcome-prompt')!.hidden).toBe(
    true,
  );
  expect(markOutcomePromptShown).not.toHaveBeenCalled();
});
