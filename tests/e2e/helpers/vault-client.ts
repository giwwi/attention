// Bundled ONLY into a temporary E2E extension copy by vault.ts. Never a release entrypoint.
import {
  createVault,
  getVaultEpoch,
  getVaultStatus,
  lockVault,
  privateStorage,
  resetVault,
  unlockVault,
} from '../../../src/vault/storage';

const api = {
  createVault,
  getVaultEpoch,
  getVaultStatus,
  lockVault,
  privateStorage,
  resetVault,
  unlockVault,
};

declare global {
  var attentionVault: typeof api;
}

globalThis.attentionVault = api;
