import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDataLocks } from './helpers/data-locks';
import type { EncryptedRecord } from '../src/vault/database';

const disk = vi.hoisted(() => ({
  records: new Map<string, EncryptedRecord>(),
  events: new Map<string, EncryptedRecord>(),
  legacy: {} as Record<string, unknown>,
  readFailure: false,
  corruptWrite: false,
  clearLegacyFailure: false,
  partiallyClear: false,
  deleteFailure: false,
}));

vi.mock('../src/vault/database', () => ({
  readRecords: async () => structuredClone([...disk.records.values()]),
  readRecord: async (id: string) => {
    if (disk.readFailure) throw new Error('Read interrupted');
    return structuredClone(disk.records.get(id));
  },
  readEvent: async (id: string) => structuredClone(disk.events.get(id)),
  readLatestEvent: async () =>
    structuredClone([...disk.events.values()].at(-1)),
  writeRecords: async (
    put: EncryptedRecord[],
    remove: string[] = [],
    event?: EncryptedRecord,
    clear = false,
  ) => {
    if (clear) {
      disk.records.clear();
      disk.events.clear();
    }
    for (const id of remove) disk.records.delete(id);
    for (const record of put) {
      const saved = structuredClone(record);
      if (disk.corruptWrite) saved.ciphertext = 'AAAA';
      disk.records.set(record.id, saved);
    }
    if (event) disk.events.set(event.id, structuredClone(event));
  },
  clearRecords: async () => {
    disk.records.clear();
    disk.events.clear();
  },
  deleteVaultDatabase: async () => {
    if (disk.deleteFailure)
      throw new Error('Encrypted database deletion interrupted');
    disk.records.clear();
    disk.events.clear();
  },
}));

vi.mock('../src/vault/legacy', () => ({
  readLegacyDatabases: async () => structuredClone(disk.legacy),
  clearLegacyDatabases: async () => {
    if (disk.partiallyClear) disk.legacy = { library: { pages: [] } };
    if (disk.clearLegacyFailure) throw new Error('Legacy cleanup interrupted');
    disk.legacy = {};
  },
}));

type Listener = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) => void;
let listeners: Set<Listener>;

class ChromeArea {
  data: Record<string, unknown> = {};
  accessLevels: string[] = [];
  failSetKey?: string;
  failClear = false;
  constructor(private readonly name: string) {}
  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    const names =
      keys == null
        ? Object.keys(this.data)
        : typeof keys === 'string'
          ? [keys]
          : keys;
    return Object.fromEntries(
      names
        .filter((key) => Object.hasOwn(this.data, key))
        .map((key) => [key, structuredClone(this.data[key])]),
    );
  }
  async set(values: Record<string, unknown>): Promise<void> {
    if (this.failSetKey && Object.hasOwn(values, this.failSetKey)) {
      this.failSetKey = undefined;
      throw new Error('Chrome notification interrupted');
    }
    const changes = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        { oldValue: this.data[key], newValue: structuredClone(value) },
      ]),
    );
    Object.assign(this.data, structuredClone(values));
    for (const listener of listeners) listener(changes, this.name);
  }
  async remove(keys: string | string[]): Promise<void> {
    const changes: Record<string, chrome.storage.StorageChange> = {};
    for (const key of typeof keys === 'string' ? [keys] : keys) {
      if (!Object.hasOwn(this.data, key)) continue;
      changes[key] = { oldValue: this.data[key] };
      delete this.data[key];
    }
    for (const listener of listeners) listener(changes, this.name);
  }
  async clear(): Promise<void> {
    if (this.failClear) {
      this.failClear = false;
      throw new Error('Chrome storage clear interrupted');
    }
    await this.remove(Object.keys(this.data));
  }
  async setAccessLevel(options: { accessLevel: string }): Promise<void> {
    this.accessLevels.push(options.accessLevel);
  }
}

let local: ChromeArea;
let session: ChromeArea;
let vault: typeof import('../src/vault/storage');
const PASSWORD = 'correct horse battery vault';

beforeEach(async () => {
  vi.resetModules();
  installDataLocks();
  vi.stubGlobal('crypto', webcrypto);
  listeners = new Set();
  local = new ChromeArea('local');
  session = new ChromeArea('session');
  vi.stubGlobal('chrome', {
    storage: {
      local,
      session,
      onChanged: {
        addListener: (listener: Listener) => listeners.add(listener),
        removeListener: (listener: Listener) => listeners.delete(listener),
      },
    },
  });
  disk.records.clear();
  disk.events.clear();
  disk.legacy = {};
  disk.readFailure =
    disk.corruptWrite =
    disk.clearLegacyFailure =
    disk.partiallyClear =
    disk.deleteFailure =
      false;
  vault = await import('../src/vault/storage');
});

afterEach(() => vi.unstubAllGlobals());

function persistentSnapshot(): string {
  return JSON.stringify({
    local: local.data,
    records: [...disk.records.values()],
    events: [...disk.events.values()],
  });
}

describe('encrypted private storage', () => {
  it('fails closed when unconfigured or locked, including defaults and clear', async () => {
    expect(await vault.getVaultStatus()).toBe('unconfigured');
    await expect(
      vault.privateStorage.get({ settings: {} }),
    ).rejects.toBeInstanceOf(vault.VaultLockedError);
    await expect(vault.privateStorage.clear()).rejects.toBeInstanceOf(
      vault.VaultLockedError,
    );
    await vault.createVault(PASSWORD);
    await vault.lockVault();
    expect(await vault.getVaultStatus()).toBe('locked');
    await expect(
      vault.privateStorage.set({ settings: {} }),
    ).rejects.toBeInstanceOf(vault.VaultLockedError);
    await expect(
      vault.privateStorage.remove('settings'),
    ).rejects.toBeInstanceOf(vault.VaultLockedError);
    await expect(vault.getVaultEpoch()).rejects.toBeInstanceOf(
      vault.VaultLockedError,
    );
  });

  it('stores only authenticated ciphertext and keeps the random data key in trusted session storage', async () => {
    await vault.createVault(PASSWORD);
    await vault.privateStorage.set({
      personalProfile: {
        name: 'PRIVATE-NAME',
        token: 'PRIVATE-TOKEN',
        nested: ['тест', 9],
      },
    });
    const persisted = persistentSnapshot();
    for (const plaintext of [
      PASSWORD,
      'PRIVATE-NAME',
      'PRIVATE-TOKEN',
      'personalProfile',
      'тест',
    ])
      expect(persisted).not.toContain(plaintext);
    const secret = session.data[vault.VAULT_SESSION_KEY] as { key: string };
    expect(atob(secret.key)).toHaveLength(32);
    expect(persisted).not.toContain(secret.key);
    expect(
      local.accessLevels.every((level) => level === 'TRUSTED_CONTEXTS'),
    ).toBe(true);
    expect(
      session.accessLevels.every((level) => level === 'TRUSTED_CONTEXTS'),
    ).toBe(true);
    const meta = local.data[vault.VAULT_METADATA_KEY] as {
      iterations: number;
      salt: string;
    };
    expect(meta.iterations).toBeGreaterThanOrEqual(600_000);
    expect(atob(meta.salt)).toHaveLength(16);
    const [record] = [...disk.records.values()];
    expect(atob(record!.nonce)).toHaveLength(12);
    expect(await vault.privateStorage.get(null)).toEqual({
      personalProfile: {
        name: 'PRIVATE-NAME',
        token: 'PRIVATE-TOKEN',
        nested: ['тест', 9],
      },
    });
  });

  it('uses fresh nonces for updates and restores values only with the correct password', async () => {
    await vault.createVault(PASSWORD);
    await vault.privateStorage.set({ settings: 'first' });
    const first = [...disk.records.values()][0]!;
    await vault.privateStorage.set({ settings: 'second' });
    const second = [...disk.records.values()][0]!;
    expect(second.id).toBe(first.id);
    expect(second.nonce).not.toBe(first.nonce);
    await vault.lockVault();
    const before = persistentSnapshot();
    await expect(vault.unlockVault('wrong password')).rejects.toThrow(
      'Incorrect password',
    );
    expect(persistentSnapshot()).toBe(before);
    expect(session.data).toEqual({});
    await vault.unlockVault(PASSWORD);
    expect(await vault.privateStorage.get('settings')).toEqual({
      settings: 'second',
    });
  });

  it('changes the epoch every unlock and locks after browser session secrets disappear', async () => {
    await vault.createVault(PASSWORD);
    const first = await vault.getVaultEpoch();
    const state = vi.fn();
    const unsubscribe = vault.onVaultStateChanged(state);
    await session.clear();
    expect(state).toHaveBeenCalled();
    expect(await vault.getVaultStatus()).toBe('locked');
    await vault.unlockVault(PASSWORD);
    expect(await vault.getVaultEpoch()).not.toBe(first);
    unsubscribe();
  });

  it('rejects tampered ciphertext instead of returning empty data or defaults', async () => {
    await vault.createVault(PASSWORD);
    await vault.privateStorage.set({ settings: { private: true } });
    const record = [...disk.records.values()][0]!;
    record.ciphertext = `${record.ciphertext[0] === 'A' ? 'B' : 'A'}${record.ciphertext.slice(1)}`;
    await expect(vault.privateStorage.get({ settings: {} })).rejects.toThrow(
      'authenticated',
    );
    await vault.lockVault();
    await expect(vault.unlockVault(PASSWORD)).rejects.toThrow('authenticated');
    expect(await vault.getVaultStatus()).toBe('locked');
  });

  it('authenticates record identity so swapping ciphertext between keys fails', async () => {
    await vault.createVault(PASSWORD);
    await vault.privateStorage.set({ first: 'one', second: 'two' });
    const [one, two] = [...disk.records.values()];
    disk.records.set(one!.id, { ...two!, id: one!.id });
    await expect(vault.privateStorage.get('first')).rejects.toThrow(
      'authenticated',
    );
  });

  it('implements object defaults, removal and clear with logical decrypted events', async () => {
    await vault.createVault(PASSWORD);
    const listener = vi.fn();
    vault.privateStorageChanges.addListener(listener);
    await vault.privateStorage.set({ count: 1, settings: { enabled: true } });
    await vault.privateStorage.set({ count: 2 });
    expect(listener).toHaveBeenLastCalledWith(
      { count: { oldValue: 1, newValue: 2 } },
      'local',
    );
    expect(
      await vault.privateStorage.get({ count: 0, missing: 'default' }),
    ).toEqual({ count: 2, missing: 'default' });
    await vault.privateStorage.remove('count');
    expect(listener).toHaveBeenLastCalledWith(
      { count: { oldValue: 2 } },
      'local',
    );
    await vault.privateStorage.clear();
    expect(listener).toHaveBeenLastCalledWith(
      { settings: { oldValue: { enabled: true } } },
      'local',
    );
    expect(await vault.privateStorage.get(null)).toEqual({});
    expect(await vault.getVaultStatus()).toBe('unlocked');
  });

  it('delivers authenticated notifications across independently imported contexts', async () => {
    await vault.createVault(PASSWORD);
    vi.resetModules();
    const second = await import('../src/vault/storage');
    const listener = vi.fn();
    second.privateStorageChanges.addListener(listener);
    await vault.privateStorage.set({ language: 'ru' });
    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledExactlyOnceWith(
        { language: { newValue: 'ru' } },
        'local',
      ),
    );
    expect(JSON.stringify(local.data[vault.VAULT_REVISION_KEY])).not.toContain(
      'language',
    );
    await vault.privateStorage.set({ language: 'en' });
    await vi.waitFor(() =>
      expect(listener).toHaveBeenLastCalledWith(
        { language: { newValue: 'en' } },
        'local',
      ),
    );
    await second.privateStorage.set({ language: 'ru' });
    expect(listener).toHaveBeenLastCalledWith(
      { language: { oldValue: 'en', newValue: 'ru' } },
      'local',
    );
  });

  it('persists only logical key lists in event envelopes, with no deleted value snapshots', async () => {
    await vault.createVault(PASSWORD);
    await vault.privateStorage.set({
      library: { secret: 'PRIVATE-DELETED-SOURCE' },
    });
    await vault.privateStorage.remove('library');
    const cryptoTools = await import('../src/vault/cryptography');
    const secret = session.data[vault.VAULT_SESSION_KEY] as {
      key: string;
      vaultId: string;
    };
    const key = await cryptoTools.importDataKey(cryptoTools.decode(secret.key));
    for (const event of disk.events.values()) {
      expect(
        await cryptoTools.decrypt(key, secret.vaultId, 'event', event),
      ).toEqual({ keys: ['library'], knownKeys: ['library'] });
    }
    expect(disk.records.size).toBe(0);
    await vault.privateStorage.clear();
    expect(disk.events.size).toBe(1);
    await vault.resetVault();
    expect(disk.events.size).toBe(0);
  });

  it('conservatively invalidates changed keys when a delayed event has left the bounded journal', async () => {
    await vault.createVault(PASSWORD);
    vi.resetModules();
    const second = await import('../src/vault/storage');
    const listener = vi.fn();
    second.privateStorageChanges.addListener(listener);
    const observer = [...listeners].at(-1)!;
    listeners.delete(observer);
    await vault.privateStorage.set({ removed: 'old source' });
    const oldRevision = structuredClone(
      local.data[vault.VAULT_REVISION_KEY],
    ) as { id: string };
    await vault.privateStorage.remove('removed');
    await vault.privateStorage.set({ settings: 'current' });
    disk.events.delete(oldRevision.id);
    observer(
      { [vault.VAULT_REVISION_KEY]: { newValue: oldRevision } },
      'local',
    );
    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledWith(
        { removed: { newValue: undefined }, settings: { newValue: 'current' } },
        'local',
      ),
    );
  });

  it('serializes concurrent writes from separate extension contexts', async () => {
    await vault.createVault(PASSWORD);
    vi.resetModules();
    const second = await import('../src/vault/storage');
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? second : vault).privateStorage.set({
          [`key${index}`]: index,
        }),
      ),
    );
    expect(Object.keys(await vault.privateStorage.get(null))).toHaveLength(12);
  });

  it('recovers from a failed Chrome notification after encrypted clear committed', async () => {
    await vault.createVault(PASSWORD);
    await vault.privateStorage.set({ source: 'deleted content' });
    const oldRevision = local.data[vault.VAULT_REVISION_KEY] as { id: string };
    local.failSetKey = vault.VAULT_REVISION_KEY;
    await expect(vault.privateStorage.clear()).rejects.toThrow(
      'notification interrupted',
    );
    expect(disk.records.size).toBe(0);
    expect(disk.events.has(oldRevision.id)).toBe(false);
    await vault.lockVault();
    await vault.unlockVault(PASSWORD);
    vi.resetModules();
    const restarted = await import('../src/vault/storage');
    await restarted.privateStorage.set({ fresh: 'new content' });
    expect(await restarted.privateStorage.get(null)).toEqual({
      fresh: 'new content',
    });
  });

  it('repairs a failed notification when the same committed write is retried', async () => {
    await vault.createVault(PASSWORD);
    vi.resetModules();
    const second = await import('../src/vault/storage');
    const listener = vi.fn();
    second.privateStorageChanges.addListener(listener);
    local.failSetKey = vault.VAULT_REVISION_KEY;
    await expect(
      vault.privateStorage.set({ settings: 'committed' }),
    ).rejects.toThrow('notification interrupted');
    expect(listener).not.toHaveBeenCalled();
    expect(await second.privateStorage.get('settings')).toEqual({
      settings: 'committed',
    });
    await vault.privateStorage.set({ settings: 'committed' });
    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledExactlyOnceWith(
        { settings: { newValue: 'committed' } },
        'local',
      ),
    );
    const revision = local.data[vault.VAULT_REVISION_KEY] as { id: string };
    expect(disk.events.has(revision.id)).toBe(true);
  });

  it('allows a write inside the outer data lock and makes a following lock invalidate access', async () => {
    await vault.createVault(PASSWORD);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const operation = navigator.locks.request(
      'attention-personal-data',
      async () => {
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        await vault.privateStorage.set({ pending: 'finished' });
      },
    );
    await started;
    const locking = vault.lockVault();
    release();
    await Promise.all([operation, locking]);
    expect(await vault.getVaultStatus()).toBe('locked');
    await expect(vault.privateStorage.get('pending')).rejects.toBeInstanceOf(
      vault.VaultLockedError,
    );
  });
});

describe('verified legacy migration and irreversible reset', () => {
  it('rejects a short password without touching legacy data', async () => {
    local.data.profile = 'original';
    await expect(vault.createVault('short')).rejects.toThrow('12 characters');
    expect(local.data).toEqual({ profile: 'original' });
    expect(disk.records.size).toBe(0);
  });

  it('migrates every local key and source library, then removes the plaintext copies', async () => {
    local.data = {
      profile: 'PRIVATE-PROFILE',
      futureUnknownKey: { token: 'PRIVATE-API-TOKEN' },
    };
    disk.legacy = { library: { pages: [{ body: 'PRIVATE-LIBRARY-TEXT' }] } };
    await vault.createVault(PASSWORD);
    expect(await vault.privateStorage.get(null)).toEqual({
      profile: 'PRIVATE-PROFILE',
      futureUnknownKey: { token: 'PRIVATE-API-TOKEN' },
      library: { pages: [{ body: 'PRIVATE-LIBRARY-TEXT' }] },
    });
    expect(Object.keys(local.data)).toEqual([vault.VAULT_METADATA_KEY]);
    expect(disk.legacy).toEqual({});
    expect(persistentSnapshot()).not.toContain('PRIVATE-');
  });

  it('retains original sources when ciphertext verification fails and resumes safely', async () => {
    local.data = { profile: 'original' };
    disk.legacy = { library: { pages: ['original source'] } };
    disk.corruptWrite = true;
    await expect(vault.createVault(PASSWORD)).rejects.toThrow('authenticated');
    expect(local.data.profile).toBe('original');
    expect(disk.legacy).toEqual({ library: { pages: ['original source'] } });
    expect(await vault.getVaultStatus()).toBe('locked');
    const before = persistentSnapshot();
    await expect(vault.unlockVault('wrong password')).rejects.toThrow(
      'Incorrect password',
    );
    expect(persistentSnapshot()).toBe(before);
    disk.corruptWrite = false;
    await vault.unlockVault(PASSWORD);
    expect(await vault.privateStorage.get('profile')).toEqual({
      profile: 'original',
    });
  });

  it('retains originals when a verification read fails', async () => {
    local.data = { profile: 'original' };
    disk.readFailure = true;
    await expect(vault.createVault(PASSWORD)).rejects.toThrow(
      'Read interrupted',
    );
    expect(local.data.profile).toBe('original');
    expect(session.data).toEqual({});
    disk.readFailure = false;
    await vault.unlockVault(PASSWORD);
    expect(await vault.privateStorage.get('profile')).toEqual({
      profile: 'original',
    });
  });

  it('does not overwrite a verified copy with a partially cleared legacy database on retry', async () => {
    local.data = { profile: 'original' };
    disk.legacy = { library: { pages: ['all original pages'] } };
    disk.clearLegacyFailure = disk.partiallyClear = true;
    await expect(vault.createVault(PASSWORD)).rejects.toThrow(
      'cleanup interrupted',
    );
    expect(disk.legacy).toEqual({ library: { pages: [] } });
    expect(await vault.getVaultStatus()).toBe('locked');
    expect(local.data.profile).toBeUndefined();
    disk.clearLegacyFailure = disk.partiallyClear = false;
    await vault.unlockVault(PASSWORD);
    expect(await vault.privateStorage.get(null)).toEqual({
      profile: 'original',
      library: { pages: ['all original pages'] },
    });
  });

  it('resets encrypted records, browser session secrets and all legacy sources while locked', async () => {
    await vault.createVault(PASSWORD);
    await vault.privateStorage.set({ profile: 'private' });
    await vault.lockVault();
    local.data.leftover = 'plaintext';
    disk.legacy = { library: 'legacy' };
    session.data.cache = 'old session data';
    await vault.resetVault();
    expect(await vault.getVaultStatus()).toBe('unconfigured');
    expect(local.data).toEqual({});
    expect(session.data).toEqual({});
    expect(disk.records.size).toBe(0);
    expect(disk.events.size).toBe(0);
    expect(disk.legacy).toEqual({});
    await vault.createVault(PASSWORD);
    expect(await vault.privateStorage.get(null)).toEqual({});
  });

  it('authenticates a resumed migration checkpoint before deleting remaining originals', async () => {
    disk.legacy = { library: { pages: ['original source'] } };
    disk.clearLegacyFailure = true;
    await expect(vault.createVault(PASSWORD)).rejects.toThrow(
      'cleanup interrupted',
    );
    const meta = local.data[vault.VAULT_METADATA_KEY] as {
      migrationProof: EncryptedRecord;
    };
    meta.migrationProof.ciphertext = 'AAAA';
    disk.clearLegacyFailure = false;
    await expect(vault.unlockVault(PASSWORD)).rejects.toThrow('authenticated');
    expect(disk.legacy).toEqual({ library: { pages: ['original source'] } });
    expect(session.data).toEqual({});
  });

  it('refuses resumed plaintext cleanup if a previously verified encrypted record disappeared', async () => {
    disk.legacy = { library: { pages: ['original source'] } };
    disk.clearLegacyFailure = true;
    await expect(vault.createVault(PASSWORD)).rejects.toThrow(
      'cleanup interrupted',
    );
    disk.records.clear();
    disk.clearLegacyFailure = false;
    await expect(vault.unlockVault(PASSWORD)).rejects.toThrow(
      'verification failed',
    );
    expect(disk.legacy).toEqual({ library: { pages: ['original source'] } });
    expect(session.data).toEqual({});
  });

  it('blocks reconfiguration and unlock after an interrupted reset until cleanup completes', async () => {
    await vault.createVault(PASSWORD);
    await vault.privateStorage.set({ profile: 'private' });
    disk.clearLegacyFailure = true;
    await expect(vault.resetVault()).rejects.toThrow('cleanup interrupted');
    expect(await vault.getVaultStatus()).toBe('locked');
    expect(session.data).toEqual({});
    await expect(vault.unlockVault(PASSWORD)).rejects.toThrow(
      'Reset the vault again',
    );
    await expect(vault.createVault(PASSWORD)).rejects.toThrow('already exists');
    disk.clearLegacyFailure = false;
    await vault.resetVault();
    await vault.createVault(PASSWORD);
    expect(await vault.privateStorage.get(null)).toEqual({});
  });

  it('keeps reset locked when encrypted database deletion fails and completes on retry', async () => {
    await vault.createVault(PASSWORD);
    await vault.privateStorage.set({ profile: 'private' });
    disk.deleteFailure = true;
    await expect(vault.resetVault()).rejects.toThrow(
      'database deletion interrupted',
    );
    expect(session.data).toEqual({});
    expect(await vault.getVaultStatus()).toBe('locked');
    await expect(vault.privateStorage.get(null)).rejects.toBeInstanceOf(
      vault.VaultLockedError,
    );
    disk.deleteFailure = false;
    await vault.resetVault();
    expect(await vault.getVaultStatus()).toBe('unconfigured');
    expect(disk.records.size).toBe(0);
  });

  it('invalidates access even if browser session removal fails during reset', async () => {
    await vault.createVault(PASSWORD);
    session.failClear = true;
    await expect(vault.resetVault()).rejects.toThrow(
      'storage clear interrupted',
    );
    expect(await vault.getVaultStatus()).toBe('locked');
    await expect(vault.getVaultEpoch()).rejects.toBeInstanceOf(
      vault.VaultLockedError,
    );
    await expect(
      vault.privateStorage.set({ restore: true }),
    ).rejects.toBeInstanceOf(vault.VaultLockedError);
    await vault.resetVault();
    expect(await vault.getVaultStatus()).toBe('unconfigured');
    expect(session.data).toEqual({});
  });

  it('completes an interrupted final metadata erase without restoring ciphertext', async () => {
    await vault.createVault(PASSWORD);
    await vault.privateStorage.set({ profile: 'private' });
    local.failClear = true;
    await expect(vault.resetVault()).rejects.toThrow(
      'storage clear interrupted',
    );
    expect(disk.records.size).toBe(0);
    expect(await vault.getVaultStatus()).toBe('locked');
    await vault.resetVault();
    await vault.createVault(PASSWORD);
    expect(await vault.privateStorage.get(null)).toEqual({});
  });

  it('rejects damaged metadata instead of silently treating the vault as unconfigured', async () => {
    local.data[vault.VAULT_METADATA_KEY] = { version: 99 };
    await expect(vault.getVaultStatus()).rejects.toThrow('damaged');
    await expect(vault.privateStorage.get(null)).rejects.toThrow('damaged');
    await vault.resetVault();
    expect(await vault.getVaultStatus()).toBe('unconfigured');
  });
});
