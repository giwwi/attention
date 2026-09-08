import { ensureVaultUnlocked, createVaultLockButton } from './ui';
import { getVaultEpoch, getVaultStatus, onVaultStateChanged } from './storage';

/** No private controllers or imports run until this gate resolves. */
export async function initializeVaultPage(): Promise<void> {
  await ensureVaultUnlocked();
  await getVaultEpoch();
  let invalidated = false;
  const invalidate = (): void => {
    if (invalidated) return;
    invalidated = true;
    // Remove secrets, drafts and rendered private data before navigating.
    document.body.replaceChildren();
    // Reset broadcasts its invalidation before erasing the stores. A reload
    // here can destroy the very page performing that reset. The status read
    // shares the vault lock, so it waits for the lifecycle operation to settle.
    const reload = (): void => window.location.reload();
    void getVaultStatus().then(reload, reload);
  };
  onVaultStateChanged(invalidate);
}

export function installVaultLockControl(): void {
  if (document.getElementById('vault-lock')) return;
  const button = createVaultLockButton(document.documentElement.lang);
  button.id = 'vault-lock';
  button.classList.add('text-button');
  const host =
    document.querySelector('header') ?? document.querySelector('main');
  host?.append(button);
}
