import { deleteProfile, loadProfile, saveProfile } from '../profile/storage';
import {
  beginDataOperation,
  commitDataOperation,
  assertDataOperationCurrent,
} from '../privacy/data-operations';
import {
  clearProfileHandoffState,
  loadProfileHandoffState,
  saveProfileHandoffState,
} from './handoff/state';

/** The regular editor always uses encrypted storage and vault-bound operations. */
export const profilePersistence = {
  deleteProfile,
  loadProfile,
  saveProfile,
  beginDataOperation,
  commitDataOperation,
  assertDataOperationCurrent,
  clearProfileHandoffState,
  loadProfileHandoffState,
  saveProfileHandoffState,
};

export type ProfilePersistence = typeof profilePersistence;

/** Returning from password creation must leave the reviewed draft intact. */
export class ProfileSaveDeferredError extends Error {}
