export type PerformanceMetricName =
  | 'extraction.capture-document'
  | `analysis.${'local' | 'ai'}`
  | `storage.${string}.${'get' | 'set' | 'remove'}`
  | `cache.page-capture.${'hit' | 'miss'}`;

export interface PerformanceMetricSummary {
  name: PerformanceMetricName;
  count: number;
  totalMs: number;
  averageMs: number;
  minimumMs: number;
  maximumMs: number;
  lastMs: number;
}

interface MutableMetricSummary {
  count: number;
  totalMs: number;
  minimumMs: number;
  maximumMs: number;
  lastMs: number;
}

const metricSummaries = new Map<PerformanceMetricName, MutableMetricSummary>();
const MAX_BROWSER_ENTRIES_PER_METRIC = 20;

function clockNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function exposeBrowserMeasure(name: PerformanceMetricName, durationMs: number) {
  const browserName = `attention:${name}`;
  try {
    const entries = globalThis.performance?.getEntriesByName?.(browserName);
    if (entries && entries.length >= MAX_BROWSER_ENTRIES_PER_METRIC) {
      globalThis.performance.clearMeasures(browserName);
    }
    globalThis.performance?.measure?.(browserName, {
      start: 0,
      duration: durationMs,
    });
  } catch {
    // Performance entries are diagnostic only and must never affect product flow.
  }
}

export function recordPerformanceMetric(
  name: PerformanceMetricName,
  durationMs: number,
): void {
  const duration = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
  const current = metricSummaries.get(name);
  if (current) {
    current.count += 1;
    current.totalMs += duration;
    current.minimumMs = Math.min(current.minimumMs, duration);
    current.maximumMs = Math.max(current.maximumMs, duration);
    current.lastMs = duration;
  } else {
    metricSummaries.set(name, {
      count: 1,
      totalMs: duration,
      minimumMs: duration,
      maximumMs: duration,
      lastMs: duration,
    });
  }
  exposeBrowserMeasure(name, duration);
}

export function measureSync<T>(
  name: PerformanceMetricName,
  operation: () => T,
): T {
  const startedAt = clockNow();
  try {
    return operation();
  } finally {
    recordPerformanceMetric(name, clockNow() - startedAt);
  }
}

export async function measureAsync<T>(
  name: PerformanceMetricName,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = clockNow();
  try {
    return await operation();
  } finally {
    recordPerformanceMetric(name, clockNow() - startedAt);
  }
}

export function getPerformanceMetricsSnapshot(): PerformanceMetricSummary[] {
  return [...metricSummaries.entries()]
    .map(([name, summary]) => ({
      name,
      count: summary.count,
      totalMs: Number(summary.totalMs.toFixed(2)),
      averageMs: Number((summary.totalMs / summary.count).toFixed(2)),
      minimumMs: Number(summary.minimumMs.toFixed(2)),
      maximumMs: Number(summary.maximumMs.toFixed(2)),
      lastMs: Number(summary.lastMs.toFixed(2)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function clearPerformanceMetrics(): void {
  metricSummaries.clear();
  try {
    for (const entry of globalThis.performance?.getEntriesByType?.('measure') ??
      []) {
      if (entry.name.startsWith('attention:')) {
        globalThis.performance.clearMeasures(entry.name);
      }
    }
  } catch {
    // Clearing diagnostics must not affect runtime behavior.
  }
}
