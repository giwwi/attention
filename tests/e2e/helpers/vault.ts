import {
  expect,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import { build } from 'esbuild';
import { appendFile, cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {} from './vault-client';

export const TEST_VAULT_PASSWORD = 'Attention browser test vault 2026';

/** Release output is read-only: the inspection API exists exclusively in this temporary copy. */
export async function createTestExtension(directory: string): Promise<string> {
  const extension = path.join(directory, 'test-extension');
  await mkdir(extension, { recursive: true });
  await cp(path.resolve('dist'), extension, { recursive: true });
  const compiled = await build({
    entryPoints: [path.resolve('tests/e2e/helpers/vault-client.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'chrome116',
  });
  const script = compiled.outputFiles[0]!.text;
  await writeFile(path.join(extension, 'test-vault.js'), script);
  await writeFile(
    path.join(extension, 'test-vault.html'),
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>Vault test inspection</title><body><script src="test-vault.js"></script></body></html>',
  );
  // Existing tests also observe worker network operations; expose the production API
  // there so storage assertions can stay in the same real execution context.
  await appendFile(path.join(extension, 'background.js'), `\n${script}\n`);
  return extension;
}

export async function extensionWorker(
  context: BrowserContext,
): Promise<Worker> {
  return (
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  );
}

/** Fixtures may initialize encryption through the production API; dedicated tests exercise its UI. */
export async function initializeTestVault(
  context: BrowserContext,
): Promise<void> {
  const worker = await extensionWorker(context);
  await worker.evaluate(async (password) => {
    const status = await attentionVault.getVaultStatus();
    if (status === 'unconfigured') await attentionVault.createVault(password);
    else if (status === 'locked') await attentionVault.unlockVault(password);
  }, TEST_VAULT_PASSWORD);
}

export async function createVaultThroughUi(
  page: Page,
  password = TEST_VAULT_PASSWORD,
): Promise<void> {
  await expect(page.locator('#vault-gate')).toBeVisible();
  await page.locator('#vault-password').fill(password);
  await page.locator('#vault-confirm-password').fill(password);
  await page.locator('#vault-submit').click();
  await expect(page.locator('#vault-gate')).toHaveCount(0);
}

export async function openVaultInspector(
  context: BrowserContext,
): Promise<Page> {
  const worker = await extensionWorker(context);
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${new URL(worker.url()).host}/test-vault.html`,
  );
  await page.waitForFunction(() => typeof attentionVault !== 'undefined');
  return page;
}

/** Inspect physical browser stores directly: this must never go through decrypted privateStorage. */
export async function readRawVaultStorage(target: Page | Worker) {
  const read = async () => {
    const databases: Record<string, Record<string, unknown[]>> = {};
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const stores: Record<string, unknown[]> = {};
        for (const store of Array.from(database.objectStoreNames)) {
          stores[store] = await new Promise<unknown[]>((resolve, reject) => {
            const transaction = database.transaction(store, 'readonly');
            const request = transaction.objectStore(store).getAll();
            transaction.oncomplete = () => resolve(request.result);
            transaction.onabort = transaction.onerror = () =>
              reject(transaction.error);
          });
        }
        databases[name] = stores;
      } finally {
        database.close();
      }
    }
    return {
      local: await chrome.storage.local.get(null),
      session: await chrome.storage.session.get(null),
      databases,
    };
  };
  return 'goto' in target ? target.evaluate(read) : target.evaluate(read);
}

export async function expectVaultEmpty(target: Page | Worker): Promise<void> {
  await expect
    .poll(async () => {
      const raw = await readRawVaultStorage(target);
      return {
        local: Object.keys(raw.local),
        session: Object.keys(raw.session),
        records: Object.values(raw.databases)
          .flatMap((stores) => Object.values(stores))
          .flat(),
      };
    })
    .toEqual({ local: [], session: [], records: [] });
}

/** Fail one actual encrypted record write, without supplying a plaintext fake repository. */
export async function failNextEncryptedWrite(page: Page): Promise<void> {
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'records') {
        IDBObjectStore.prototype.put = put;
        throw new DOMException(
          'Simulated encrypted storage failure',
          'QuotaExceededError',
        );
      }
      return Reflect.apply(put, this, args);
    };
  });
}
