import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPerformanceMetrics,
  getPerformanceMetricsSnapshot,
  measureAsync,
  measureSync,
} from '../src/performance/metrics';
import {
  measuredStorageGet,
  measuredStorageSet,
} from '../src/storage/measured-storage';

describe('performance metrics', () => {
  beforeEach(() => clearPerformanceMetrics());

  it('aggregates synchronous and asynchronous durations', async () => {
    expect(measureSync('extraction.capture-document', () => 42)).toBe(42);
    await expect(
      measureAsync('analysis.local', async () => 'done'),
    ).resolves.toBe('done');

    const snapshot = getPerformanceMetricsSnapshot();
    expect(snapshot.map((metric) => metric.name)).toEqual([
      'analysis.local',
      'extraction.capture-document',
    ]);
    expect(snapshot.every((metric) => metric.count === 1)).toBe(true);
    expect(snapshot.every((metric) => metric.lastMs >= 0)).toBe(true);
  });

  it('measures storage reads and writes without changing their contract', async () => {
    const data: Record<string, unknown> = { value: 3 };
    const storage = {
      get: async () => data,
      set: async (items: Record<string, unknown>) => {
        Object.assign(data, items);
      },
    };

    await expect(measuredStorageGet(storage, 'test', 'value')).resolves.toEqual(
      { value: 3 },
    );
    await measuredStorageSet(storage, 'test', { next: 4 });

    expect(data.next).toBe(4);
    expect(getPerformanceMetricsSnapshot()).toMatchObject([
      { name: 'storage.test.get', count: 1 },
      { name: 'storage.test.set', count: 1 },
    ]);
  });

  it('records failed operations before rethrowing', async () => {
    await expect(
      measureAsync('analysis.ai', async () => {
        throw new Error('network');
      }),
    ).rejects.toThrow('network');

    expect(getPerformanceMetricsSnapshot()).toMatchObject([
      { name: 'analysis.ai', count: 1 },
    ]);
  });
});
