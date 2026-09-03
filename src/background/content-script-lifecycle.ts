import {
  CONTENT_RUNTIME_PING_TYPE,
  type ContentRuntimePingResponse,
} from '../shared/types';
import { EXTENSION_RUNTIME_VERSION } from '../shared/version';

const WEB_TAB_MATCHES = ['http://*/*', 'https://*/*'] as const;

export const CONTENT_SCRIPT_LIFECYCLE_DIAGNOSTIC_KEY =
  'contentScriptLifecycleDiagnostic';

export type ContentScriptLifecycleTrigger =
  'install' | 'update' | 'startup' | 'activated' | 'updated';

export type ContentScriptTabState =
  'active' | 'injected' | 'failed' | 'skipped';

export interface ContentScriptTabResult {
  tabId: number | null;
  state: ContentScriptTabState;
  error?: string;
}

export interface ContentScriptTab {
  id?: number;
  url?: string;
  discarded?: boolean;
}

export interface ContentScriptReinjectionSummary {
  matchedTabs: number;
  activeTabs: number;
  injectedTabs: number;
  failedTabs: number;
  firstError: string | null;
}

export interface ContentScriptLifecycleDiagnostic extends ContentScriptReinjectionSummary {
  trigger: ContentScriptLifecycleTrigger;
  version: string;
  checkedAt: string;
}

export interface TabsLifecycleApi {
  query(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

export interface ScriptInjectionApi {
  executeScript(injection: {
    target: chrome.scripting.InjectionTarget;
    files: string[];
  }): Promise<chrome.scripting.InjectionResult[]>;
}

function isWebUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isCurrentRuntimeResponse(
  value: unknown,
): value is ContentRuntimePingResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Record<string, unknown>;
  return response.ok === true && response.version === EXTENSION_RUNTIME_VERSION;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function summarizeContentScriptResults(
  results: ContentScriptTabResult[],
): ContentScriptReinjectionSummary {
  return {
    matchedTabs: results.length,
    activeTabs: results.filter((result) => result.state === 'active').length,
    injectedTabs: results.filter((result) => result.state === 'injected')
      .length,
    failedTabs: results.filter((result) => result.state === 'failed').length,
    firstError:
      results.find((result) => result.state === 'failed')?.error ?? null,
  };
}

/**
 * Confirms that a tab is running this exact content-script version. Missing or
 * stale runtimes are repaired in place, so the user never needs to reload the
 * page after reloading the unpacked extension.
 */
export async function ensureContentScriptInTab(
  tab: ContentScriptTab,
  tabsApi: TabsLifecycleApi = chrome.tabs,
  scriptingApi: ScriptInjectionApi = chrome.scripting,
): Promise<ContentScriptTabResult> {
  if (
    typeof tab.id !== 'number' ||
    tab.discarded === true ||
    !isWebUrl(tab.url)
  ) {
    return { tabId: tab.id ?? null, state: 'skipped' };
  }

  try {
    const response = await tabsApi.sendMessage(tab.id, {
      type: CONTENT_RUNTIME_PING_TYPE,
    });
    if (isCurrentRuntimeResponse(response)) {
      return { tabId: tab.id, state: 'active' };
    }
  } catch {
    // A missing receiver is expected for pages opened before extension reload.
  }

  try {
    await scriptingApi.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
    const response = await tabsApi.sendMessage(tab.id, {
      type: CONTENT_RUNTIME_PING_TYPE,
    });
    if (!isCurrentRuntimeResponse(response)) {
      throw new Error('Runtime did not confirm its version after injection');
    }
    return { tabId: tab.id, state: 'injected' };
  } catch (error) {
    return {
      tabId: tab.id,
      state: 'failed',
      error: errorMessage(error),
    };
  }
}

export async function ensureContentScriptInOpenWebTabs(
  tabsApi: TabsLifecycleApi = chrome.tabs,
  scriptingApi: ScriptInjectionApi = chrome.scripting,
): Promise<ContentScriptReinjectionSummary> {
  const tabs = await tabsApi.query({ url: [...WEB_TAB_MATCHES] });
  const results = await Promise.all(
    tabs.map((tab) => ensureContentScriptInTab(tab, tabsApi, scriptingApi)),
  );
  return summarizeContentScriptResults(results);
}

// Keep the old exported name for callers and tests from previous MVP builds.
export const reinjectContentScriptIntoOpenWebTabs =
  ensureContentScriptInOpenWebTabs;
