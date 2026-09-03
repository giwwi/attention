const WEB_TAB_MATCHES = ['http://*/*', 'https://*/*'] as const;

export interface ContentScriptReinjectionSummary {
  matchedTabs: number;
  injectedTabs: number;
  failedTabs: number;
}

interface TabsQueryApi {
  query(
    queryInfo: chrome.tabs.QueryInfo,
  ): Promise<chrome.tabs.Tab[]>;
}

interface ScriptInjectionApi {
  executeScript(
    injection: {
      target: chrome.scripting.InjectionTarget;
      files: string[];
    },
  ): Promise<chrome.scripting.InjectionResult[]>;
}

/**
 * Refreshes the content-script runtime in documents that were already open
 * when an unpacked extension was installed or reloaded. Chrome treats that
 * reload as an extension update, but it does not retroactively inject the new
 * manifest content script into existing documents.
 */
export async function reinjectContentScriptIntoOpenWebTabs(
  tabsApi: TabsQueryApi = chrome.tabs,
  scriptingApi: ScriptInjectionApi = chrome.scripting,
): Promise<ContentScriptReinjectionSummary> {
  const tabs = await tabsApi.query({ url: [...WEB_TAB_MATCHES] });
  const eligibleTabs = tabs.filter(
    (tab): tab is chrome.tabs.Tab & { id: number } =>
      typeof tab.id === 'number' && tab.discarded !== true,
  );
  const results = await Promise.allSettled(
    eligibleTabs.map((tab) =>
      scriptingApi.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      }),
    ),
  );
  const injectedTabs = results.filter(
    (result) => result.status === 'fulfilled',
  ).length;
  return {
    matchedTabs: tabs.length,
    injectedTabs,
    failedTabs: eligibleTabs.length - injectedTabs,
  };
}
