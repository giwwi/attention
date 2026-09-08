import { clearLegacyDatabases, readLegacyDatabases } from './legacy';
import {
  clearRecords,
  deleteVaultDatabase,
  readEvent,
  readLatestEvent,
  readRecord,
  readRecords,
  writeRecords,
  type EncryptedRecord,
} from './database';
import {
  decode,
  decrypt,
  encode,
  encrypt,
  importDataKey,
  KDF_ITERATIONS,
  passwordKey,
  random,
  recordDigest,
  recordId,
} from './cryptography';

export const VAULT_METADATA_KEY = '__attentionVaultMetadata';
export const VAULT_REVISION_KEY = '__attentionVaultRevision';
export const VAULT_SESSION_KEY = '__attentionVaultSession';
const RESERVED = new Set([VAULT_METADATA_KEY, VAULT_REVISION_KEY]);
type VaultStatus = 'unconfigured' | 'locked' | 'unlocked';
type Changes = Record<string, chrome.storage.StorageChange>;
type ChangeListener = (changes: Changes, area: string) => void;

interface Metadata {
  version: 1;
  id: string;
  state: 'pending' | 'ready';
  iterations: number;
  salt: string;
  wrappedKey: EncryptedRecord;
  migrationProof?: EncryptedRecord;
}

interface ResetMetadata {
  version: 1;
  id: string;
  state: 'resetting';
}

interface Session {
  version: 1;
  vaultId: string;
  epoch: string;
  key: string;
}

interface Context {
  metadata: Metadata;
  session: Session;
  raw: Uint8Array<ArrayBuffer>;
  key: CryptoKey;
}

export class VaultLockedError extends Error {
  constructor() {
    super('Unlock your Attention vault to access personal data.');
    this.name = 'VaultLockedError';
  }
}

const changeListeners = new Set<ChangeListener>();
const stateListeners = new Set<() => void>();
const seenEvents = new Set<string>();
let observing = false;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function notifyState(): void {
  for (const listener of stateListeners) {
    try {
      listener();
    } catch {
      /* One document must not break lifecycle completion. */
    }
  }
}

function notifyChanges(changes: Changes): void {
  if (Object.keys(changes).length === 0) return;
  for (const listener of changeListeners) {
    try {
      listener(structuredClone(changes), 'local');
    } catch {
      /* Listener isolation. */
    }
  }
}

function rememberEvent(id: string): void {
  seenEvents.add(id);
  if (seenEvents.size > 128)
    seenEvents.delete(seenEvents.values().next().value!);
}

function observe(): void {
  if (observing || !globalThis.chrome?.storage?.onChanged) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      (area === 'session' && changes[VAULT_SESSION_KEY]) ||
      (area === 'local' && changes[VAULT_METADATA_KEY])
    )
      notifyState();
    const revision: unknown =
      area === 'local' ? changes[VAULT_REVISION_KEY]?.newValue : undefined;
    if (
      !object(revision) ||
      typeof revision.id !== 'string' ||
      seenEvents.has(revision.id)
    )
      return;
    const id = revision.id;
    // The journal contains ciphertext only. Decrypt inside the same lock as
    // lifecycle operations, so a late event cannot reveal data after locking.
    void withVaultLock(async () => {
      if (seenEvents.has(id)) return;
      const context = await unlockedContext();
      if (revision.vaultId !== context.metadata.id) return;
      let event = await readEvent(id);
      let missedEvent = false;
      if (!event) {
        // The most recent journal keeps a cumulative key list. Even after
        // older entries expire, conservatively invalidate every changed key.
        const latest = await readLatestEvent();
        if (!latest) throw new Error('Vault notification is missing.');
        event = latest;
        missedEvent = true;
      }
      const payload = await eventKeys(context, event);
      const names = missedEvent ? payload.knownKeys : payload.keys;
      rememberEvent(id);
      await notifyCurrentChanges(context, names);
    }).catch(() => notifyState());
  });
  observing = true;
}

export function onVaultStateChanged(listener: () => void): () => void {
  observe();
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

/** Writer-local changes have exact old/new values. Cross-context notifications
 * coalesce to current decrypted values and omit oldValue; persisted journals
 * contain only key names, so deleted values cannot survive in event snapshots. */
export const privateStorageChanges = {
  addListener(listener: ChangeListener): void {
    observe();
    changeListeners.add(listener);
  },
  removeListener(listener: ChangeListener): void {
    changeListeners.delete(listener);
  },
};

async function withVaultLock<T>(work: () => Promise<T>): Promise<T> {
  observe();
  if (!globalThis.navigator?.locks)
    return Promise.reject(new Error('Secure vault coordination unavailable.'));
  return await navigator.locks.request('attention-vault', work);
}

async function lifecycle<T>(work: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks)
    return Promise.reject(new Error('Secure vault coordination unavailable.'));
  return await navigator.locks.request('attention-personal-data', () =>
    withVaultLock(work),
  );
}

async function trustedStorage(): Promise<void> {
  // storage.session never exposes the unlocked key to content scripts.
  await chrome.storage.session.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  await chrome.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
}

async function metadata(): Promise<Metadata | ResetMetadata | undefined> {
  const value: unknown = (await chrome.storage.local.get(VAULT_METADATA_KEY))[
    VAULT_METADATA_KEY
  ];
  if (value === undefined) return undefined;
  if (
    !object(value) ||
    value.version !== 1 ||
    typeof value.id !== 'string' ||
    value.id.length < 16
  )
    throw new Error('Vault metadata is damaged.');
  if (value.state === 'resetting') return value as unknown as ResetMetadata;
  if (
    (value.state !== 'ready' && value.state !== 'pending') ||
    !Number.isInteger(value.iterations) ||
    Number(value.iterations) < KDF_ITERATIONS ||
    Number(value.iterations) > 2_000_000 ||
    !object(value.wrappedKey) ||
    value.wrappedKey.version !== 1 ||
    value.wrappedKey.id !== value.id
  )
    throw new Error('Vault metadata is damaged.');
  decode(value.salt, 16);
  decode(value.wrappedKey.nonce, 12);
  decode(value.wrappedKey.ciphertext);
  return value as unknown as Metadata;
}

async function sessionFor(meta: Metadata): Promise<Session | undefined> {
  const value: unknown = (await chrome.storage.session.get(VAULT_SESSION_KEY))[
    VAULT_SESSION_KEY
  ];
  if (value === undefined) return undefined;
  if (
    !object(value) ||
    value.version !== 1 ||
    value.vaultId !== meta.id ||
    typeof value.epoch !== 'string' ||
    value.epoch.length < 16
  )
    throw new VaultLockedError();
  decode(value.key, 32);
  return value as unknown as Session;
}

async function unlockedContext(): Promise<Context> {
  await trustedStorage();
  const meta = await metadata();
  if (!meta || meta.state !== 'ready') throw new VaultLockedError();
  const session = await sessionFor(meta);
  if (!session) throw new VaultLockedError();
  const raw = decode(session.key, 32);
  return { metadata: meta, session, raw, key: await importDataKey(raw) };
}

export function getVaultStatus(): Promise<VaultStatus> {
  return withVaultLock(async () => {
    await trustedStorage();
    const meta = await metadata();
    if (!meta) return 'unconfigured';
    if (meta.state !== 'ready') return 'locked';
    try {
      return (await sessionFor(meta)) ? 'unlocked' : 'locked';
    } catch (error) {
      if (error instanceof VaultLockedError) return 'locked';
      throw error;
    }
  });
}

export function getVaultEpoch(): Promise<string> {
  return withVaultLock(async () => (await unlockedContext()).session.epoch);
}

function logicalKey(key: string): void {
  if (!key || key.length > 1024 || RESERVED.has(key))
    throw new Error('Invalid private storage key.');
}

function serialize(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error();
    return serialized;
  } catch {
    throw new Error('Private storage requires JSON-compatible data.');
  }
}

async function openRecord(
  context: Context,
  record: EncryptedRecord,
): Promise<[string, unknown]> {
  const value = await decrypt(
    context.key,
    context.metadata.id,
    'record',
    record,
  );
  if (
    !object(value) ||
    typeof value.key !== 'string' ||
    !Object.hasOwn(value, 'value')
  )
    throw new Error('Vault record is damaged.');
  logicalKey(value.key);
  if ((await recordId(context.raw, value.key)) !== record.id)
    throw new Error('Vault record is damaged.');
  return [value.key, value.value];
}

async function readAll(context: Context): Promise<Record<string, unknown>> {
  return Object.fromEntries(
    await Promise.all(
      (await readRecords()).map((record) => openRecord(context, record)),
    ),
  );
}

async function readValue(
  context: Context,
  key: string,
): Promise<{ value: unknown } | undefined> {
  logicalKey(key);
  const record = await readRecord(await recordId(context.raw, key));
  if (!record) return undefined;
  const [name, value] = await openRecord(context, record);
  if (name !== key) throw new Error('Vault record is damaged.');
  return { value };
}

async function seal(
  context: Context,
  name: string,
  value: unknown,
): Promise<EncryptedRecord> {
  logicalKey(name);
  return encrypt(
    context.key,
    context.metadata.id,
    'record',
    await recordId(context.raw, name),
    { key: name, value },
  );
}

async function notifyCurrentChanges(
  context: Context,
  names: string[],
): Promise<void> {
  const changes = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [
        name,
        { newValue: (await readValue(context, name))?.value },
      ]),
    ),
  );
  notifyChanges(changes);
}

async function repairRevision(
  context: Context,
  event: EncryptedRecord,
): Promise<void> {
  const revision: unknown = (
    await chrome.storage.local.get(VAULT_REVISION_KEY)
  )[VAULT_REVISION_KEY];
  if (
    object(revision) &&
    revision.id === event.id &&
    revision.vaultId === context.metadata.id
  )
    return;
  const payload = await eventKeys(context, event);
  rememberEvent(event.id);
  await chrome.storage.local.set({
    [VAULT_REVISION_KEY]: { id: event.id, vaultId: context.metadata.id },
  });
  await notifyCurrentChanges(context, payload.keys);
}

async function eventKeys(
  context: Context,
  event: EncryptedRecord,
): Promise<{ keys: string[]; knownKeys: string[] }> {
  const payload = await decrypt(
    context.key,
    context.metadata.id,
    'event',
    event,
  );
  if (
    !object(payload) ||
    !Array.isArray(payload.keys) ||
    !Array.isArray(payload.knownKeys)
  )
    throw new Error('Vault notification is damaged.');
  for (const name of [...payload.keys, ...payload.knownKeys]) {
    if (typeof name !== 'string')
      throw new Error('Vault notification is damaged.');
    logicalKey(name);
  }
  return payload as { keys: string[]; knownKeys: string[] };
}

async function publish(
  context: Context,
  changes: Changes,
  put: EncryptedRecord[],
  remove: string[],
  clear = false,
): Promise<void> {
  // IDB commits and Chrome notifications cannot share one transaction. Recover
  // a committed but unpublished change before accepting another mutation, even
  // if an idempotent retry would otherwise be a no-op.
  const previous = await readLatestEvent();
  if (previous) await repairRevision(context, previous);
  if (!Object.keys(changes).length && !clear) return;
  const id = crypto.randomUUID();
  const keys = Object.keys(changes);
  const knownKeys = [
    ...new Set([
      ...(previous ? (await eventKeys(context, previous)).knownKeys : []),
      ...keys,
    ]),
  ];
  const event = await encrypt(context.key, context.metadata.id, 'event', id, {
    keys,
    knownKeys,
  });
  await writeRecords(put, remove, event, clear);
  rememberEvent(id);
  notifyChanges(changes);
  await chrome.storage.local.set({
    [VAULT_REVISION_KEY]: { id, vaultId: context.metadata.id },
  });
}

type StorageKeys = string | string[] | Record<string, unknown> | null;

const area = {
  get(keys?: StorageKeys): Promise<Record<string, unknown>> {
    return withVaultLock(async () => {
      const context = await unlockedContext();
      if (keys == null) return readAll(context);
      const names =
        typeof keys === 'string'
          ? [keys]
          : Array.isArray(keys)
            ? keys
            : Object.keys(keys);
      const result: Array<[string, unknown]> = [];
      for (const name of names) {
        const record = await readValue(context, name);
        if (record) result.push([name, record.value]);
        else if (object(keys)) result.push([name, structuredClone(keys[name])]);
      }
      return Object.fromEntries(result);
    });
  },
  set(items: Record<string, unknown>): Promise<void> {
    return withVaultLock(async () => {
      const context = await unlockedContext();
      if (!object(items))
        throw new Error('Private storage requires an object.');
      const changes: Changes = Object.create(null) as Changes;
      const put: EncryptedRecord[] = [];
      for (const [name, rawValue] of Object.entries(items)) {
        const value = JSON.parse(serialize(rawValue)) as unknown;
        const previous = await readValue(context, name);
        if (previous && serialize(previous.value) === serialize(value))
          continue;
        changes[name] = {
          ...(previous ? { oldValue: previous.value } : {}),
          newValue: value,
        };
        put.push(await seal(context, name, value));
      }
      await publish(context, changes, put, []);
    });
  },
  remove(keys: string | string[]): Promise<void> {
    return withVaultLock(async () => {
      const context = await unlockedContext();
      const changes: Changes = Object.create(null) as Changes;
      const remove: string[] = [];
      for (const name of typeof keys === 'string' ? [keys] : keys) {
        const previous = await readValue(context, name);
        if (!previous) continue;
        changes[name] = { oldValue: previous.value };
        remove.push(await recordId(context.raw, name));
      }
      await publish(context, changes, [], remove);
    });
  },
  clear(): Promise<void> {
    return withVaultLock(async () => {
      const context = await unlockedContext();
      const changes = Object.fromEntries(
        Object.entries(await readAll(context)).map(([name, value]) => [
          name,
          { oldValue: value },
        ]),
      );
      await publish(context, changes, [], [], true);
    });
  },
  getBytesInUse(keys?: string | string[] | null): Promise<number> {
    return area
      .get(keys)
      .then(
        (values) => new TextEncoder().encode(JSON.stringify(values)).byteLength,
      );
  },
  getKeys(): Promise<string[]> {
    return area.get(null).then(Object.keys);
  },
  async setAccessLevel(): Promise<void> {
    await trustedStorage();
  },
};

/** Promise API used by existing repositories; plaintext never reaches storage.local. */
export const privateStorage = area as unknown as chrome.storage.StorageArea;

async function migrate(context: Context): Promise<void> {
  const local = await chrome.storage.local.get(null);
  const entries = Object.entries(local).filter(([name]) => !RESERVED.has(name));
  if (!context.metadata.migrationProof) {
    const legacy = await readLegacyDatabases();
    for (const [name, value] of Object.entries(legacy)) {
      if (Object.hasOwn(local, name))
        throw new Error('Legacy storage contains conflicting records.');
      entries.push([name, value]);
    }
    const normalized = entries.map(
      ([name, value]) =>
        [name, JSON.parse(serialize(value)) as unknown] as const,
    );
    const sealed = await Promise.all(
      normalized.map(([name, value]) => seal(context, name, value)),
    );
    await writeRecords(sealed);
    // Every copied record must survive an actual read and authentication before
    // any source is deleted. A pending marker survives every interruption.
    for (const [name, value] of normalized) {
      const copied = await readValue(context, name);
      if (!copied || serialize(copied.value) !== serialize(value))
        throw new Error(
          'Encrypted migration verification failed. Original data was retained.',
        );
    }
    await readAll(context);
    // Persist this before cleanup: retrying a partially cleared legacy library
    // must never replace the complete, verified encrypted copy with a subset.
    const manifest = await Promise.all(
      sealed.map(async (record) => ({
        id: record.id,
        digest: await recordDigest(record),
      })),
    );
    context.metadata = {
      ...context.metadata,
      migrationProof: await encrypt(
        context.key,
        context.metadata.id,
        'migration',
        context.metadata.id,
        manifest,
      ),
    };
    await chrome.storage.local.set({ [VAULT_METADATA_KEY]: context.metadata });
  }
  const manifest = await decrypt(
    context.key,
    context.metadata.id,
    'migration',
    context.metadata.migrationProof!,
  );
  if (!Array.isArray(manifest))
    throw new Error('Vault migration checkpoint is damaged.');
  for (const entry of manifest) {
    if (
      !object(entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.digest !== 'string'
    )
      throw new Error('Vault migration checkpoint is damaged.');
    const record = await readRecord(entry.id);
    if (!record || (await recordDigest(record)) !== entry.digest)
      throw new Error(
        'Encrypted migration verification failed. Original data was retained.',
      );
  }
  await readAll(context);
  if (entries.length)
    await chrome.storage.local.remove(entries.map(([name]) => name));
  await clearLegacyDatabases();
  context.metadata = { ...context.metadata, state: 'ready' };
  await chrome.storage.local.set({ [VAULT_METADATA_KEY]: context.metadata });
}

async function installSession(context: Context): Promise<void> {
  context.session = {
    version: 1,
    vaultId: context.metadata.id,
    epoch: crypto.randomUUID(),
    key: encode(context.raw),
  };
  await chrome.storage.session.set({ [VAULT_SESSION_KEY]: context.session });
  notifyState();
}

export function createVault(password: string): Promise<void> {
  return lifecycle(async () => {
    if (typeof password !== 'string' || password.length < 12)
      throw new Error('Use a vault password with at least 12 characters.');
    await trustedStorage();
    if (await metadata())
      throw new Error('A vault already exists. Unlock it or reset it first.');
    const id = crypto.randomUUID();
    const salt = encode(random(16));
    const raw = random(32);
    const wrappingKey = await passwordKey(password, salt, KDF_ITERATIONS);
    const meta: Metadata = {
      version: 1,
      id,
      state: 'pending',
      iterations: KDF_ITERATIONS,
      salt,
      wrappedKey: await encrypt(wrappingKey, id, 'key', id, encode(raw)),
    };
    await chrome.storage.session.remove(VAULT_SESSION_KEY);
    await clearRecords();
    await chrome.storage.local.set({ [VAULT_METADATA_KEY]: meta });
    const context: Context = {
      metadata: meta,
      raw,
      key: await importDataKey(raw),
      session: { version: 1, vaultId: id, epoch: '', key: '' },
    };
    try {
      await migrate(context);
      await installSession(context);
    } finally {
      raw.fill(0);
    }
  });
}

export function unlockVault(password: string): Promise<void> {
  return lifecycle(async () => {
    await trustedStorage();
    const meta = await metadata();
    if (!meta) throw new Error('Create an Attention vault first.');
    if (meta.state === 'resetting')
      throw new Error(
        'Vault reset was interrupted. Reset the vault again to finish erasing data.',
      );
    let raw: Uint8Array<ArrayBuffer>;
    try {
      const key = await passwordKey(password, meta.salt, meta.iterations);
      raw = decode(await decrypt(key, meta.id, 'key', meta.wrappedKey), 32);
    } catch {
      throw new Error('Incorrect password, or vault data is damaged.');
    }
    const context: Context = {
      metadata: meta,
      raw,
      key: await importDataKey(raw),
      session: { version: 1, vaultId: meta.id, epoch: '', key: '' },
    };
    try {
      if (meta.state === 'pending') await migrate(context);
      else await readAll(context);
      await installSession(context);
    } finally {
      raw.fill(0);
    }
  });
}

export function lockVault(): Promise<void> {
  return lifecycle(async () => {
    await trustedStorage();
    await chrome.storage.session.remove(VAULT_SESSION_KEY);
    notifyState();
  });
}

export function resetVault(): Promise<void> {
  return lifecycle(async () => {
    await trustedStorage();
    // The marker blocks create/unlock even when cleanup fails partway through.
    await chrome.storage.local.set({
      [VAULT_METADATA_KEY]: {
        version: 1,
        id: crypto.randomUUID(),
        state: 'resetting',
      } satisfies ResetMetadata,
    });
    await chrome.storage.session.clear();
    notifyState();
    await deleteVaultDatabase();
    await clearLegacyDatabases();
    await chrome.storage.local.clear();
    seenEvents.clear();
    notifyState();
  });
}
