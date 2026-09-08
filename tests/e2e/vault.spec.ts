import { initializeTestProfile } from './helpers/profile';
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createTestExtension,
  createVaultThroughUi,
  expectVaultEmpty,
  extensionWorker,
  openVaultInspector,
  readRawVaultStorage,
  TEST_VAULT_PASSWORD,
} from './helpers/vault';

let directory: string;
let extension: string;
let context: BrowserContext;

async function launch(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(directory, {
    channel: 'chromium',
    headless: process.env.HEADED !== 'true',
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
}

async function popupPage(): Promise<Page> {
  const worker = await extensionWorker(context);
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${new URL(worker.url()).host}/popup.html`,
  );
  return page;
}

test.beforeEach(async () => {
  test.setTimeout(90_000);
  directory = await mkdtemp(path.join(tmpdir(), 'attention-vault-e2e-'));
  extension = await createTestExtension(directory);
  context = await launch();
});

test.afterEach(async () => {
  await context.close();
  await rm(directory, { recursive: true, force: true });
});

test('the real password gate encrypts data, rejects a wrong password without changes, and restores access', async () => {
  const popup = await popupPage();
  const inspector = await openVaultInspector(context);
  await expect(popup.locator('#vault-confirm-password')).toBeVisible();
  await expect(popup.locator('#profile-onboarding')).toHaveCount(0);
  await expect(popup.locator('#interface-language')).toHaveCount(0);
  // A real extension CSP blocks inline styles, so prove the packaged CSS loaded.
  await expect(popup.locator('#vault-gate')).toHaveCSS('padding', '24px');
  await expect(popup.locator('#vault-submit')).toHaveCSS('width', '304px');
  await expect(popup.locator('.vault-checkbox')).toHaveCSS('display', 'flex');
  await popup
    .locator('#vault-gate')
    .screenshot({ path: 'output/playwright/vault-create-en.png' });
  await popup.locator('#vault-password').fill(TEST_VAULT_PASSWORD);
  await popup
    .locator('#vault-confirm-password')
    .fill('Different password here');
  await popup.locator('#vault-submit').click();
  await expect(popup.locator('#vault-status')).toContainText('do not match');
  expect(await inspector.evaluate(() => attentionVault.getVaultStatus())).toBe(
    'unconfigured',
  );
  await createVaultThroughUi(popup);
  await expect(popup.locator('#profile-onboarding')).toBeVisible();
  await initializeTestProfile(context);
  const secrets = {
    interfaceLanguage: 'en',
    profileOnboardingComplete: true,
    analysisContext: {
      scenario: 'work',
      availableMinutes: 15,
      intent: 'PRIVATE_VAULT_GOAL_8d76c4',
    },
    readwiseToken: {
      token: 'PRIVATE_VAULT_READWISE_TOKEN_792de1',
      updatedAt: '2026-09-06T10:00:00.000Z',
    },
    vaultE2eProfile: {
      interests: ['PRIVATE_VAULT_INTEREST_3b8f20'],
      history: ['PRIVATE_VAULT_HISTORY_31aeb2'],
    },
  };
  await inspector.evaluate(
    (values) => attentionVault.privateStorage.set(values),
    secrets,
  );
  await popup.reload();
  await expect(popup.locator('#launcher-home')).toBeVisible();
  const encrypted = await readRawVaultStorage(inspector);
  expect(Object.keys(encrypted.local).sort()).toEqual([
    '__attentionVaultMetadata',
    '__attentionVaultRevision',
  ]);
  const records = encrypted.databases['attention-encrypted-vault']!.records!;
  expect(records.length).toBeGreaterThan(0);
  for (const record of records) {
    expect(record).toMatchObject({
      version: 1,
      id: expect.any(String),
      nonce: expect.any(String),
      ciphertext: expect.any(String),
    });
    expect(Object.keys(record as object).sort()).toEqual([
      'ciphertext',
      'id',
      'nonce',
      'version',
    ]);
  }
  const atRest = JSON.stringify({
    local: encrypted.local,
    databases: encrypted.databases,
  });
  for (const marker of [
    'PRIVATE_VAULT_',
    'readwiseToken',
    'vaultE2eProfile',
    'analysisContext',
    TEST_VAULT_PASSWORD,
  ]) {
    expect(atRest).not.toContain(marker);
  }
  const article = context.pages()[0]!;
  await article.goto('http://127.0.0.1:4317/article/one');
  await article.locator('[data-attention-trigger]').focus();
  await article.keyboard.press('Enter');
  await expect(article.locator('[data-attention-preview]')).toBeVisible();
  await popup.locator('#vault-lock').click();
  await expect(popup.locator('#vault-password')).toBeVisible();
  await expect(popup.locator('#launcher-home')).toHaveCount(0);
  await expect(article.locator('[data-attention-preview]')).toHaveCount(0);
  await expect(article.locator('[data-attention-trigger]')).toHaveCount(0);
  await popup.emulateMedia({ colorScheme: 'dark' });
  await popup
    .locator('#vault-gate')
    .screenshot({ path: 'output/playwright/vault-unlock-dark.png' });
  await popup.emulateMedia({ colorScheme: 'light' });
  const beforeWrongPassword = await readRawVaultStorage(inspector);
  expect(beforeWrongPassword.session).toEqual({});
  await popup.locator('#vault-password').fill('Definitely the wrong password');
  await popup.locator('#vault-submit').click();
  await expect(popup.locator('#vault-status')).toContainText(
    'Incorrect password',
  );
  await expect(popup.locator('#vault-password')).toHaveValue('');
  expect(await readRawVaultStorage(inspector)).toEqual(beforeWrongPassword);
  expect(
    await inspector.evaluate(async () => {
      try {
        await attentionVault.privateStorage.get(null);
        return 'opened';
      } catch (error) {
        return (error as Error).name;
      }
    }),
  ).toBe('VaultLockedError');
  await popup.locator('#vault-password').fill(TEST_VAULT_PASSWORD);
  await popup.locator('#vault-submit').click();
  await expect(popup.locator('#launcher-home')).toBeVisible();
  expect(
    await inspector.evaluate(
      (keys) => attentionVault.privateStorage.get(keys),
      Object.keys(secrets),
    ),
  ).toEqual(secrets);
  // The release bundle itself must contain no inspection capability.
  expect(
    await readFile(path.resolve('dist/background.js'), 'utf8'),
  ).not.toContain('globalThis.attentionVault');
});

test('legacy local data and both source databases migrate to authenticated ciphertext', async () => {
  const inspector = await openVaultInspector(context);
  const legacy = await inspector.evaluate(async () => {
    const note = {
      path: 'PRIVATE_LEGACY_NOTE_abc.md',
      title: 'PRIVATE_LEGACY_NOTE_TITLE',
      modifiedAt: 1,
      size: 30,
      fragments: [
        {
          id: 'n1',
          notePath: 'PRIVATE_LEGACY_NOTE_abc.md',
          noteTitle: 'PRIVATE_LEGACY_NOTE_TITLE',
          heading: null,
          text: 'PRIVATE_LEGACY_OBSIDIAN_TEXT',
          tags: [],
          links: [],
          kind: 'own-note',
          attentionStrength: 1,
          modifiedAt: 1,
        },
      ],
    };
    const page = {
      id: 'PRIVATE_LEGACY_NOTION_ID',
      title: 'PRIVATE_LEGACY_NOTION_TITLE',
      notionUrl: 'https://notion.so/private-legacy',
      sourceUrlFingerprint: null,
      editedAt: 1,
      sourceMode: 'own-notes',
      fragments: [
        {
          id: 'p1',
          pageId: 'PRIVATE_LEGACY_NOTION_ID',
          pageTitle: 'PRIVATE_LEGACY_NOTION_TITLE',
          heading: null,
          text: 'PRIVATE_LEGACY_NOTION_TEXT',
          kind: 'own-note',
          attentionStrength: 1,
          editedAt: 1,
        },
      ],
    };
    for (const source of [
      {
        name: 'attention-obsidian-v1',
        store: 'notes',
        keyPath: 'path',
        record: note,
      },
      {
        name: 'attention-notion-v1',
        store: 'pages',
        keyPath: 'id',
        record: page,
      },
    ]) {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(source.name, 2);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(source.store, {
            keyPath: source.keyPath,
          });
          request.result.createObjectStore('search-index');
          request.result.createObjectStore('connection');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(
          [source.store, 'search-index', 'connection'],
          'readwrite',
        );
        tx.objectStore(source.store).put(source.record);
        tx.objectStore('search-index').put(
          { marker: `PRIVATE_LEGACY_INDEX_${source.store}` },
          'fragments',
        );
        tx.objectStore('connection').put(
          { name: 'PRIVATE_LEGACY_CONNECTION' },
          'directory',
        );
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
      database.close();
    }
    const local = {
      profileOnboardingComplete: true,
      interfaceLanguage: 'en',
      readwiseToken: {
        token: 'PRIVATE_LEGACY_READWISE_TOKEN',
        updatedAt: '2026-09-06T10:00:00.000Z',
      },
      legacyPersonalRecord: { goal: 'PRIVATE_LEGACY_GOAL' },
    };
    await chrome.storage.local.set(local);
    return { local, note, page };
  });
  const popup = await popupPage();
  await createVaultThroughUi(popup);
  const restored = await inspector.evaluate(() =>
    attentionVault.privateStorage.get(null),
  );
  expect(restored).toMatchObject(legacy.local);
  expect(restored.vaultObsidianData).toEqual({
    notes: [legacy.note],
    searchIndex: { marker: 'PRIVATE_LEGACY_INDEX_notes' },
  });
  expect(restored.vaultNotionData).toEqual({
    pages: [legacy.page],
    searchIndex: { marker: 'PRIVATE_LEGACY_INDEX_pages' },
  });
  const raw = await readRawVaultStorage(inspector);
  expect(raw.databases['attention-obsidian-v1']).toBeUndefined();
  expect(raw.databases['attention-notion-v1']).toBeUndefined();
  expect(
    JSON.stringify({ local: raw.local, databases: raw.databases }),
  ).not.toContain('PRIVATE_LEGACY_');
  expect(
    Object.keys(raw.local).every((key) => key.startsWith('__attentionVault')),
  ).toBe(true);
});

test('worker suspension preserves this browser session but a full browser restart requires the password', async () => {
  let popup = await popupPage();
  let inspector = await openVaultInspector(context);
  await createVaultThroughUi(popup);
  await initializeTestProfile(context);
  await inspector.evaluate(() =>
    attentionVault.privateStorage.set({
      profileOnboardingComplete: true,
      vaultRestartSentinel: 'PRIVATE_RESTART_SURVIVES',
    }),
  );
  const before = await readRawVaultStorage(inspector);
  const cdp = await context.newCDPSession(inspector);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
  await expect
    .poll(() =>
      inspector.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'ATTENTION_VAULT/STATUS' }),
      ),
    )
    .toMatchObject({ ok: true, unlocked: true });
  expect((await readRawVaultStorage(inspector)).session).toEqual(
    before.session,
  );
  await context.close();
  context = await launch();
  inspector = await openVaultInspector(context);
  popup = await popupPage();
  await expect(popup.locator('#vault-password')).toBeVisible();
  await expect(popup.locator('#vault-confirm-password')).toHaveCount(0);
  await expect(popup.locator('#launcher-home')).toHaveCount(0);
  expect((await readRawVaultStorage(inspector)).session).toEqual({});
  expect(await inspector.evaluate(() => attentionVault.getVaultStatus())).toBe(
    'locked',
  );
  await popup.locator('#vault-password').fill(TEST_VAULT_PASSWORD);
  await popup.locator('#vault-submit').click();
  await expect(popup.locator('#launcher-home')).toBeVisible();
  expect(
    await inspector.evaluate(() =>
      attentionVault.privateStorage.get('vaultRestartSentinel'),
    ),
  ).toEqual({ vaultRestartSentinel: 'PRIVATE_RESTART_SURVIVES' });
});

test('reset while locked or damaged requires explicit confirmation, empties storage, and preserves source files', async () => {
  const sourceFile = path.join(directory, 'original-source.md');
  const sourceText = 'This original source file must survive Attention reset.';
  await writeFile(sourceFile, sourceText);
  const popup = await popupPage();
  const inspector = await openVaultInspector(context);
  await createVaultThroughUi(popup);
  await inspector.evaluate(() =>
    attentionVault.privateStorage.set({
      vaultResetSentinel: 'PRIVATE_DELETE_ME',
    }),
  );
  await popup.locator('#vault-lock').click();
  await expect(popup.locator('#vault-password')).toBeVisible();
  const locked = await readRawVaultStorage(inspector);
  await popup.locator('#vault-reset').click();
  await expect(popup.locator('#vault-reset-confirm')).toBeDisabled();
  await expect(popup.locator('#vault-reset-warning')).toContainText(
    'Original source files are unaffected',
  );
  await popup
    .locator('#vault-gate')
    .screenshot({ path: 'output/playwright/vault-reset-en.png' });
  await popup.locator('#vault-reset-cancel').click();
  expect(await readRawVaultStorage(inspector)).toEqual(locked);
  // Even malformed metadata must leave the real reset route reachable.
  await inspector.evaluate(() =>
    chrome.storage.local.set({
      __attentionVaultMetadata: { version: 99, damaged: true },
    }),
  );
  await popup.reload();
  await expect(popup.locator('#vault-status')).toContainText(
    'could not be read',
  );
  await popup.locator('#vault-reset').click();
  await popup.locator('#vault-reset-acknowledge').check();
  await popup.locator('#vault-reset-confirm').click();
  await expect(popup.locator('#vault-confirm-password')).toBeVisible();
  await expectVaultEmpty(inspector);
  expect(await readFile(sourceFile, 'utf8')).toBe(sourceText);
  await createVaultThroughUi(popup, 'A different new vault password');
  expect(
    await inspector.evaluate(() =>
      attentionVault.privateStorage.get('vaultResetSentinel'),
    ),
  ).toEqual({});
});

test('a locked vault denies private runtime actions and leaves physical storage unchanged', async () => {
  const popup = await popupPage();
  const inspector = await openVaultInspector(context);
  await createVaultThroughUi(popup);
  await popup.locator('#vault-lock').click();
  await expect(popup.locator('#vault-password')).toBeVisible();
  const locked = await readRawVaultStorage(inspector);
  const results = await inspector.evaluate(async () =>
    Promise.all([
      chrome.runtime.sendMessage({
        type: 'attention:readwise-connect',
        token: 'PRIVATE_LOCKED_TOKEN',
      }),
      chrome.runtime.sendMessage({
        type: 'attention:history-import',
        lookbackDays: 30,
      }),
      chrome.runtime.sendMessage({
        type: 'attention:notion-connect',
        code: 'PRIVATE_LOCKED_CODE',
        redirectUri: `https://${chrome.runtime.id}.chromiumapp.org/notion`,
        sourceMode: 'mixed',
      }),
    ]),
  );
  for (const result of results) expect(result).toMatchObject({ ok: false });
  expect(await readRawVaultStorage(inspector)).toEqual(locked);
  expect(await inspector.evaluate(() => attentionVault.getVaultStatus())).toBe(
    'locked',
  );
});
