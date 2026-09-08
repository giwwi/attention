import { initializeTestProfile } from './helpers/profile';
import {
  createTestExtension,
  initializeTestVault,
  expectVaultEmpty,
  openVaultInspector,
} from './helpers/vault';
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { shadowElementState } from './helpers/card';

let context: BrowserContext;
let worker: Worker;
let directory: string;

test.beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'attention-privacy-'));
  const extension = await createTestExtension(directory);
  context = await chromium.launchPersistentContext(directory, {
    channel: 'chromium',
    headless: process.env.HEADED !== 'true',
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  await initializeTestVault(context);
  await initializeTestProfile(context);
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
});

test.afterEach(async () => {
  await context.close();
  await rm(directory, { recursive: true, force: true });
});

async function extensionPage(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${new URL(worker.url()).host}/popup.html`,
  );
  return page;
}

async function eraseFromPopup(page: Page): Promise<void> {
  await page.locator('#open-popup-settings').click();
  await page.locator('#open-privacy-settings').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#delete-all-data').click();
  await expect(page.locator('#vault-confirm-password')).toBeVisible();
  await expectVaultEmpty(worker);
}

interface DomNode {
  nodeId: number;
  backendNodeId: number;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: DomNode[];
}
async function passageButton(
  page: Page,
  hostAttribute: string,
  className: string,
) {
  const cdp = await context.newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', {
    depth: -1,
    pierce: true,
  });
  const nodes = (node: DomNode): DomNode[] => [
    node,
    ...(node.children ?? []).flatMap(nodes),
    ...(node.shadowRoots ?? []).flatMap(nodes),
  ];
  const all = nodes(root);
  const host = all.find((node) => node.attributes?.includes(hostAttribute));
  const button =
    host &&
    nodes(host).find((node) => {
      const index = node.attributes?.indexOf('class') ?? -1;
      return (
        index >= 0 &&
        node.attributes?.[index + 1]?.split(' ').includes(className)
      );
    });
  expect(button, `closed-shadow button ${className}`).toBeTruthy();
  return {
    async textContent(): Promise<string> {
      const { object } = await cdp.send('DOM.resolveNode', {
        backendNodeId: button!.backendNodeId,
      });
      const { result } = await cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId!,
        functionDeclaration: 'function() { return this.textContent; }',
        returnByValue: true,
      });
      return String(result.value ?? '');
    },
    async syntheticClick() {
      const { object } = await cdp.send('DOM.resolveNode', {
        backendNodeId: button!.backendNodeId,
      });
      await cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId!,
        functionDeclaration: 'function() { this.click(); }',
      });
    },
    async userClick() {
      const { model } = await cdp.send('DOM.getBoxModel', {
        backendNodeId: button!.backendNodeId,
      });
      await page.mouse.click(
        (model.content[0] + model.content[4]) / 2,
        (model.content[1] + model.content[5]) / 2,
      );
    },
  };
}

test('a page cannot invoke private passage actions, while real user clicks still work', async () => {
  await worker.evaluate(async () => {
    await attentionVault.privateStorage.set({
      novelPassageHighlightsEnabled: true,
      readwiseToken: {
        token: 'test-only-readwise-token',
        updatedAt: new Date().toISOString(),
      },
      readwiseSettings: {
        connected: true,
        lastSyncedAt: null,
        sourceCount: 0,
        highlightCount: 0,
        noteCount: 0,
        excludedSourceCount: 0,
      },
    });
    const scope = globalThis as typeof globalThis & {
      privacyWrites?: string[];
      privacyInvalidations?: string[][];
    };
    scope.privacyWrites = [];
    scope.privacyInvalidations = [];
    // Observe successful delivery of the real broadcast without replacing its
    // content handler or manufacturing an invalidation in the page.
    chrome.tabs.sendMessage = new Proxy(chrome.tabs.sendMessage, {
      apply(target, thisArg, args) {
        const response: unknown = Reflect.apply(target, thisArg, args);
        const message = args[1] as Record<string, unknown> | undefined;
        if (
          message?.type === 'ATTENTION_INPUTS/INVALIDATED' &&
          Array.isArray(message.changedKeys)
        ) {
          const keys = message.changedKeys.filter(
            (key): key is string => typeof key === 'string',
          );
          void Promise.resolve(response)
            .then(() => scope.privacyInvalidations!.push(keys))
            .catch(() => undefined);
        }
        return response;
      },
    });
    globalThis.fetch = async (input, init) => {
      if (String(input) !== 'https://readwise.io/api/v2/highlights/')
        throw new Error('Unexpected request in privacy test');
      scope.privacyWrites!.push(String(init?.body));
      return new Response(null, { status: 204 });
    };
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('http://127.0.0.1:4317/article/one');
  await page.locator('h1').hover();
  await expect(page.locator('[data-attention-preview]')).toHaveAttribute(
    'data-attention-source',
    'full-analysis',
  );
  await (
    await passageButton(page, 'data-attention-preview', 'passages-button')
  ).userClick();
  await expect(page.locator('[data-attention-novel-passages]')).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect
    .poll(
      async () =>
        (
          await shadowElementState(
            context,
            page,
            '.panel',
            'data-attention-novel-passages',
          )
        ).colorScheme,
    )
    .toBe('dark');
  await page
    .locator('[data-attention-novel-passages]')
    .screenshot({ path: 'output/playwright/passages-theme-dark.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect
    .poll(
      async () =>
        (
          await shadowElementState(
            context,
            page,
            '.panel',
            'data-attention-novel-passages',
          )
        ).colorScheme,
    )
    .toBe('light');
  const selectedExcerpt = await (
    await passageButton(page, 'data-attention-novel-passages', 'excerpt')
  ).textContent();
  expect(selectedExcerpt.length).toBeGreaterThanOrEqual(20);
  expect(
    await page.evaluate(
      () =>
        document.querySelector('[data-attention-novel-passages]')!.shadowRoot,
    ),
  ).toBeNull();
  await (
    await passageButton(page, 'data-attention-novel-passages', 'readwise')
  ).syntheticClick();
  await (
    await passageButton(page, 'data-attention-novel-passages', 'known')
  ).syntheticClick();
  await (
    await passageButton(page, 'data-attention-novel-passages', 'novel')
  ).syntheticClick();
  expect(
    await worker.evaluate(async () => ({
      writes: (globalThis as typeof globalThis & { privacyWrites: string[] })
        .privacyWrites.length,
      feedback:
        (await attentionVault.privateStorage.get('novelPassageFeedback'))
          .novelPassageFeedback ?? [],
    })),
  ).toEqual({ writes: 0, feedback: [] });
  await (
    await passageButton(page, 'data-attention-novel-passages', 'novel')
  ).userClick();
  await expect
    .poll(() =>
      worker.evaluate(
        async () =>
          (await attentionVault.privateStorage.get('novelPassageFeedback'))
            .novelPassageFeedback ?? [],
      ),
    )
    .toEqual([
      expect.objectContaining({ value: 'new', excerpt: selectedExcerpt }),
    ]);
  await expect
    .poll(() =>
      worker.evaluate(() =>
        (
          globalThis as typeof globalThis & {
            privacyInvalidations: string[][];
          }
        ).privacyInvalidations.some(
          (keys) =>
            keys.includes('novelPassageFeedback') &&
            keys.includes('claimMemoryRevision'),
        ),
      ),
    )
    .toBe(true);
  await expect(page.locator('[data-attention-novel-passages]')).toBeVisible();
  expect(
    await (
      await passageButton(page, 'data-attention-novel-passages', 'excerpt')
    ).textContent(),
  ).toBe(selectedExcerpt);
  await (
    await passageButton(page, 'data-attention-novel-passages', 'readwise')
  ).userClick();
  await expect
    .poll(() =>
      worker.evaluate(
        () =>
          (globalThis as typeof globalThis & { privacyWrites: string[] })
            .privacyWrites.length,
      ),
    )
    .toBe(1);
  const payload = JSON.parse(
    await worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { privacyWrites: string[] })
          .privacyWrites[0]!,
    ),
  ) as { highlights: Array<Record<string, unknown>> };
  expect(payload.highlights).toEqual([
    expect.objectContaining({ text: selectedExcerpt, source_url: page.url() }),
  ]);
  expect(
    await worker.evaluate(
      async () =>
        (await attentionVault.privateStorage.get('novelPassageFeedback'))
          .novelPassageFeedback ?? [],
    ),
  ).toEqual([
    expect.objectContaining({ value: 'new', excerpt: selectedExcerpt }),
  ]);
  await (
    await passageButton(page, 'data-attention-novel-passages', 'known')
  ).userClick();
  await expect
    .poll(() =>
      worker.evaluate(
        async () =>
          (await attentionVault.privateStorage.get('novelPassageFeedback'))
            .novelPassageFeedback ?? [],
      ),
    )
    .toEqual([
      expect.objectContaining({ value: 'known', excerpt: selectedExcerpt }),
    ]);
});

test('deletion in a second extension page defeats a pending Readwise connection', async () => {
  await worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      privacyRelease?: () => void;
      privacyWaiting?: boolean;
    };
    globalThis.fetch = async (input) => {
      if (String(input).includes('/auth/'))
        return new Response(null, { status: 204 });
      if (!String(input).includes('/export/'))
        throw new Error('Unexpected request in erasure test');
      scope.privacyWaiting = true;
      await new Promise<void>((resolve) => {
        scope.privacyRelease = resolve;
      });
      return Response.json({ results: [], nextPageCursor: null });
    };
  });
  const connecting = await openVaultInspector(context);
  await connecting.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      privacyConnect?: unknown;
    };
    void chrome.runtime
      .sendMessage({
        type: 'attention:readwise-connect',
        token: 'test-only-readwise-token',
      })
      .then((response) => {
        scope.privacyConnect = response;
      });
  });
  await expect
    .poll(() =>
      worker.evaluate(
        () =>
          (globalThis as typeof globalThis & { privacyWaiting?: boolean })
            .privacyWaiting,
      ),
    )
    .toBe(true);
  const deleting = await extensionPage();
  await eraseFromPopup(deleting);
  await worker.evaluate(() =>
    (
      globalThis as typeof globalThis & { privacyRelease: () => void }
    ).privacyRelease(),
  );
  await expect
    .poll(() =>
      connecting.evaluate(
        () =>
          (globalThis as typeof globalThis & { privacyConnect?: unknown })
            .privacyConnect,
      ),
    )
    .toEqual({ ok: false, error: 'operation_cancelled' });
  await expectVaultEmpty(worker);
});

test('deletion defeats an outstanding browser history import', async () => {
  await worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      privacyHistoryRelease?: () => void;
      privacyHistoryWaiting?: boolean;
    };
    Object.defineProperty(chrome, 'history', {
      configurable: true,
      value: {
        search: async () => {
          scope.privacyHistoryWaiting = true;
          await new Promise<void>((resolve) => {
            scope.privacyHistoryRelease = resolve;
          });
          return [
            {
              url: 'https://example.com/article',
              title: 'Private history title',
              lastVisitTime: Date.now(),
              visitCount: 3,
            },
          ];
        },
      },
    });
  });
  const importing = await openVaultInspector(context);
  await importing.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      privacyHistory?: unknown;
    };
    void chrome.runtime
      .sendMessage({ type: 'attention:history-import', lookbackDays: 30 })
      .then((response) => {
        scope.privacyHistory = response;
      });
  });
  await expect
    .poll(() =>
      worker.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              privacyHistoryWaiting?: boolean;
            }
          ).privacyHistoryWaiting,
      ),
    )
    .toBe(true);
  await eraseFromPopup(await extensionPage());
  await worker.evaluate(() =>
    (
      globalThis as typeof globalThis & { privacyHistoryRelease: () => void }
    ).privacyHistoryRelease(),
  );
  await expect
    .poll(() =>
      importing.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              privacyHistory?: { error?: string };
            }
          ).privacyHistory?.error,
      ),
    )
    .toBe('operation_cancelled');
  await expectVaultEmpty(worker);
});

test('an OAuth flow started before deletion cannot connect afterward', async () => {
  const authorizing = await openVaultInspector(context);
  const generation = await authorizing.evaluate(
    async () =>
      (await attentionVault.privateStorage.get('attentionDataGeneration'))
        .attentionDataGeneration ?? 'initial',
  );
  await eraseFromPopup(await extensionPage());
  const response = await authorizing.evaluate(
    (generation) =>
      chrome.runtime.sendMessage({
        type: 'attention:notion-connect',
        generation,
        code: 'test-oauth-code',
        redirectUri: `https://${chrome.runtime.id}.chromiumapp.org/notion`,
        sourceMode: 'mixed',
      }),
    generation,
  );
  expect(response).toEqual({ ok: false, error: 'operation_cancelled' });
  await expectVaultEmpty(worker);
});
