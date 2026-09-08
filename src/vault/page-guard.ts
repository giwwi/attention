import { ensureVaultUnlocked, createVaultLockButton } from './ui';
import { getVaultEpoch, onVaultStateChanged } from './storage';

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
    window.location.reload();
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
