import { describe, expect, it } from 'vitest';
import {
  issuePublicSessionToken,
  verifyPublicSessionAuthorization,
} from '../api/session-auth';
import {
  clearDiagnostics,
  diagnosticsExport,
  loadDiagnostics,
  recordDiagnostic,
} from '../src/diagnostics/diagnostics';
import { deleteAllAttentionData } from '../src/privacy/data-erasure';
import {
  loadPrivacySettings,
  saveLocalOnlyMode,
} from '../src/privacy/settings';

class MemoryStorage {
  readonly data: Record<string, unknown> = {};

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys == null) return { ...this.data };
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(requested.map((key) => [key, this.data[key]]));
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, structuredClone(items));
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      delete this.data[key];
    }
  }

  async clear(): Promise<void> {
    for (const key of Object.keys(this.data)) delete this.data[key];
  }
}

describe('privacy and public session boundaries', () => {
  it('defaults to a fail-closed local-only mode', async () => {
    const storage = new MemoryStorage();
    expect(
      await loadPrivacySettings(
        storage as unknown as chrome.storage.StorageArea,
      ),
    ).toMatchObject({ localOnly: true });

    await saveLocalOnlyMode(
      false,
      storage as unknown as chrome.storage.StorageArea,
      new Date('2026-08-27T10:00:00.000Z'),
    );
    expect(
      await loadPrivacySettings(
        storage as unknown as chrome.storage.StorageArea,
      ),
    ).toEqual({
      localOnly: false,
      updatedAt: '2026-08-27T10:00:00.000Z',
    });
  });

  it('accepts only a signed, scoped, short-lived user session', async () => {
    const claims = {
      sub: 'user-123',
      aud: 'attention-analyze',
      iat: 1_788_000_000,
      exp: 1_788_003_600,
      jti: 'session-123',
    };
    const token = await issuePublicSessionToken(claims, 'test-secret');

    await expect(
      verifyPublicSessionAuthorization(
        `Bearer ${token}`,
        'test-secret',
        'attention-analyze',
        claims.iat + 60,
      ),
    ).resolves.toEqual(claims);
    await expect(
      verifyPublicSessionAuthorization(
        `Bearer ${token}`,
        'wrong-secret',
        'attention-analyze',
        claims.iat + 60,
      ),
    ).resolves.toBeNull();
    await expect(
      verifyPublicSessionAuthorization(
        `Bearer ${token}`,
        'test-secret',
        'other-audience',
        claims.iat + 60,
      ),
    ).resolves.toBeNull();
  });

  it('exports structured diagnostics without raw errors or sensitive values', async () => {
    const storage =
      new MemoryStorage() as unknown as chrome.storage.StorageArea;
    await recordDiagnostic(
      {
        subsystem: 'ai',
        operation: 'analyze-article',
        code: 'AI_REQUEST_FAILED',
        error: new Error(
          'fetch failed for https://private.example/?token=secret-key',
        ),
      },
      storage,
      new Date('2026-08-27T10:00:00.000Z'),
    );
    const entries = await loadDiagnostics(storage);
    const exported = diagnosticsExport(entries);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      code: 'AI_REQUEST_FAILED',
      category: 'network',
    });
    expect(exported).not.toContain('private.example');
    expect(exported).not.toContain('secret-key');

    await clearDiagnostics(storage);
    await expect(loadDiagnostics(storage)).resolves.toEqual([]);
  });

  it('deletes both persistent and session-scoped Attention data', async () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    await local.set({ profile: { private: true }, aiKey: 'do-not-keep' });
    await session.set({ publicSession: 'do-not-keep' });

    await deleteAllAttentionData(
      local as unknown as chrome.storage.StorageArea,
      session as unknown as chrome.storage.StorageArea,
      async () => undefined,
    );

    expect(local.data).toEqual({});
    expect(session.data).toEqual({});
  });
});
