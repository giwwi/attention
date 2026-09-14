import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivacyController } from '../src/popup/controllers/privacy-controller';
import { AI_ANALYSIS_DIAGNOSTIC_KEY } from '../src/diagnostics/ai-analysis';
import { DataTestStorage, installDataLocks } from './helpers/data-locks';

let local: DataTestStorage;
let downloaded: Blob | undefined;
beforeEach(() => {
  installDataLocks();
  local = new DataTestStorage();
  downloaded = undefined;
  vi.stubGlobal('chrome', {
    storage: { local, session: new DataTestStorage() },
  });
  document.body.innerHTML = readFileSync('public/popup.html', 'utf8');
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn((blob: Blob) => {
        downloaded = blob;
        return 'blob:test-report';
      }),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const element = document.createElement('section');
  const controller = new PrivacyController({
    status: document.createElement('p'),
    getLanguage: () => 'ru',
    settingsHome: element,
    savedMaterialsView: element,
    aiSettingsPanel: element,
    readwiseSettingsPanel: element,
    result: element,
    isMainStarted: () => true,
    onModeChanged: () => {},
  });
  controller.translate();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AI report download in actual popup markup', () => {
  it('explains how to create a report when no analysis was run', async () => {
    document.querySelector<HTMLButtonElement>('#export-ai-analysis')!.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector('#ai-report-status')?.textContent,
      ).toContain('Отчёта пока нет'),
    );
    expect(downloaded).toBeUndefined();
  });
  it('downloads JSON from the new button and excludes private stored fields', async () => {
    await local.set({
      [AI_ANALYSIS_DIAGNOSTIC_KEY]: {
        pageUrl: 'https://example.com/PRIVATE_SENTINEL',
        report: {
          analysisId: crypto.randomUUID(),
          at: new Date().toISOString(),
          model: 'google/gemini-2.5-flash-lite',
          status: 'complete',
          stage: 'complete',
          input: {},
          output: { returned: 0 },
          display: null,
          secret: 'PRIVATE_SENTINEL',
        },
      },
    });
    document.querySelector<HTMLButtonElement>('#export-ai-analysis')!.click();
    await vi.waitFor(() => expect(downloaded).toBeDefined());
    const contents = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(downloaded!);
    });
    expect(contents).not.toContain('PRIVATE_SENTINEL');
    expect(JSON.parse(contents)).toMatchObject({
      status: 'complete',
      output: { returned: 0 },
      display: null,
    });
    expect(document.querySelector('#ai-report-status')?.textContent).toContain(
      'Отчёт скачан',
    );
  });
});
