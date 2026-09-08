import { vi } from 'vitest';

/** One lock service shared by independently imported extension contexts. */
export function installDataLocks(): void {
  const queues = new Map<string, Promise<unknown>>();
  vi.stubGlobal('navigator', {
    locks: {
      request<T>(name: string, callback: () => Promise<T>): Promise<T> {
        const next = (queues.get(name) ?? Promise.resolve()).then(callback);
        queues.set(
          name,
          next.catch(() => undefined),
        );
        return next;
      },
    },
  });
}

export class DataTestStorage {
  data: Record<string, unknown> = {};
  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys == null) return structuredClone(this.data);
    return Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys]).map((key) => [key, this.data[key]]),
    );
  }
  async set(values: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, structuredClone(values));
  }
  async clear(): Promise<void> {
    this.data = {};
  }
  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys])
      delete this.data[key];
  }
  get area(): chrome.storage.StorageArea {
    return this as unknown as chrome.storage.StorageArea;
  }
}
