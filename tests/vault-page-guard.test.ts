import { afterEach, expect, it, vi } from 'vitest';

const vault = vi.hoisted(() => ({
  ensureVaultUnlocked: vi.fn(async () => {}),
  getVaultEpoch: vi.fn(async () => 'test-epoch'),
  getVaultStatus: vi.fn(),
  onVaultStateChanged: vi.fn<(listener: () => void) => void>(),
}));
vi.mock('../src/vault/ui', () => ({
  ensureVaultUnlocked: vault.ensureVaultUnlocked,
  createVaultLockButton: vi.fn(),
}));
vi.mock('../src/vault/storage', () => vault);

afterEach(() => vi.unstubAllGlobals());

it.each(['complete', 'fail'])(
  'hides private UI immediately but lets reset %s before reloading',
  async (outcome) => {
    let settle!: () => void;
    vault.getVaultStatus.mockReturnValue(
      new Promise((resolve, reject) => {
        settle = () =>
          outcome === 'complete'
            ? resolve('unconfigured')
            : reject(new Error('Reset failed'));
      }),
    );
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    document.body.innerHTML = '<main>Private saved articles</main>';
    const { initializeVaultPage } = await import('../src/vault/page-guard');
    await initializeVaultPage();
    const invalidate = vault.onVaultStateChanged.mock
      .lastCall![0] as () => void;
    invalidate();
    expect(document.body.textContent).toBe('');
    expect(reload).not.toHaveBeenCalled();
    invalidate();
    settle();
    await Promise.resolve();
    expect(reload).toHaveBeenCalledOnce();
  },
);
