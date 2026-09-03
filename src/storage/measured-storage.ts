import { measureAsync } from '../performance/metrics';

export interface MeasuredStorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(keys: string | string[]): Promise<void>;
}

export function measuredStorageGet(
  storage: Pick<MeasuredStorageArea, 'get'>,
  subsystem: string,
  keys?: string | string[] | null,
): Promise<Record<string, unknown>> {
  return measureAsync(`storage.${subsystem}.get`, () => storage.get(keys));
}

export function measuredStorageSet(
  storage: Pick<MeasuredStorageArea, 'set'>,
  subsystem: string,
  items: Record<string, unknown>,
): Promise<void> {
  return measureAsync(`storage.${subsystem}.set`, () => storage.set(items));
}

export function measuredStorageRemove(
  storage: Required<Pick<MeasuredStorageArea, 'remove'>>,
  subsystem: string,
  keys: string | string[],
): Promise<void> {
  return measureAsync(`storage.${subsystem}.remove`, () =>
    storage.remove(keys),
  );
}
