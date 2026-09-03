import type {
  AttentionScenario,
  DecisionRecord,
  HoverPreviewAction,
  HoverPreviewEventMessage,
  HoverPreviewVerdict,
  StoredEvaluation,
} from '../shared/types';
import { STORAGE_RETENTION_LIMITS } from '../storage/limits';
import {
  measuredStorageGet,
  measuredStorageSet,
} from '../storage/measured-storage';

export const MATERIAL_MEMORY_KEY = 'materialMemory';
export const MAX_MATERIAL_MEMORY_RECORDS =
  STORAGE_RETENTION_LIMITS.materialMemory;
export const HOVER_CALIBRATION_VERSION = 'hover-calibration-v1';

interface StorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface MaterialPreviewMemory {
  scenario: AttentionScenario;
  verdict: HoverPreviewVerdict;
  recommendedAction: HoverPreviewAction;
  source: 'full-analysis' | 'title-preview';
  signalIds: string[];
  shownCount: number;
  openedCount: number;
  lastShownAt: string;
  lastOpenedAt: string | null;
}

export interface MaterialMemoryRecord {
  url: string;
  title: string;
  preview: MaterialPreviewMemory | null;
  storedEvaluation: StoredEvaluation | null;
  decision: DecisionRecord | null;
  actualUtility: number | null;
  actualUtilityAt: string | null;
  actualUtilityScenario: AttentionScenario | null;
  updatedAt: string;
}

export interface HoverCalibration {
  version: typeof HOVER_CALIBRATION_VERSION;
  sampleSize: number;
  positiveThreshold: number;
  negativeThreshold: number;
}

export const DEFAULT_HOVER_CALIBRATION: HoverCalibration = {
  version: HOVER_CALIBRATION_VERSION,
  sampleSize: 0,
  positiveThreshold: 0.5,
  negativeThreshold: 0.5,
};

export function canonicalMaterialUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (
        key.toLowerCase().startsWith('utm_') ||
        ['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(key.toLowerCase())
      ) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value;
  }
}

function isPreviewMemory(value: unknown): value is MaterialPreviewMemory {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    (item.scenario === undefined ||
      ['work', 'learn', 'explore', 'relax'].includes(String(item.scenario))) &&
    ['read', 'maybe', 'skip'].includes(String(item.verdict)) &&
    ['open', 'maybe', 'save', 'skip'].includes(
      String(item.recommendedAction),
    ) &&
    (item.source === 'full-analysis' || item.source === 'title-preview') &&
    Array.isArray(item.signalIds) &&
    item.signalIds.every((id) => typeof id === 'string') &&
    typeof item.shownCount === 'number' &&
    typeof item.openedCount === 'number' &&
    typeof item.lastShownAt === 'string' &&
    (typeof item.lastOpenedAt === 'string' || item.lastOpenedAt === null)
  );
}

function isMaterialMemoryRecord(value: unknown): value is MaterialMemoryRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.url === 'string' &&
    typeof item.title === 'string' &&
    (item.preview === null || isPreviewMemory(item.preview)) &&
    (item.storedEvaluation === null ||
      typeof item.storedEvaluation === 'object') &&
    (item.decision === null || typeof item.decision === 'object') &&
    (item.actualUtility === null || typeof item.actualUtility === 'number') &&
    (item.actualUtilityAt === null ||
      typeof item.actualUtilityAt === 'string') &&
    (item.actualUtilityScenario === undefined ||
      item.actualUtilityScenario === null ||
      ['work', 'learn', 'explore', 'relax'].includes(
        String(item.actualUtilityScenario),
      )) &&
    typeof item.updatedAt === 'string'
  );
}

export async function loadMaterialMemory(
  storage: StorageArea = chrome.storage.local,
): Promise<MaterialMemoryRecord[]> {
  const stored = await measuredStorageGet(
    storage,
    'material-memory',
    MATERIAL_MEMORY_KEY,
  );
  const value = stored[MATERIAL_MEMORY_KEY];
  if (!Array.isArray(value)) return [];
  let needsMigration = false;
  const records = value.filter(isMaterialMemoryRecord).map((record) => {
    const migrated = structuredClone(record);
    if (migrated.preview && !migrated.preview.scenario) {
      migrated.preview.scenario = 'work';
      needsMigration = true;
    }
    if (migrated.actualUtility !== null && !migrated.actualUtilityScenario) {
      migrated.actualUtilityScenario = 'work';
      needsMigration = true;
    }
    if (migrated.storedEvaluation) {
      const storedEvaluation = migrated.storedEvaluation;
      if (!storedEvaluation.context.scenario) needsMigration = true;
      storedEvaluation.context = {
        ...storedEvaluation.context,
        scenario: storedEvaluation.context.scenario ?? 'work',
      };
      const evaluation = storedEvaluation.evaluation;
      if (!evaluation.scenario || !evaluation.scenarioSignals) {
        needsMigration = true;
      }
      evaluation.scenario = evaluation.scenario ?? 'work';
      evaluation.scenarioSignals = evaluation.scenarioSignals ?? {
        relevance: evaluation.components.relevance,
        novelty: evaluation.components.novelty,
        quality: evaluation.components.quality,
        actionability: evaluation.components.actionability,
        knowledgeFit: 50,
        timeFit: 50,
        effortFit: 50,
        tasteFit: 50,
        serendipity: 50,
        enjoymentFit: 50,
      };
    }
    return migrated;
  });
  if (needsMigration)
    await measuredStorageSet(storage, 'material-memory', {
      [MATERIAL_MEMORY_KEY]: records,
    });
  return records;
}

export async function findMaterialMemory(
  url: string,
  storage: StorageArea = chrome.storage.local,
): Promise<MaterialMemoryRecord | null> {
  const canonical = canonicalMaterialUrl(url);
  const records = await loadMaterialMemory(storage);
  return records.find((record) => record.url === canonical) ?? null;
}

async function updateMaterialMemory(
  url: string,
  title: string,
  update: (record: MaterialMemoryRecord) => void,
  storage: StorageArea,
  occurredAt: string,
): Promise<MaterialMemoryRecord> {
  const canonical = canonicalMaterialUrl(url);
  const records = await loadMaterialMemory(storage);
  const existing = records.find((record) => record.url === canonical);
  const record: MaterialMemoryRecord = existing ?? {
    url: canonical,
    title,
    preview: null,
    storedEvaluation: null,
    decision: null,
    actualUtility: null,
    actualUtilityAt: null,
    actualUtilityScenario: null,
    updatedAt: occurredAt,
  };
  if (title.trim()) record.title = title.trim();
  update(record);
  record.updatedAt = occurredAt;
  const next = [
    record,
    ...records.filter((item) => item.url !== canonical),
  ].slice(0, MAX_MATERIAL_MEMORY_RECORDS);
  await measuredStorageSet(storage, 'material-memory', {
    [MATERIAL_MEMORY_KEY]: next,
  });
  return record;
}

export async function recordHoverPreviewEvent(
  event: HoverPreviewEventMessage,
  storage: StorageArea = chrome.storage.local,
): Promise<MaterialMemoryRecord> {
  return updateMaterialMemory(
    event.url,
    event.title,
    (record) => {
      const previous = record.preview;
      const preservePreliminary =
        previous?.scenario === event.scenario &&
        previous?.source === 'title-preview' &&
        event.source === 'full-analysis';
      record.preview = {
        scenario: event.scenario,
        verdict: preservePreliminary ? previous.verdict : event.verdict,
        recommendedAction: preservePreliminary
          ? previous.recommendedAction
          : event.recommendedAction,
        source: preservePreliminary ? previous.source : event.source,
        signalIds: preservePreliminary
          ? previous.signalIds
          : [...new Set(event.signalIds)].slice(0, 6),
        shownCount:
          (previous?.scenario === event.scenario ? previous.shownCount : 0) +
          (event.event === 'shown' ? 1 : 0),
        openedCount:
          (previous?.scenario === event.scenario ? previous.openedCount : 0) +
          (event.event === 'opened' ? 1 : 0),
        lastShownAt:
          event.event === 'shown'
            ? event.occurredAt
            : (previous?.lastShownAt ?? event.occurredAt),
        lastOpenedAt:
          event.event === 'opened'
            ? event.occurredAt
            : (previous?.lastOpenedAt ?? null),
      };
    },
    storage,
    event.occurredAt,
  );
}

export async function recordMaterialEvaluation(
  storedEvaluation: StoredEvaluation,
  title: string,
  storage: StorageArea = chrome.storage.local,
): Promise<MaterialMemoryRecord> {
  return updateMaterialMemory(
    storedEvaluation.url,
    title,
    (record) => {
      record.storedEvaluation = storedEvaluation;
    },
    storage,
    storedEvaluation.evaluation.analyzedAt,
  );
}

export async function invalidateMaterialEvaluations(
  storage: StorageArea = chrome.storage.local,
): Promise<void> {
  const records = await loadMaterialMemory(storage);
  if (!records.some((record) => record.storedEvaluation)) return;
  const next = records.map((record) => ({
    ...record,
    storedEvaluation: null,
  }));
  await measuredStorageSet(storage, 'material-memory', {
    [MATERIAL_MEMORY_KEY]: next,
  });
}

export async function recordMaterialDecision(
  decision: DecisionRecord,
  storage: StorageArea = chrome.storage.local,
): Promise<MaterialMemoryRecord> {
  return updateMaterialMemory(
    decision.url,
    decision.title,
    (record) => {
      record.decision = decision;
    },
    storage,
    decision.decidedAt,
  );
}

export async function recordMaterialActualUtility(
  url: string,
  title: string,
  actualUtility: number,
  occurredAt: string,
  storage: StorageArea = chrome.storage.local,
  scenario: AttentionScenario = 'work',
): Promise<MaterialMemoryRecord> {
  return updateMaterialMemory(
    url,
    title,
    (record) => {
      record.actualUtility = Math.round(
        Math.min(100, Math.max(0, actualUtility)),
      );
      record.actualUtilityAt = occurredAt;
      record.actualUtilityScenario = scenario;
    },
    storage,
    occurredAt,
  );
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function deriveHoverCalibration(
  records: MaterialMemoryRecord[],
  scenario: AttentionScenario = 'work',
): HoverCalibration {
  const confirmed = records.filter(
    (record) =>
      record.preview?.source === 'title-preview' &&
      record.preview.scenario === scenario &&
      record.actualUtilityScenario === scenario &&
      record.actualUtility !== null,
  );
  if (confirmed.length < 5) {
    return { ...DEFAULT_HOVER_CALIBRATION, sampleSize: confirmed.length };
  }

  const positiveActual = average(
    confirmed
      .filter((record) => record.preview?.verdict === 'read')
      .map((record) => record.actualUtility as number),
  );
  const negativeActual = average(
    confirmed
      .filter((record) => record.preview?.verdict === 'skip')
      .map((record) => record.actualUtility as number),
  );

  const positiveThreshold =
    positiveActual === null
      ? 0.5
      : positiveActual < 60
        ? 0.6
        : positiveActual >= 75
          ? 0.45
          : 0.5;
  const negativeThreshold =
    negativeActual === null
      ? 0.5
      : negativeActual >= 60
        ? 0.65
        : negativeActual <= 35
          ? 0.45
          : 0.5;

  return {
    version: HOVER_CALIBRATION_VERSION,
    sampleSize: confirmed.length,
    positiveThreshold,
    negativeThreshold,
  };
}
