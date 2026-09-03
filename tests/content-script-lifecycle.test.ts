import { describe, expect, it, vi } from 'vitest';
import {
  ensureContentScriptInTab,
  ensureContentScriptInOpenWebTabs,
  reinjectContentScriptIntoOpenWebTabs,
} from '../src/background/content-script-lifecycle';
import { CONTENT_RUNTIME_PING_TYPE } from '../src/shared/types';
import { EXTENSION_RUNTIME_VERSION } from '../src/shared/version';

describe('content-script lifecycle', () => {
  it('repairs existing web tabs that have no receiving runtime', async () => {
    const query = vi.fn().mockResolvedValue([
      { id: 11, url: 'https://example.com/article' },
      { id: 12, url: 'http://example.org/feed' },
      { id: 13, url: 'https://example.net/discarded', discarded: true },
    ]);
    let pingCount = 0;
    const sendMessage = vi.fn().mockImplementation(() => {
      pingCount += 1;
      if (pingCount <= 2) return Promise.reject(new Error('No receiver'));
      return Promise.resolve({
        ok: true,
        version: EXTENSION_RUNTIME_VERSION,
      });
    });
    const executeScript = vi.fn().mockResolvedValue([]);

    await expect(
      reinjectContentScriptIntoOpenWebTabs(
        { query, sendMessage },
        { executeScript },
      ),
    ).resolves.toEqual({
      matchedTabs: 3,
      activeTabs: 0,
      injectedTabs: 2,
      failedTabs: 0,
      firstError: null,
    });
    expect(query).toHaveBeenCalledWith({
      url: ['http://*/*', 'https://*/*'],
    });
    expect(sendMessage).toHaveBeenNthCalledWith(1, 11, {
      type: CONTENT_RUNTIME_PING_TYPE,
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 12, {
      type: CONTENT_RUNTIME_PING_TYPE,
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

  it('does not reinject when the current runtime already responds', async () => {
    const query = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      version: EXTENSION_RUNTIME_VERSION,
    });
    const executeScript = vi.fn();

    await expect(
      ensureContentScriptInTab(
        { id: 21, url: 'https://example.com/article' },
        { query, sendMessage },
        { executeScript },
      ),
    ).resolves.toEqual({ tabId: 21, state: 'active' });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('repairs only missing runtimes during a service-worker startup sweep', async () => {
    const query = vi.fn().mockResolvedValue([
      { id: 22, url: 'https://example.com/already-active' },
      { id: 23, url: 'https://example.com/open-before-reload' },
    ]);
    const sendMessage = vi.fn().mockImplementation((tabId: number) => {
      if (tabId === 22) {
        return Promise.resolve({
          ok: true,
          version: EXTENSION_RUNTIME_VERSION,
        });
      }

      if (sendMessage.mock.calls.filter(([id]) => id === 23).length === 1) {
        return Promise.reject(new Error('Extension context invalidated'));
      }

      return Promise.resolve({
        ok: true,
        version: EXTENSION_RUNTIME_VERSION,
      });
    });
    const executeScript = vi.fn().mockResolvedValue([]);

    await expect(
      ensureContentScriptInOpenWebTabs(
        { query, sendMessage },
        { executeScript },
      ),
    ).resolves.toEqual({
      matchedTabs: 2,
      activeTabs: 1,
      injectedTabs: 1,
      failedTabs: 0,
      firstError: null,
    });
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 23 },
      files: ['content.js'],
    });
  });

  it('records a real injection failure without blocking other tabs', async () => {
    const query = vi.fn().mockResolvedValue([
      { id: 31, url: 'https://example.com/one' },
      { id: 32, url: 'https://example.com/two' },
    ]);
    let pingCount = 0;
    const sendMessage = vi.fn().mockImplementation(() => {
      pingCount += 1;
      return Promise.resolve({
        ok: true,
        version: pingCount <= 2 ? 'stale-version' : EXTENSION_RUNTIME_VERSION,
      });
    });
    const executeScript = vi
      .fn()
      .mockRejectedValueOnce(new Error('Tab is unavailable'))
      .mockResolvedValueOnce([]);

    await expect(
      reinjectContentScriptIntoOpenWebTabs(
        { query, sendMessage },
        { executeScript },
      ),
    ).resolves.toEqual({
      matchedTabs: 2,
      activeTabs: 0,
      injectedTabs: 1,
      failedTabs: 1,
      firstError: 'Tab is unavailable',
    });
  });

  it('does not report success when the injected runtime stays silent', async () => {
    const query = vi.fn();
    const sendMessage = vi.fn().mockRejectedValue(new Error('No receiver'));
    const executeScript = vi.fn().mockResolvedValue([]);

    await expect(
      ensureContentScriptInTab(
        { id: 41, url: 'https://example.com/article' },
        { query, sendMessage },
        { executeScript },
      ),
    ).resolves.toEqual({
      tabId: 41,
      state: 'failed',
      error: 'No receiver',
    });
  });
});
