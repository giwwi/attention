import { expect, vi } from 'vitest';

// Existing business-unit tests deliberately inject plain in-memory Chrome
// storage. Keep their storage boundary independent of encryption infrastructure;
// vault-specific suites exercise the real boundary or install their own mocks.
const testPath = expect.getState().testPath ?? '';
const filename = testPath.split('/').at(-1) ?? '';
if (!filename.includes('vault')) {
  vi.doMock('../src/vault/storage', () => {
    const privateStorage = new Proxy({} as chrome.storage.StorageArea, {
      get(_target, property) {
        const storage = globalThis.chrome?.storage?.local;
        if (property === 'setAccessLevel') {
          return async (options: { accessLevel: 'TRUSTED_CONTEXTS' }) =>
            storage?.setAccessLevel?.(options);
        }
        const member = storage?.[property as keyof chrome.storage.StorageArea];
        return typeof member === 'function' ? member.bind(storage) : member;
      },
    });
    const privateStorageChanges = {
      addListener: (
        ...args: Parameters<typeof chrome.storage.onChanged.addListener>
      ) => globalThis.chrome?.storage?.onChanged?.addListener(...args),
      removeListener: (
        ...args: Parameters<typeof chrome.storage.onChanged.removeListener>
      ) => globalThis.chrome?.storage?.onChanged?.removeListener(...args),
    };
    class VaultLockedError extends Error {}
    return {
      privateStorage,
      privateStorageChanges,
      VaultLockedError,
      getVaultStatus: async () => 'unlocked',
      getVaultEpoch: async () => 'business-unit-test-vault-epoch',
      onVaultStateChanged: () => () => undefined,
      resetVault: async () => {
        const { deleteAllAttentionData } =
          await import('../src/privacy/data-erasure');
        await deleteAllAttentionData(
          chrome.storage.local,
          chrome.storage.session,
        );
      },
    };
  });
}
