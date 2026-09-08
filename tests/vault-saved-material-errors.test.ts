import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { SavedMaterialsController } from '../src/popup/controllers/saved-materials-controller';
import { SAVED_MATERIALS_KEY } from '../src/popup/storage-keys';
import type { PageCapture, SavedMaterial } from '../src/shared/types';

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('../src/vault/storage', () => ({ privateStorage: storage }));

function capture(url: string, title: string): PageCapture {
  return {
    title,
    url,
    content: 'Saved article content',
    excerpt: 'Article excerpt',
    byline: null,
    siteName: 'Example',
    publishedTime: null,
    language: 'en',
    wordCount: 3,
    readingTimeMinutes: 1,
    headings: ['Section'],
    isArticle: true,
    extractionMethod: 'semantic',
    capturedAt: '2026-09-06T12:00:00.000Z',
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  document.documentElement.innerHTML = new DOMParser().parseFromString(
    readFileSync('tests/fixtures/popup-controller.html', 'utf8'),
    'text/html',
  ).documentElement.innerHTML;
});

it('preserves existing articles and propagates a non-quota save failure without retrying a reduced list', async () => {
  const existing: SavedMaterial = {
    capture: capture('https://example.com/existing', 'Existing article'),
    savedAt: '2026-09-01T12:00:00.000Z',
  };
  let persisted = [existing];
  storage.get.mockImplementation(async () => ({
    [SAVED_MATERIALS_KEY]: structuredClone(persisted),
  }));
  storage.set.mockImplementation(async (values: Record<string, unknown>) => {
    persisted = structuredClone(values[SAVED_MATERIALS_KEY] as SavedMaterial[]);
  });
  const failure = new Error('Encrypted storage could not be updated.');
  storage.set.mockRejectedValueOnce(failure);
  const controller = new SavedMaterialsController({
    status: document.querySelector<HTMLParagraphElement>('#status')!,
    settingsHome: document.querySelector<HTMLElement>('#settings-home')!,
    aiSettingsPanel: document.querySelector<HTMLElement>('#ai-settings')!,
    readwiseSettingsPanel:
      document.querySelector<HTMLElement>('#readwise-settings')!,
    privacySettingsPanel:
      document.querySelector<HTMLElement>('#privacy-settings')!,
    result: document.querySelector<HTMLElement>('#result')!,
    getLanguage: () => 'en',
    isMainStarted: () => true,
  });
  await controller.refresh();
  const incoming = capture('https://example.com/new', 'Incoming article');

  await expect(controller.save(incoming)).rejects.toBe(failure);

  expect(storage.set).toHaveBeenCalledTimes(1);
  const attempted = storage.set.mock.calls[0]![0][
    SAVED_MATERIALS_KEY
  ] as SavedMaterial[];
  expect(attempted.map((item) => item.capture.url)).toEqual([
    incoming.url,
    existing.capture.url,
  ]);
  expect(persisted).toEqual([existing]);
  expect(document.querySelector('#saved-materials-count')?.textContent).toBe(
    '1',
  );
  expect(
    document.querySelector('#saved-materials-list')?.textContent,
  ).toContain('Existing article');
  expect(
    document.querySelector('#saved-materials-list')?.textContent,
  ).not.toContain('Incoming article');
});
