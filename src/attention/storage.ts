import type {
  AnalysisContext,
  AttentionScenario,
  AttentionSessionProgress,
  AttentionSessionRecord,
  MaterialDecision,
  MaterialEvaluation,
  MaterialOutcome,
  MaterialOutcomeReason,
  PageCapture,
} from '../shared/types';
import {
  hasMeaningfulReadingEngagement,
  readingEngagementThreshold,
} from './eligibility';
import { STORAGE_RETENTION_LIMITS } from '../storage/limits';
import {
  measuredStorageGet,
  measuredStorageSet,
} from '../storage/measured-storage';

export const ATTENTION_SESSIONS_KEY = 'attentionSessions';

interface StorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}

function isAttentionSession(value: unknown): value is AttentionSessionRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const expected = item.expected as Record<string, unknown> | undefined;
  return (
    typeof item.id === 'string' &&
    typeof item.url === 'string' &&
    typeof item.title === 'string' &&
    (item.decision === 'read' || item.decision === 'skim') &&
    (item.scenario === undefined ||
      ['work', 'learn', 'explore', 'relax'].includes(String(item.scenario))) &&
    typeof expected === 'object' &&
    expected !== null &&
    (typeof expected.analyzerId === 'string' || expected.analyzerId === null) &&
    (['read', 'skim', 'save', 'skip'].includes(
      String(expected.recommendedAction),
    ) ||
      expected.recommendedAction === null) &&
    (typeof expected.expectedValue === 'string' ||
      expected.expectedValue === null) &&
    (typeof expected.confidence === 'number' || expected.confidence === null) &&
    Array.isArray(expected.profileSignalIds) &&
    (typeof expected.predictedUtility === 'number' ||
      expected.predictedUtility === null ||
      expected.predictedUtility === undefined) &&
    (typeof expected.components === 'object' ||
      expected.components === null ||
      expected.components === undefined) &&
    typeof item.estimatedReadingSeconds === 'number' &&
    typeof item.startedAt === 'string' &&
    typeof item.updatedAt === 'string' &&
    (typeof item.endedAt === 'string' || item.endedAt === null) &&
    typeof item.visibleSeconds === 'number' &&
    [0, 25, 50, 75, 100].includes(Number(item.maxScrollDepth)) &&
    typeof item.sampledForOutcome === 'boolean' &&
    typeof item.promptShownCount === 'number' &&
    (['yes', 'partial', 'no'].includes(String(item.outcome)) ||
      item.outcome === null) &&
    ([
      'nothingNew',
      'goalMismatch',
      'tooShallow',
      'tooDifficult',
      'poorQuality',
    ].includes(String(item.outcomeReason)) ||
      item.outcomeReason === null) &&
    (typeof item.outcomeAt === 'string' || item.outcomeAt === null)
  );
}

export async function loadAttentionSessions(
  storage: StorageArea = chrome.storage.local,
): Promise<AttentionSessionRecord[]> {
  const stored = await measuredStorageGet(
    storage,
    'attention',
    ATTENTION_SESSIONS_KEY,
  );
  const value: unknown = stored[ATTENTION_SESSIONS_KEY];
  if (!Array.isArray(value)) return [];
  const sessions = value.filter(isAttentionSession).map((session) => ({
    ...session,
    scenario: session.scenario ?? 'work',
    scenarioContext: session.scenarioContext ?? {
      intent: '',
      availableMinutes: 15,
      relaxIntent: null,
      desiredEffort: null,
    },
    expected: {
      ...session.expected,
      predictedUtility: session.expected.predictedUtility ?? null,
      components: session.expected.components ?? null,
    },
  }));
  if (
    value.some((item) => {
      if (!item || typeof item !== 'object') return false;
      const record = item as Record<string, unknown>;
      return !record.scenario || !record.scenarioContext;
    })
  ) {
    await measuredStorageSet(storage, 'attention', {
      [ATTENTION_SESSIONS_KEY]: sessions,
    });
  }
  return sessions;
}

export async function getOpenAttentionSession(
  pageUrl: string,
  storage: StorageArea = chrome.storage.local,
  scenario?: AttentionScenario,
): Promise<AttentionSessionRecord | null> {
  const canonical = canonicalUrl(pageUrl);
  const sessions = await loadAttentionSessions(storage);
  return (
    sessions.find(
      (session) =>
        canonicalUrl(session.url) === canonical &&
        session.outcome === null &&
        session.endedAt === null &&
        (!scenario || session.scenario === scenario),
    ) ?? null
  );
}

function shouldSampleOutcome(
  _sessions: AttentionSessionRecord[],
  _decision: Extract<MaterialDecision, 'read' | 'skim'>,
  evaluation: MaterialEvaluation | null,
): boolean {
  return evaluation?.utilityScore !== undefined;
}

export async function createAttentionSession(
  capture: PageCapture,
  decision: Extract<MaterialDecision, 'read' | 'skim'>,
  evaluation: MaterialEvaluation | null,
  storage: StorageArea = chrome.storage.local,
  now = new Date(),
  context?: AnalysisContext,
): Promise<AttentionSessionRecord> {
  const sessions = await loadAttentionSessions(storage);
  const timestamp = now.toISOString();
  const canonicalCaptureUrl = canonicalUrl(capture.url);
  const samplingSessions = sessions.filter(
    (item) =>
      item.outcome !== null || canonicalUrl(item.url) !== canonicalCaptureUrl,
  );
  const session: AttentionSessionRecord = {
    id: crypto.randomUUID(),
    url: canonicalCaptureUrl,
    title: capture.title,
    decision,
    scenario: evaluation?.scenario ?? context?.scenario ?? 'work',
    scenarioContext: {
      intent: context?.intent ?? '',
      availableMinutes: context?.availableMinutes ?? 15,
      relaxIntent: context?.relaxIntent ?? null,
      desiredEffort: context?.desiredEffort ?? null,
    },
    expected: {
      analyzerId: evaluation?.analyzerId ?? null,
      recommendedAction: evaluation?.recommendedAction ?? null,
      expectedValue: evaluation?.expectedValue ?? null,
      confidence: evaluation?.confidence ?? null,
      profileSignalIds:
        evaluation?.profileSignals.map((signal) => signal.id) ?? [],
      predictedUtility: evaluation?.utilityScore ?? null,
      components: evaluation?.components ?? null,
    },
    estimatedReadingSeconds: Math.max(0, capture.readingTimeMinutes * 60),
    startedAt: timestamp,
    updatedAt: timestamp,
    endedAt: null,
    visibleSeconds: 0,
    maxScrollDepth: 0,
    sampledForOutcome: shouldSampleOutcome(
      samplingSessions,
      decision,
      evaluation,
    ),
    promptShownCount: 0,
    outcome: null,
    outcomeReason: null,
    outcomeAt: null,
  };
  const next = [
    session,
    ...samplingSessions.filter(
      (item) => item.outcome !== null || canonicalUrl(item.url) !== session.url,
    ),
  ].slice(0, STORAGE_RETENTION_LIMITS.attentionSessions);
  await measuredStorageSet(storage, 'attention', {
    [ATTENTION_SESSIONS_KEY]: next,
  });
  return session;
}

export async function applyAttentionProgress(
  progress: AttentionSessionProgress,
  storage: StorageArea = chrome.storage.local,
): Promise<void> {
  const sessions = await loadAttentionSessions(storage);
  const session = sessions.find((item) => item.id === progress.sessionId);
  if (!session || canonicalUrl(session.url) !== canonicalUrl(progress.url))
    return;
  session.visibleSeconds = Math.max(
    session.visibleSeconds,
    Math.min(86_400, Math.max(0, Math.round(progress.visibleSeconds))),
  );
  session.maxScrollDepth = Math.max(
    session.maxScrollDepth,
    progress.maxScrollDepth,
  ) as AttentionSessionRecord['maxScrollDepth'];
  session.updatedAt = progress.recordedAt;
  if (progress.ended) session.endedAt = progress.recordedAt;
  await measuredStorageSet(storage, 'attention', {
    [ATTENTION_SESSIONS_KEY]: sessions,
  });
}

export async function cancelAttentionSession(
  pageUrl: string,
  storage: StorageArea = chrome.storage.local,
): Promise<void> {
  const canonical = canonicalUrl(pageUrl);
  const sessions = await loadAttentionSessions(storage);
  const next = sessions.filter(
    (session) =>
      session.outcome !== null || canonicalUrl(session.url) !== canonical,
  );
  if (next.length !== sessions.length) {
    await measuredStorageSet(storage, 'attention', {
      [ATTENTION_SESSIONS_KEY]: next,
    });
  }
}

export function isOutcomePromptEligible(
  session: AttentionSessionRecord,
  now = new Date(),
): boolean {
  const ageSeconds =
    (now.getTime() - new Date(session.startedAt).getTime()) / 1000;
  const threshold = readingEngagementThreshold(session.estimatedReadingSeconds);
  const meaningfulEngagement = hasMeaningfulReadingEngagement(
    session.visibleSeconds,
    session.maxScrollDepth,
    session.estimatedReadingSeconds,
  );
  return (
    session.sampledForOutcome &&
    session.outcome === null &&
    session.promptShownCount <
      STORAGE_RETENTION_LIMITS.outcomePromptShowsPerSession &&
    ageSeconds >= threshold &&
    meaningfulEngagement
  );
}

export async function getEligibleOutcomeSession(
  pageUrl: string,
  storage: StorageArea = chrome.storage.local,
  now = new Date(),
): Promise<AttentionSessionRecord | null> {
  const canonical = canonicalUrl(pageUrl);
  const sessions = await loadAttentionSessions(storage);
  return (
    sessions.find(
      (session) =>
        canonicalUrl(session.url) === canonical &&
        isOutcomePromptEligible(session, now),
    ) ?? null
  );
}

export async function markOutcomePromptShown(
  sessionId: string,
  storage: StorageArea = chrome.storage.local,
): Promise<void> {
  const sessions = await loadAttentionSessions(storage);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session || session.outcome !== null) return;
  session.promptShownCount += 1;
  await measuredStorageSet(storage, 'attention', {
    [ATTENTION_SESSIONS_KEY]: sessions,
  });
}

export async function recordMaterialOutcome(
  sessionId: string,
  outcome: MaterialOutcome,
  storage: StorageArea = chrome.storage.local,
  now = new Date(),
): Promise<void> {
  const sessions = await loadAttentionSessions(storage);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;
  session.outcome = outcome;
  session.outcomeAt = now.toISOString();
  session.updatedAt = now.toISOString();
  await measuredStorageSet(storage, 'attention', {
    [ATTENTION_SESSIONS_KEY]: sessions,
  });
}

export async function recordMaterialOutcomeReason(
  sessionId: string,
  reason: MaterialOutcomeReason,
  storage: StorageArea = chrome.storage.local,
): Promise<void> {
  const sessions = await loadAttentionSessions(storage);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session || session.outcome !== 'no') return;
  session.outcomeReason = reason;
  await measuredStorageSet(storage, 'attention', {
    [ATTENTION_SESSIONS_KEY]: sessions,
  });
}

export interface OutcomeStats {
  total: number;
  yes: number;
  partial: number;
  no: number;
}

export async function getOutcomeStats(
  storage: StorageArea = chrome.storage.local,
): Promise<OutcomeStats> {
  const sessions = await loadAttentionSessions(storage);
  return sessions.reduce<OutcomeStats>(
    (stats, session) => {
      if (!session.outcome) return stats;
      stats.total += 1;
      stats[session.outcome] += 1;
      return stats;
    },
    { total: 0, yes: 0, partial: 0, no: 0 },
  );
}
