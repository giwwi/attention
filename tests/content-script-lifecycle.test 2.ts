import { describe, expect, it, vi } from 'vitest';
import { reinjectContentScriptIntoOpenWebTabs } from '../src/background/content-script-lifecycle';

describe('content-script lifecycle', () => {
  it('refreshes existing web tabs after an extension update', async () => {
    const query = vi.fn().mockResolvedValue([
      { id: 11, url: 'https://example.com/article' },
      { id: 12, url: 'http://example.org/feed' },
      { id: 13, url: 'https://example.net/discarded', discarded: true },
    ]);
    const executeScript = vi.fn().mockResolvedValue([]);

    await expect(
      reinjectContentScriptIntoOpenWebTabs({ query }, { executeScript }),
    ).resolves.toEqual({
      matchedTabs: 3,
      injectedTabs: 2,
      failedTabs: 0,
    });
    expect(query).toHaveBeenCalledWith({
      url: ['http://*/*', 'https://*/*'],
    });
    expect(executeScript).toHaveBeenNthCalledWith(1, {
      target: { tabId: 11 },
      files: ['content.js'],
    });
    expect(executeScript).toHaveBeenNthCalledWith(2, {
      target: { tabId: 12 },
      files: ['content.js'],
    });
  });

  it('continues when one existing tab rejects injection', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 21 }, { id: 22 }]);
    const executeScript = vi
      .fn()
      .mockRejectedValueOnce(new Error('Tab is unavailable'))
      .mockResolvedValueOnce([]);

    await expect(
      reinjectContentScriptIntoOpenWebTabs({ query }, { executeScript }),
    ).resolves.toEqual({
      matchedTabs: 2,
      injectedTabs: 1,
      failedTabs: 1,
    });
  });
});
