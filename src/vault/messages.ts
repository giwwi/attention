export const VAULT_STATUS_TYPE = 'ATTENTION_VAULT/STATUS';
export const VAULT_CHANGED_TYPE = 'ATTENTION_VAULT/CHANGED';
export const VAULT_HANDOFF_NOTICE_TYPE = 'ATTENTION_VAULT/HANDOFF_NOTICE';
export const PROFILE_SETUP_OPEN_TYPE = 'ATTENTION_PROFILE/OPEN_SETUP';

export interface VaultPublicStatus {
  ok: true;
  unlocked: boolean;
  unconfigured?: boolean;
  profileReady?: boolean;
  epoch?: string;
}
