import type { PageCapture, SavedMaterial } from '../shared/types';
import { STORAGE_RETENTION_LIMITS } from '../storage/limits';

export const MAX_SAVED_MATERIALS = STORAGE_RETENTION_LIMITS.savedMaterials;

export function upsertSavedMaterial(
  saved: SavedMaterial[],
  capture: PageCapture,
  savedAt: string,
): SavedMaterial[] {
  return [
    { capture, savedAt },
    ...saved.filter((item) => item.capture.url !== capture.url),
  ].slice(0, MAX_SAVED_MATERIALS);
}

export function removeSavedMaterial(
  saved: SavedMaterial[],
  pageUrl: string,
): SavedMaterial[] {
  return saved.filter((item) => item.capture.url !== pageUrl);
}

export function isOpenableMaterialUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
